/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * aMail full profile import: makes an exact copy of an existing Thunderbird
 * (or Betterbird) profile inside aMail's own data folder, rewrites absolute
 * paths so the copy is self-contained, registers it as the default profile
 * and lets the caller restart into it. The source profile is only read.
 */

import { FileUtils } from "resource://gre/modules/FileUtils.sys.mjs";

const SOURCE_APPS = ["Thunderbird", "Betterbird"];

// Files that belong to a running instance or to a specific app version and
// are recreated on the next start.
const SKIP_NAMES = new Set([
  "parent.lock",
  "lock",
  ".parentlock",
  "compatibility.ini",
  "addonStartup.json.lz4",
  "startupCache",
  "cache2",
  "crashes",
  "minidumps",
  "saved-telemetry-pings",
  "datareporting",
]);

// Text files that may contain absolute paths into the source profile.
const PATH_FILES = ["prefs.js", "extensions.json", "virtualFolders.dat"];

/**
 * @typedef {object} SourceProfile
 * @property {string} app - "Thunderbird" or "Betterbird".
 * @property {string} name - Profile name from profiles.ini.
 * @property {string} path - Absolute profile directory.
 * @property {number} lastUsed - prefs.js modification time (ms), 0 if unknown.
 */

function escapeForPrefs(path) {
  return path.replaceAll("\\", "\\\\");
}

