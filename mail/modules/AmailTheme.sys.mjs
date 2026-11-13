/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * aMail palettes: the built-in ones in amailPalettes.css, plus themes the
 * user imports (.css files with only color values, kept in the profile's
 * amail-themes folder).
 *
 * Some palettes are always light or always dark. While one of them is
 * chosen, the matching built-in theme is kept on, so prefers-color-scheme and
 * message content follow; enabling another theme switches it back. The theme
 * that was active before comes back when a palette without a fixed mode is
 * chosen.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

const PALETTE_PREF = "amail.theme.palette";
const RESTORE_PREF = "amail.theme.restoreTheme";
const LIGHT_THEME = "thunderbird-compact-light@mozilla.org";
const DARK_THEME = "thunderbird-compact-dark@mozilla.org";
/** While set, amailPalettes.css turns transitions off, so new colors apply in one step. */
const CHANGING_PREF = "amail.theme.changing";
const CHANGING_SETTLE_MS = 300;

/** Palette values for imported themes start with this. */
const CUSTOM_PREFIX = "custom:";
const THEMES_FOLDER = "amail-themes";

/** Built-in palettes: name for export, and the mode they always use. */
const BUILT_IN = {
  amail: { name: "aMail", mode: "light" },
  synthwave: { name: "Synthwave", mode: "any" },
  kingsley: { name: "Kingsley Amber", mode: "dark" },
  afterlife: { name: "Afterlife Jade", mode: "dark" },
  roman: { name: "Roman Slate", mode: "dark" },
  avida: { name: "Avida Cobalt", mode: "dark" },
};

const MODE_THEMES = { light: LIGHT_THEME, dark: DARK_THEME };

/** Colors with a light and a dark variable (--color-X-light / -dark). */
const PAIRED = new Set(
  [
    "accent-blue",
    "accent-pink",
    "accent-purple",
    "critical-default",
    "critical-hover",
    "critical-pressed",
    "critical-soft",
    "primary-default",
    "primary-hover",
    "primary-pressed",
    "primary-soft",
    "secondary-default",
    "surface-base",
    "surface-border",
    "surface-border-intense",
    "surface-deep",
    "surface-lower",
    "surface-raised",
    "surface-subtle",
    "text-base",
    "text-brand",
    "text-critical",
    "text-highlight",
    "text-muted",
    "text-secondary",
    "text-warning",
    "warning-soft",
  ].map(name => `--color-${name}`)
);

/** Colors that are a single variable. */
const SINGLE = new Set([
  "--amail-on-primary",
  "--amail-topbar-bg",
  "--amail-topbar-hover",
  "--amail-topbar-text",
  "--color-black",
  "--color-white",
  "--color-neutral-200",
  "--color-ink-20",
  "--color-ink-60",
  ...["30", "40", "50", "60", "70"].map(n => `--color-blue-${n}`),
  ...["05", "10", "20", "30", "40", "50", "60", "70", "80", "90"].map(n => `--color-gray-${n}`),
  "--selected-item-color",
  "--selected-item-text-color",
  "--sidebar-highlight-background-color",
  "--sidebar-highlight-text-color",
]);

/**
 * Documents an imported theme colors: aMail's own windows and pages, never
 * message content.
 */
const THEMED_DOCUMENTS = [
  "chrome://",
  "about:3pane",
  "about:message",
  "about:accountsettings",
  "about:preferences",
  "about:addressbook",
  "about:addons",
  "about:import",
];

/** A theme file that cannot be used; message is shown to the user. */
export class AmailThemeError extends Error {}

const COLOR =
  /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?)\([0-9.%\s,/deg+-]+\)|[a-z]+)$/i;

/**
 * Check a color value: a color, or light-dark(<color>, <color>).
 *
 * @param {string} value
 * @returns {boolean}
 */
function isColorValue(value) {
  const pair = /^light-dark\((.*)\)$/i.exec(value);
  if (!pair) {
    return COLOR.test(value);
  }
  let depth = 0;
  for (let i = 0; i < pair[1].length; i++) {
    const c = pair[1][i];
    depth += c == "(" ? 1 : c == ")" ? -1 : 0;
    if (c == "," && depth == 0) {
      return (
        COLOR.test(pair[1].slice(0, i).trim()) &&
        COLOR.test(pair[1].slice(i + 1).trim())
      );
    }
  }
  return false;
}

