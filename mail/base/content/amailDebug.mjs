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
  /** Ember palette: always dark, Dark theme while chosen, theme restored. */
  async "ember-theme"(record) {
    const top = window.browsingContext.topChromeWindow;
    top.resizeTo(1920, 1040);
    await wait(800);
    const { AddonManager } = ChromeUtils.importESModule(
      "resource://gre/modules/AddonManager.sys.mjs"
    );
    const activeTheme = async () =>
      (await AddonManager.getAddonsByTypes(["theme"])).find(t => t.isActive)?.id;
    const state = async label => {
      const cs = top.getComputedStyle(top.document.documentElement);
      record({
        label,
        palette: Services.prefs.getStringPref("amail.theme.palette"),
        theme: await activeTheme(),
        restorePref: Services.prefs.getStringPref("amail.theme.restoreTheme", ""),
        dark: top.matchMedia("(prefers-color-scheme: dark)").matches,
        scheme: cs.colorScheme,
        base: cs.getPropertyValue("--color-surface-base"),
        primary: cs.getPropertyValue("--color-primary-default"),
        text: cs.getPropertyValue("--color-text-base"),
      });
    };
    const original = Services.prefs.getStringPref("amail.theme.palette");
    await state("before");

    top.amailSettingsDialog.openSettings("general");
    await wait(2000);
    let page = top.document.getElementById("amailSettingsBrowser").contentDocument;
    const choose = async value => {
      page = top.document.getElementById("amailSettingsBrowser").contentDocument;
      const select = page.querySelector('select[data-pref="amail.theme.palette"]');
      select.value = value;
      select.dispatchEvent(new top.Event("change", { bubbles: true }));
      await wait(3000);
    };
    await choose("ember");
    await state("ember");
    record({
      label: "settings page",
      modeDisabled: page.getElementById("themeMode").disabled,
      note: !page.getElementById("themeModeForced").hidden,
    });
    await snapshot("ember-settings", top);
    top.amailSettingsDialog.close();
    await wait(800);
    await snapshot("ember-mail", top);
    const tabmail = top.document.getElementById("tabmail");
    tabmail.openTab("calendar");
    await wait(2500);
    await snapshot("ember-calendar", top);
    tabmail.closeTab(tabmail.currentTabInfo);

    top.amailSettingsDialog.openSettings("general");
    await wait(2000);
    await choose(original == "ember" ? "amail" : original);
    await state("restored");
    top.amailSettingsDialog.close();
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
