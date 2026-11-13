/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * aMail palettes that are always dark (amailPalettes.css) also switch on the
 * Dark theme, so prefers-color-scheme and message content follow. The theme
 * that was active before comes back when another palette is chosen.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
});

const PALETTE_PREF = "amail.theme.palette";
const RESTORE_PREF = "amail.theme.restoreTheme";
const DARK_THEME = "thunderbird-compact-dark@mozilla.org";
const DARK_PALETTES = new Set(["ember"]);

let pending = Promise.resolve();

async function applyNow() {
  const themes = await lazy.AddonManager.getAddonsByTypes(["theme"]);
  const active = themes.find(theme => theme.isActive)?.id;
  if (AmailTheme.forcesDark) {
    if (active != DARK_THEME) {
      if (active) {
        Services.prefs.setStringPref(RESTORE_PREF, active);
      }
      await (await lazy.AddonManager.getAddonByID(DARK_THEME))?.enable();
    }
  } else if (Services.prefs.prefHasUserValue(RESTORE_PREF)) {
    const restore = Services.prefs.getStringPref(RESTORE_PREF);
    Services.prefs.clearUserPref(RESTORE_PREF);
    if (active == DARK_THEME && restore != DARK_THEME) {
      await (await lazy.AddonManager.getAddonByID(restore))?.enable();
    }
  }
}

export const AmailTheme = {
  /** Whether the chosen palette is always dark. */
  get forcesDark() {
    return DARK_PALETTES.has(Services.prefs.getStringPref(PALETTE_PREF, ""));
  },

  /**
   * Match the theme to the palette. Calls run one after another.
   *
   * @returns {Promise} Resolves once the theme matches.
   */
  apply() {
    pending = pending.then(applyNow).catch(console.error);
    return pending;
  },

  init() {
    Services.prefs.addObserver(PALETTE_PREF, () => this.apply());
    this.apply();
  },
};