/**
 * Split light-dark(a, b) into [a, b]; any other value is used for both.
 *
 * @param {string} value
 * @returns {string[]}
 */
function lightAndDark(value) {
  const pair = /^light-dark\((.*)\)$/i.exec(value);
  if (!pair) {
    return [value, value];
  }
  let depth = 0;
  for (let i = 0; i < pair[1].length; i++) {
    const c = pair[1][i];
    depth += c == "(" ? 1 : c == ")" ? -1 : 0;
    if (c == "," && depth == 0) {
      return [pair[1].slice(0, i).trim(), pair[1].slice(i + 1).trim()];
    }
  }
  return [value, value];
}

/**
 * Read the declarations of one rule body: "--name: value;" pairs.
 *
 * @param {string} body
 * @returns {Array<[string, string]>}
 */
function declarations(body) {
  return body
    .split(";")
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const colon = part.indexOf(":");
      if (colon < 0) {
        throw new AmailThemeError(`"${part.slice(0, 40)}" is not a setting.`);
      }
      return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
    });
}

/**
 * @typedef {object} ThemeData
 * @property {string} name
 * @property {"light"|"dark"|"any"} mode
 * @property {Map<string, string>} colors - Variable -> color value.
 */

/**
 * Parse an aMail theme file.
 *
 * @param {string} text
 * @returns {ThemeData}
 * @throws {AmailThemeError} If the file is not a valid aMail theme.
 */
function parseTheme(text) {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  const rule = /^:root\s*\{([^{}]*)\}$/.exec(css);
  if (!rule) {
    throw new AmailThemeError("it must be one :root { … } block and nothing else.");
  }
  const theme = { name: "", mode: "any", colors: new Map() };
  for (const [prop, value] of declarations(rule[1])) {
    if (/url\(|@|\\|!/i.test(value)) {
      throw new AmailThemeError(`${prop} has a value that is not allowed.`);
    }
    if (prop == "--amail-theme-name") {
      const name = /^"([^"\n]{1,60})"$/.exec(value);
      if (!name) {
        throw new AmailThemeError("--amail-theme-name must be a quoted name.");
      }
      theme.name = name[1].trim();
    } else if (prop == "--amail-theme-mode") {
      if (!["light", "dark", "any"].includes(value)) {
        throw new AmailThemeError("--amail-theme-mode must be light, dark or any.");
      }
      theme.mode = value;
    } else if (!prop.startsWith("--")) {
      throw new AmailThemeError(`${prop} is not a color setting.`);
    } else if (PAIRED.has(prop) || SINGLE.has(prop)) {
      if (!isColorValue(value)) {
        throw new AmailThemeError(`${prop}: "${value.slice(0, 40)}" is not a color.`);
      }
      theme.colors.set(prop, value);
    }
    // Unknown variables are ignored, so themes from newer versions still load.
  }
  if (!theme.name) {
    throw new AmailThemeError("--amail-theme-name is missing.");
  }
  if (!theme.colors.size) {
    throw new AmailThemeError("it has no colors.");
  }
  return theme;
}

/**
 * Write a theme as an aMail theme file.
 *
 * @param {ThemeData} theme
 * @returns {string}
 */
function serializeTheme(theme) {
  const lines = [
    "/* aMail theme. Only colors inside :root are used: a color, or",
    "   light-dark(<light>, <dark>). Mode: light, dark or any. */",
    ":root {",
    `  --amail-theme-name: "${theme.name}";`,
    `  --amail-theme-mode: ${theme.mode};`,
  ];
  for (const [prop, value] of theme.colors) {
    lines.push(`  ${prop}: ${value};`);
  }
  lines.push("}", "");
  return lines.join("\n");
}

/**
 * The stylesheet that applies an imported theme to aMail's documents.
 *
 * @param {ThemeData} theme
 * @returns {string}
 */
function themeSheet(theme) {
  const vars = [];
  for (const [prop, value] of theme.colors) {
    if (PAIRED.has(prop)) {
      const [light, dark] = lightAndDark(value);
      vars.push(`${prop}-light: ${light} !important;`, `${prop}-dark: ${dark} !important;`);
    } else {
      vars.push(`${prop}: ${value} !important;`);
    }
  }
  const scheme = theme.mode == "any" ? "" : `color-scheme: ${theme.mode} !important;`;
  const documents = THEMED_DOCUMENTS.map(url => `url-prefix("${url}")`).join(", ");
  return `@-moz-document ${documents} {
  :root { ${scheme} ${vars.join(" ")} }
  :host { ${vars.join(" ")} }
}`;
}