export const AmailProfileImport = {
  /**
   * Find Thunderbird/Betterbird profiles of the current Windows user.
   *
   * @returns {Promise<SourceProfile[]>} Most recently used first.
   */
  async findProfiles() {
    const appData = Services.dirsvc.get("AppData", Ci.nsIFile).path;
    const found = [];
    for (const app of SOURCE_APPS) {
      const appDir = PathUtils.join(appData, app);
      const iniPath = PathUtils.join(appDir, "profiles.ini");
      if (!(await IOUtils.exists(iniPath))) {
        continue;
      }
      const ini = Cc["@mozilla.org/xpcom/ini-parser-factory;1"]
        .getService(Ci.nsIINIParserFactory)
        .createINIParser(new FileUtils.File(iniPath));
      for (const section of ini.getSections()) {
        if (!section.startsWith("Profile")) {
          continue;
        }
        let path, name, isRelative;
        try {
          path = ini.getString(section, "Path");
          name = ini.getString(section, "Name");
        } catch {
          continue;
        }
        try {
          isRelative = ini.getString(section, "IsRelative") == "1";
        } catch {
          isRelative = false;
        }
        const dir = isRelative
          ? PathUtils.join(appDir, ...path.split("/"))
          : path;
        const prefsPath = PathUtils.join(dir, "prefs.js");
        if (!(await IOUtils.exists(prefsPath))) {
          continue;
        }
        const { lastModified } = await IOUtils.stat(prefsPath);
        found.push({ app, name, path: dir, lastUsed: lastModified ?? 0 });
      }
    }
    return found.sort((a, b) => b.lastUsed - a.lastUsed);
  },

  /**
   * Whether the profile is open in a running Thunderbird. Windows keeps
   * parent.lock exclusively open while the profile is in use.
   *
   * @param {string} profileDir
   * @returns {Promise<boolean>}
   */
  async isInUse(profileDir) {
    const lockPath = PathUtils.join(profileDir, "parent.lock");
    if (!(await IOUtils.exists(lockPath))) {
      return false;
    }
    try {
      await IOUtils.read(lockPath, { maxBytes: 1 });
      return false;
    } catch {
      return true;
    }
  },

  /**
   * Copy the profile, fix paths and make it aMail's default profile.
   *
   * @param {string} sourceDir - Profile directory to copy.
   * @param {string} name - Name for the new aMail profile.
   * @param {function(number, number):void} [onProgress] - Called with
   *   (bytesCopied, bytesTotal).
   * @returns {Promise<nsIToolkitProfile>}
   */
  async importFullCopy(sourceDir, name, onProgress = () => {}) {
    const profileService = Cc[
      "@mozilla.org/toolkit/profile-service;1"
    ].getService(Ci.nsIToolkitProfileService);
    const profilesRoot = Services.dirsvc.get("DefProfRt", Ci.nsIFile).path;
    const targetDir = PathUtils.join(
      profilesRoot,
      `imported-${Date.now().toString(36)}`
    );

    const files = [];
    let total = 0;
    const walk = async dir => {
      for (const child of await IOUtils.getChildren(dir)) {
        if (SKIP_NAMES.has(PathUtils.filename(child))) {
          continue;
        }
        const info = await IOUtils.stat(child);
        if (info.type == "directory") {
          await walk(child);
        } else {
          files.push({ path: child, size: info.size });
          total += info.size;
        }
      }
    };
    await walk(sourceDir);

    try {
      let copied = 0;
      onProgress(0, total);
      for (const { path, size } of files) {
        const relative = path.slice(sourceDir.length + 1);
        const dest = PathUtils.join(targetDir, ...relative.split("\\"));
        await IOUtils.makeDirectory(PathUtils.parent(dest), {
          createAncestors: true,
        });
        await IOUtils.copy(path, dest);
        copied += size;
        onProgress(copied, total);
      }

      await this._copySignatures(targetDir);
      await this._rewritePaths(sourceDir, targetDir);
      await this._resetWindowLayout(targetDir);

      const profile = profileService.createUniqueProfile(
        new FileUtils.File(targetDir),
        name,
        "amail-import"
      );
      profileService.defaultProfile = profile;
      await profileService.asyncFlush();
      return profile;
    } catch (error) {
      await IOUtils.remove(targetDir, { recursive: true, ignoreAbsent: true });
      throw error;
    }
  },

  /**
   * Signatures are often files outside the profile; copy them in so the new
   * profile is portable, and point the identities at the copies.
   *
   * @param {string} targetDir
   */
  async _copySignatures(targetDir) {
    const prefsPath = PathUtils.join(targetDir, "prefs.js");
    let prefs = await IOUtils.readUTF8(prefsPath);
    const sigDir = PathUtils.join(targetDir, "signatures");
    const pattern = /user_pref\("(mail\.identity\.[^"]+\.sig_file)", "([^"]+)"\);/g;
    let index = 0;
    for (const [line, prefName, escapedPath] of prefs.matchAll(pattern)) {
      const sigPath = escapedPath.replaceAll("\\\\", "\\");
      if (!(await IOUtils.exists(sigPath))) {
        continue;
      }
      await IOUtils.makeDirectory(sigDir, { createAncestors: true });
      const dest = PathUtils.join(
        sigDir,
        `${index++}-${PathUtils.filename(sigPath)}`
      );
      await IOUtils.copy(sigPath, dest);
      prefs = prefs.replace(
        line,
        `user_pref("${prefName}", "${escapeForPrefs(dest)}");`
      );
    }
    await IOUtils.writeUTF8(prefsPath, prefs);
  },

  /**
   * aMail's window layout (top bar, command bar, no menu bar or spaces
   * toolbar) replaces the source's toolbar customisation; everything else
   * is kept as it was.
   *
   * @param {string} targetDir
   */
  async _resetWindowLayout(targetDir) {
    const xulStorePath = PathUtils.join(targetDir, "xulstore.json");
    if (await IOUtils.exists(xulStorePath)) {
      try {
        const store = await IOUtils.readJSON(xulStorePath);
        const messenger =
          store["chrome://messenger/content/messenger.xhtml"] ?? {};
        for (const id of [
          "unifiedToolbar",
          "toolbar-menubar",
          "spacesToolbar",
          "messageHeader",
        ]) {
          delete messenger[id];
        }
        await IOUtils.writeJSON(xulStorePath, store);
      } catch (error) {
        console.error(error);
      }
    }

    const prefsPath = PathUtils.join(targetDir, "prefs.js");
    const prefs = await IOUtils.readUTF8(prefsPath);
    const kept = prefs
      .split("\n")
      .filter(
        line =>
          !/^user_pref\("mail\.tabs\.(drawInTitlebar|autoHide)"/.test(line)
      )
      .join("\n");
    await IOUtils.writeUTF8(prefsPath, kept);
  },

  /**
   * Point absolute paths that referred to the source profile at the copy.
   *
   * @param {string} sourceDir
   * @param {string} targetDir
   */
  async _rewritePaths(sourceDir, targetDir) {
    const pairs = [
      [escapeForPrefs(sourceDir), escapeForPrefs(targetDir)],
      [sourceDir, targetDir],
      [sourceDir.replaceAll("\\", "/"), targetDir.replaceAll("\\", "/")],
    ];
    for (const file of PATH_FILES) {
      const path = PathUtils.join(targetDir, file);
      if (!(await IOUtils.exists(path))) {
        continue;
      }
      let text = await IOUtils.readUTF8(path);
      for (const [from, to] of pairs) {
        text = text.replaceAll(from, to);
      }
      await IOUtils.writeUTF8(path, text);
    }
  },

  /**
   * Restart aMail into the given profile. A restart normally reuses the
   * current profile unless XRE_PROFILE_PATH is already set.
   *
   * @param {nsIToolkitProfile} profile
   */
  restartInto(profile) {
    Services.env.set("XRE_PROFILE_PATH", profile.rootDir.path);
    Services.env.set("XRE_PROFILE_LOCAL_PATH", profile.localDir.path);
    Services.startup.quit(
      Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart
    );
  },
};
