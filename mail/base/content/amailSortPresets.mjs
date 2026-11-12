/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global gFolder, gViewWrapper, MailServices, sortController, threadPane */

/**
 * aMail saved sort orders, in the Sort menu of the message list header.
 * A saved sort holds the sort column, direction and grouping (conversations,
 * plain list or grouped by sort) and can be applied to the open folder or to
 * any number of folders at once.
 */

const PREF = "amail.sort.presets";

/**
 * @typedef {object} SortPreset
 * @property {string} name
 * @property {string} column - Column id of the primary sort.
 * @property {boolean} ascending
 * @property {"threaded"|"unthreaded"|"group"} mode
 * @property {number} viewFlags - nsMsgViewFlagsType of the saved view.
 * @property {number} sortType - nsMsgViewSortType of the saved view.
 * @property {number} sortOrder - nsMsgViewSortOrder of the saved view.
 */

/** @returns {SortPreset[]} */
function loadPresets() {
  try {
    const presets = JSON.parse(Services.prefs.getStringPref(PREF, "[]"));
    return Array.isArray(presets) ? presets : [];
  } catch {
    return [];
  }
}

function savePresets(presets) {
  Services.prefs.setStringPref(PREF, JSON.stringify(presets));
}

function currentSort() {
  let mode = "unthreaded";
  if (gViewWrapper.showGroupedBySort) {
    mode = "group";
  } else if (gViewWrapper.showThreaded) {
    mode = "threaded";
  }
  return {
    column: gViewWrapper.primarySortColumnId,
    ascending: gViewWrapper.isSortedAscending,
    mode,
    viewFlags: gViewWrapper.dbView.viewFlags,
    sortType: gViewWrapper.dbView.sortType,
    sortOrder: gViewWrapper.dbView.sortOrder,
  };
}

async function saveCurrentSort() {
  if (!gViewWrapper?.dbView) {
    return;
  }
  const [title, message] = await document.l10n.formatValues([
    "amail-sort-save-title",
    "amail-sort-save-message",
  ]);
  const input = { value: "" };
  if (!Services.prompt.prompt(window, title, message, input, null, {})) {
    return;
  }
  const name = input.value.trim();
  if (!name) {
    return;
  }
  const presets = loadPresets().filter(preset => preset.name != name);
  presets.push({ name, ...currentSort() });
  presets.sort((a, b) => a.name.localeCompare(b.name));
  savePresets(presets);
}

/**
 * Apply a saved sort to the open folder through the same commands as the
 * Sort menu, so the list updates right away.
 *
 * @param {SortPreset} preset
 */
function applyToOpenFolder(preset) {
  if (!gViewWrapper?.dbView) {
    return;
  }
  const command = value => sortController.handleCommand({ target: { value } });
  command(preset.mode);
  command(preset.column);
  command(preset.ascending ? "ascending" : "descending");
  threadPane.restoreSortIndicator();
}

/**
 * Store a saved sort in a folder's database; it is used the next time the
 * folder is opened.
 *
 * @param {SortPreset} preset
 * @param {nsIMsgFolder} folder
 */
function applyToStoredFolder(preset, folder) {
  if (folder.isServer) {
    return;
  }
  const info = folder.msgDatabase.dBFolderInfo;
  info.viewFlags = preset.viewFlags;
  info.sortType = preset.sortType;
  info.sortOrder = preset.sortOrder;
  folder.msgDatabase = null;
}

/** @param {SortPreset} preset */
function applyToFolders(preset) {
  const result = { uris: [] };
  window.browsingContext.topChromeWindow.openDialog(
    "chrome://messenger/content/amailSortApply.xhtml",
    "amailSortApply",
    "chrome,modal,centerscreen,resizable",
    { presetName: preset.name, result }
  );
  for (const uri of result.uris) {
    try {
      if (gFolder?.URI == uri) {
        applyToOpenFolder(preset);
      } else {
        applyToStoredFolder(preset, MailServices.folderLookup.getFolderForURL(uri));
      }
    } catch (error) {
      console.error(`aMail: could not apply sort to ${uri}`, error);
    }
  }
}

function deletePreset(preset) {
  savePresets(loadPresets().filter(p => p.name != preset.name));
}

function menuItem(l10nId, onCommand, args) {
  const item = document.createXULElement("menuitem");
  document.l10n.setAttributes(item, l10nId, args);
  item.addEventListener("command", event => {
    // The sort menu runs cmd_sort for every command inside it.
    event.stopPropagation();
    onCommand();
  });
  return item;
}

function buildPresetMenu(popup) {
  const presets = loadPresets();
  popup.replaceChildren();
  for (const preset of presets) {
    const menu = document.createXULElement("menu");
    menu.setAttribute("label", preset.name);
    const sub = document.createXULElement("menupopup");
    sub.append(
      menuItem("amail-sort-apply-here", () => applyToOpenFolder(preset)),
      menuItem("amail-sort-apply-folders", () => applyToFolders(preset)),
      document.createXULElement("menuseparator"),
      menuItem("amail-sort-delete", () => deletePreset(preset))
    );
    menu.append(sub);
    popup.append(menu);
  }
  popup.parentNode.disabled = !presets.length;
}

export function initAmailSortPresets() {
  const sortPopup = document.getElementById("menu_threadPaneSortPopup");
  const presetsMenu = document.createXULElement("menu");
  presetsMenu.id = "amailSortPresetsMenu";
  document.l10n.setAttributes(presetsMenu, "amail-sort-saved");
  const presetsPopup = document.createXULElement("menupopup");
  presetsMenu.append(presetsPopup);
  const save = menuItem("amail-sort-save", saveCurrentSort);
  save.id = "amailSortSave";
  sortPopup.append(
    document.createXULElement("menuseparator"),
    save,
    presetsMenu
  );
  sortPopup.addEventListener("popupshowing", event => {
    if (event.target == sortPopup) {
      buildPresetMenu(presetsPopup);
    }
  });
}