/** Imported themes by id (the file name without .css). */
const customThemes = new Map();
let customSheet = null;

function themesFolder() {
  return PathUtils.join(PathUtils.profileDir, THEMES_FOLDER);
}

function customId(palette) {
  return palette.startsWith(CUSTOM_PREFIX) ? palette.slice(CUSTOM_PREFIX.length) : null;
}

/**
 * Read one imported theme without waiting; used at startup before the first
 * window, so it never shows in the wrong colors.
 *
 * @param {string} id
 * @returns {?ThemeData}
 */
function readCustomSync(id) {
  if (customThemes.has(id)) {
    return customThemes.get(id);
  }
  try {
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(PathUtils.join(themesFolder(), `${id}.css`));
    const theme = parseTheme(Cu.readUTF8File(file));
    customThemes.set(id, theme);
    return theme;
  } catch (e) {
    console.error(`aMail theme ${id} could not be loaded`, e);
    return null;
  }
}

/** Register the stylesheet of the chosen imported theme, if one is chosen. */
function updateCustomSheet() {
  const sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(
    Ci.nsIStyleSheetService
  );
  if (customSheet) {
    sss.unregisterSheet(customSheet, sss.AGENT_SHEET);
    customSheet = null;
  }
  const id = customId(Services.prefs.getStringPref(PALETTE_PREF, ""));
  if (!id) {
    return;
  }
  const theme = readCustomSync(id);
  if (!theme) {
    Services.prefs.setStringPref(PALETTE_PREF, "amail");
    return;
  }
  customSheet = Services.io.newURI(
    `data:text/css;charset=utf-8,${encodeURIComponent(themeSheet(theme))}`
  );
  sss.loadAndRegisterSheet(customSheet, sss.AGENT_SHEET);
}

/**
 * The colors of a built-in palette, read from amailPalettes.css.
 *
 * @param {string} id
 * @returns {ThemeData}
 */
function builtInTheme(id) {
  const uri = Cc["@mozilla.org/chrome/chrome-registry;1"]
    .getService(Ci.nsIChromeRegistry)
    .convertChromeURL(Services.io.newURI("chrome://messenger/skin/amailPalettes.css"));
  const css = Cu.readUTF8URI(uri).replace(/\/\*[\s\S]*?\*\//g, "");
  const start = css.indexOf(`@media -moz-pref("amail.theme.palette", "${id}")`);
  const open = css.indexOf("{", css.indexOf("{", start) + 1);
  const body = css.slice(open + 1, css.indexOf("}", open));
  const values = new Map(declarations(body));
  const colors = new Map();
  for (const prop of [...PAIRED].sort()) {
    const light = values.get(`${prop}-light`);
    const dark = values.get(`${prop}-dark`);
    if (light && dark) {
      colors.set(prop, light == dark ? light : `light-dark(${light}, ${dark})`);
    }
  }
  for (const prop of [...SINGLE].sort()) {
    if (values.has(prop)) {
      colors.set(prop, values.get(prop));
    }
  }
  return { name: BUILT_IN[id].name, mode: BUILT_IN[id].mode, colors };
}

let pending = Promise.resolve();
let changeCount = 0;

/**
 * Turn transitions off until the colors have settled. Without this, hundreds
 * of color transitions restyle and repaint the whole window for 200 ms.
 */
function colorsChanging() {
  const change = ++changeCount;
  if (!Services.prefs.getBoolPref(CHANGING_PREF, false)) {
    Services.prefs.setBoolPref(CHANGING_PREF, true);
  }
  // Let the change that triggered this queue its work first.
  lazy.setTimeout(async () => {
    await pending;
    lazy.setTimeout(() => {
      if (change == changeCount) {
        Services.prefs.clearUserPref(CHANGING_PREF);
      }
    }, CHANGING_SETTLE_MS);
  }, 0);
}

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
    if ([LIGHT_THEME, DARK_THEME].includes(active) && restore != active) {
      await (await lazy.AddonManager.getAddonByID(restore))?.enable();
    }
  }
}

