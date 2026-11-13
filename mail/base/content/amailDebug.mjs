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
  /** Profile one light -> dark palette switch. */
  async "theme-profile"(record) {
    const { AmailTheme } = ChromeUtils.importESModule(
      "resource:///modules/AmailTheme.sys.mjs"
    );
    const original = Services.prefs.getStringPref("amail.theme.palette");
    Services.prefs.setStringPref("amail.theme.palette", "synthwave");
    await AmailTheme.apply();
    await wait(2000);
    Services.profiler.StartProfiler(1000000, 0.5, ["js", "stackwalk", "cpu"], ["GeckoMain"]);
    await wait(500);
    const t = performance.now();
    Services.prefs.setStringPref("amail.theme.palette", "kingsley");
    await AmailTheme.apply();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    record({ label: "switch", ms: Math.round(performance.now() - t) });
    await wait(300);
    const data = await Services.profiler.getProfileDataAsArrayBuffer();
    Services.profiler.StopProfiler();
    await IOUtils.write(
      PathUtils.join(PathUtils.profileDir, "amail-theme-profile.json"),
      new Uint8Array(data)
    );
    record({ label: "changing flag during", on: Services.prefs.getBoolPref("amail.theme.changing", false) });
    await wait(1500);
    record({ label: "changing flag after", on: Services.prefs.getBoolPref("amail.theme.changing", false) });
    Services.prefs.setStringPref("amail.theme.palette", original);
    await AmailTheme.apply();
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
