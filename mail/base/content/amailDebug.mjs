/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Developer diagnostic for features in progress. Only runs when the
 * AMAIL_DEBUG_CHECKS environment variable lists check names (comma
 * separated); writes amail-debug.json to the profile and quits.
 *
 * Keep only checks for unconfirmed work: remove a check once the feature is
 * confirmed.
 */

const { FileUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/FileUtils.sys.mjs"
);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Ask scratchpad screen-watch.ps1 (run next to the test) for a capture of the
 * whole screen, which includes open menus.
 */
async function screenShot(name) {
  const dir = PathUtils.profileDir;
  const done = PathUtils.join(dir, "amail-shot-done");
  await IOUtils.remove(done, { ignoreAbsent: true });
  await IOUtils.writeUTF8(PathUtils.join(dir, "amail-shot-request"), name);
  for (let i = 0; i < 25 && !(await IOUtils.exists(done)); i++) {
    await wait(200);
  }
}

/**
 * Save a picture of the main window as amail-debug-<name>.png in the profile.
 */
async function snapshot(
  name,
  win = window.browsingContext.topChromeWindow,
  rect = null
) {
  const top = win;
  const bitmap = await top.browsingContext.currentWindowGlobal.drawSnapshot(
    rect,
    rect ? 2 : 1,
    "white"
  );
  const canvas = new top.OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  await IOUtils.write(
    PathUtils.join(PathUtils.profileDir, `amail-debug-${name}.png`),
    new Uint8Array(await blob.arrayBuffer())
  );
}

/**
 * Checks by name. Each receives a function to record results.
 *
 * @type {Record<string, function(function(object): void): Promise<void>>}
 */
const CHECKS = {
  /**
   * Settings > General "Add to Start menu": writes the shortcut into a temp
   * folder (never the real Start menu), reads its target back, runs twice
   * (added, then updated) and snapshots the General tab.
   */
  async "start-menu-shortcut"(record) {
    const top = window.browsingContext.topChromeWindow;
    top.amailSettingsDialog.openSettings("general");
    const browser = top.document.getElementById("amailSettingsBrowser");
    let page;
    for (let i = 0; i < 50; i++) {
      page = browser.contentWindow;
      if (page?.amailAddStartMenuShortcut && page.location.hash == "#general") {
        break;
      }
      await wait(100);
    }
    await wait(500);
    const doc = page.document;
    const button = doc.getElementById("startMenuAdd");
    record({
      label: "button",
      boxHidden: doc.getElementById("startMenuBox").hidden,
      text: button.textContent,
      visible: button.getBoundingClientRect().width > 0,
    });

    const shell = Cc["@mozilla.org/mail/shell-service;1"].getService(
      Ci.nsIShellService
    );
    const dir = PathUtils.join(PathUtils.tempDir, "amail-startmenu-test");
    await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
    const folder = new FileUtils.File(dir);
    const link = folder.clone();
    link.append("aMail.lnk");
    const exe = Services.dirsvc.get("XREExeF", Ci.nsIFile).path;
    const realLink = Services.dirsvc.get("Progs", Ci.nsIFile);
    realLink.append("aMail.lnk");
    const realBefore = realLink.exists();
    try {
      record({
        label: "missing link target",
        target: shell.getShortcutTarget(link),
      });
      const first = await page.amailAddStartMenuShortcut(folder);
      const target = shell.getShortcutTarget(link);
      record({
        label: "first click",
        result: first,
        exists: link.exists(),
        target,
        matchesExe: target.toLowerCase() == exe.toLowerCase(),
      });
      const second = await page.amailAddStartMenuShortcut(folder);
      await wait(300);
      record({
        label: "second click",
        result: second,
        status: doc.getElementById("startMenuStatus").textContent,
      });
      button.scrollIntoView({ block: "center" });
      await wait(300);
      await snapshot("start-menu");
    } finally {
      await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
      record({
        label: "real Start menu untouched",
        ok: realLink.exists() == realBefore,
        progs: realLink.parent.path,
      });
      top.amailSettingsDialog.close?.();
    }
  },
};

export async function runDebugChecks(names) {
  const out = [];
  const file = PathUtils.join(PathUtils.profileDir, "amail-debug.json");
  // Written after every entry, so a check that hangs still shows how far
  // it got.
  const record = entry => {
    out.push(entry);
    IOUtils.writeJSON(file, out).catch(console.error);
  };
  await wait(4000);
  for (const name of names) {
    const check = CHECKS[name];
    if (!check) {
      record({ label: `ERROR unknown check ${name}` });
      continue;
    }
    try {
      await check(record);
    } catch (error) {
      record({ label: `ERROR ${name}: ${error}`, stack: error.stack });
    }
  }
  await IOUtils.writeJSON(
    PathUtils.join(PathUtils.profileDir, "amail-debug.json"),
    out
  );
  Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
}