export const AmailTheme = {
  CUSTOM_PREFIX,

  /**
   * The theme the chosen palette always uses, if any.
   *
   * @type {?string}
   */
  get forcedTheme() {
    const palette = Services.prefs.getStringPref(PALETTE_PREF, "");
    const id = customId(palette);
    const mode = id ? customThemes.get(id)?.mode : BUILT_IN[palette]?.mode;
    return MODE_THEMES[mode] ?? null;
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

  /**
   * The imported themes, sorted by name.
   *
   * @returns {Promise<Array<{id: string, palette: string, name: string, mode: string}>>}
   */
  async listImported() {
    const folder = themesFolder();
    if (await IOUtils.exists(folder)) {
      for (const path of await IOUtils.getChildren(folder)) {
        const id = PathUtils.filename(path).replace(/\.css$/, "");
        if (!path.endsWith(".css") || customThemes.has(id)) {
          continue;
        }
        try {
          customThemes.set(id, parseTheme(await IOUtils.readUTF8(path)));
        } catch (e) {
          console.error(`aMail theme ${path} is not valid`, e);
        }
      }
    }
    return [...customThemes]
      .map(([id, theme]) => ({ id, palette: CUSTOM_PREFIX + id, name: theme.name, mode: theme.mode }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  /**
   * Import a theme file into the profile.
   *
   * @param {string} path
   * @returns {Promise<{palette: string, name: string}>}
   * @throws {AmailThemeError} If the file is not a valid aMail theme.
   */
  async importFile(path) {
    const theme = parseTheme(await IOUtils.readUTF8(path));
    await this.listImported();
    const base =
      theme.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40) || "theme";
    let id = base;
    for (let n = 2; customThemes.has(id); n++) {
      id = `${base}-${n}`;
    }
    const names = new Set([...customThemes.values()].map(t => t.name));
    if (names.has(theme.name)) {
      let n = 2;
      while (names.has(`${theme.name} ${n}`)) {
        n++;
      }
      theme.name = `${theme.name} ${n}`;
    }
    await IOUtils.makeDirectory(themesFolder(), { ignoreExisting: true });
    await IOUtils.writeUTF8(PathUtils.join(themesFolder(), `${id}.css`), serializeTheme(theme));
    customThemes.set(id, theme);
    return { palette: CUSTOM_PREFIX + id, name: theme.name };
  },

  /**
   * Whether a palette can be exported (all but the stock Thunderbird colors).
   *
   * @param {string} palette
   * @returns {boolean}
   */
  canExport(palette) {
    return palette in BUILT_IN || customThemes.has(customId(palette));
  },

  /**
   * The name a palette is exported under.
   *
   * @param {string} palette
   * @returns {?string}
   */
  exportName(palette) {
    return BUILT_IN[palette]?.name ?? customThemes.get(customId(palette))?.name ?? null;
  },

  /**
   * Save a palette as an aMail theme file.
   *
   * @param {string} palette
   * @param {string} path
   */
  async exportFile(palette, path) {
    const id = customId(palette);
    const theme = id ? customThemes.get(id) : builtInTheme(palette);
    await IOUtils.writeUTF8(path, serializeTheme(theme));
  },

  /**
   * Delete an imported theme. If it is in use, aMail's colors are chosen.
   *
   * @param {string} palette
   */
  async deleteImported(palette) {
    const id = customId(palette);
    if (!id) {
      return;
    }
    if (Services.prefs.getStringPref(PALETTE_PREF, "") == palette) {
      Services.prefs.setStringPref(PALETTE_PREF, "amail");
    }
    customThemes.delete(id);
    await IOUtils.remove(PathUtils.join(themesFolder(), `${id}.css`), { ignoreAbsent: true });
  },

  /** Before the first window: apply an imported theme if one is chosen. */
  startup() {
    Services.prefs.clearUserPref(CHANGING_PREF);
    updateCustomSheet();
  },

  init() {
    Services.prefs.addObserver(PALETTE_PREF, () => {
      colorsChanging();
      updateCustomSheet();
      this.apply();
    });
    lazy.AddonManager.addAddonListener({
      onEnabling: addon => {
        if (addon.type == "theme") {
          colorsChanging();
        }
      },
      onEnabled: addon => {
        if (addon.type == "theme" && this.forcedTheme && addon.id != this.forcedTheme) {
          this.apply();
        }
      },
    });
    this.apply();
  },
};
