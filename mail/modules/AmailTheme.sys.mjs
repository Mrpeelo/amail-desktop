/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Some aMail palettes (amailPalettes.css) are always light or always dark.
 * While one of them is chosen, the matching built-in theme is kept on, so
 * prefers-color-scheme and message content follow; enabling another theme
 * switches it back. The theme that was active before comes back when a
 * palette without a fixed mode is chosen.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
});

const PALETTE_PREF = "amail.theme.palette";
const RESTORE_PREF = "amail.theme.restoreTheme";
const LIGHT_THEME = "thunderbird-compact-light@mozilla.org";
const DARK_THEME = "thunderbird-compact-dark@mozilla.org";

/** Palette -> the theme it always uses. */
const FORCED_THEMES = {
  amail: LIGHT_THEME,
  kingsley: DARK_THEME,
  afterlife: DARK_THEME,
  roman: DARK_THEME,
  avida: DARK_THEME,
};

let pending = Promise.resolve();

async function applyNow() {
  const themes = await lazy.AddonManager.getAddonsByTypes(["theme"]);
  const active = themes.find(theme => theme.isActive)?.id;
  const forced = AmailTheme.forcedTheme;
  if (forced) {
    if (active != forced) {
      if (active && !Services.prefs.prefHasUserValue(RESTORE_PREF)) {
        Services.prefs.setStringPref(RESTORE_PREF, active);
      }
      await (await lazy.AddonManager.getAddonByID(forced))?.enable();
    }
  } else if (Services.prefs.prefHasUserValue(RESTORE_PREF)) {
    const restore = Services.prefs.getStringPref(RESTORE_PREF);
    Services.prefs.clearUserPref(RESTORE_PREF);
    if (Object.values(FORCED_THEMES).includes(active) && restore != active) {
      await (await lazy.AddonManager.getAddonByID(restore))?.enable();
    }
  }
}

export const AmailTheme = {
  /**
   * The theme the chosen palette always uses, if any.
   *
   * @type {?string}
   */
  get forcedTheme() {
    return FORCED_THEMES[Services.prefs.getStringPref(PALETTE_PREF, "")] ?? null;
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
    lazy.AddonManager.addAddonListener({
      onEnabled: addon => {
        if (addon.type == "theme" && this.forcedTheme && addon.id != this.forcedTheme) {
          this.apply();
        }
      },
    });
    this.apply();
  },
};
