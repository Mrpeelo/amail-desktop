/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global gFolder, gViewWrapper, MailServices, sortController, threadPane, threadTree */

/**
 * aMail saved sort orders, in the Sort menu of the message list header.
 * A saved sort holds the sort column, direction and grouping (conversations,
 * plain list or grouped by sort) and can be applied to the open folder or to
 * any number of folders at once. It can also hold the column layout: which
 * columns are shown, their order and all column widths.
 */

const PREF = "amail.sort.presets";
const WIDTHS_PREF = "amail.columns.widths";
const SAVE_COLUMNS_PREF = "amail.sort.saveColumns";

/**
 * @typedef {object} SortPreset
 * @property {string} name
 * @property {string} column - Column id of the primary sort.
 * @property {boolean} ascending
 * @property {"threaded"|"unthreaded"|"group"} mode
 * @property {number} viewFlags - nsMsgViewFlagsType of the saved view.
 * @property {number} sortType - nsMsgViewSortType of the saved view.
 * @property {number} sortOrder - nsMsgViewSortOrder of the saved view.
 * @property {string} [secondaryColumn] - Column id of the tie-breaker sort.
 * @property {boolean} [secondaryAscending]
 * @property {ColumnLayout} [columns] - Only when saved with the columns.
 */

/**
 * @typedef {object} ColumnLayout
 * @property {Record<string, {visible: boolean, ordinal: number}>} states -
 *   As Thunderbird stores them in a folder ("columnStates").
 * @property {Record<string, number>} widths - The amail.columns.widths value.
 */

/** Tie-breaker for sorts saved without one: newest first. */
const DEFAULT_SECONDARY = { column: "dateCol", ascending: false };

const columnForSortType = sortType =>
  threadPane.columns.find(
    column =>
      column.sortKey && Ci.nsMsgViewSortType[column.sortKey] == sortType
  )?.id;

const sortTypeForColumn = columnId =>
  Ci.nsMsgViewSortType[
    threadPane.columns.find(column => column.id == columnId)?.sortKey
  ];

/**
 * The tie-breaker of a saved sort, or none when the primary sort is by date
 * or the list is grouped (grouped lists have no secondary sort).
 *
 * @param {SortPreset} preset
 * @returns {?{column: string, ascending: boolean}}
 */
function secondaryOf(preset) {
  if (preset.mode == "group") {
    return null;
  }
  const secondary = preset.secondaryColumn
    ? { column: preset.secondaryColumn, ascending: preset.secondaryAscending }
    : DEFAULT_SECONDARY;
  return secondary.column == preset.column ? null : secondary;
}

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
  const view = gViewWrapper.dbView;
  const secondary = columnForSortType(view.secondarySortType);
  const useSecondary =
    secondary &&
    secondary != gViewWrapper.primarySortColumnId &&
    view.secondarySortType != Ci.nsMsgViewSortType.byId;
  return {
    column: gViewWrapper.primarySortColumnId,
    ascending: gViewWrapper.isSortedAscending,
    mode,
    viewFlags: view.viewFlags,
    sortType: view.sortType,
    sortOrder: view.sortOrder,
    secondaryColumn: useSecondary ? secondary : DEFAULT_SECONDARY.column,
    secondaryAscending: useSecondary
      ? view.secondarySortOrder == Ci.nsMsgViewSortOrder.ascending
      : DEFAULT_SECONDARY.ascending,
  };
}

/** @returns {ColumnLayout} */
function currentColumns() {
  const states = {};
  for (const column of threadPane.columns) {
    states[column.id] = { visible: !column.hidden, ordinal: column.ordinal };
  }
  let widths = {};
  try {
    widths = JSON.parse(Services.prefs.getStringPref(WIDTHS_PREF, "{}")) ?? {};
  } catch {}
  return { states, widths };
}

async function saveCurrentSort() {
  if (!gViewWrapper?.dbView) {
    return;
  }
  const [title, message, checkLabel, overwriteTitle] =
    await document.l10n.formatValues([
      "amail-sort-save-title",
      "amail-sort-save-message",
      "amail-sort-save-columns",
      "amail-sort-overwrite-title",
    ]);
  const input = { value: "" };
  const withColumns = {
    value: Services.prefs.getBoolPref(SAVE_COLUMNS_PREF, false),
  };
  let name;
  // A name that is taken asks whether to overwrite: Yes saves over it, No
  // asks for another name, Cancel stops.
  while (true) {
    if (
      !Services.prompt.prompt(window, title, message, input, checkLabel, withColumns)
    ) {
      return;
    }
    name = input.value.trim();
    if (!name) {
      return;
    }
    if (!loadPresets().some(preset => preset.name == name)) {
      break;
    }
    const overwriteMessage = await document.l10n.formatValue(
      "amail-sort-overwrite-message",
      { name }
    );
    const P = Ci.nsIPromptService;
    const choice = Services.prompt.confirmEx(
      window,
      overwriteTitle,
      overwriteMessage,
      P.BUTTON_POS_0 * P.BUTTON_TITLE_YES +
        P.BUTTON_POS_1 * P.BUTTON_TITLE_CANCEL +
        P.BUTTON_POS_2 * P.BUTTON_TITLE_NO +
        P.BUTTON_POS_0_DEFAULT,
      null,
      null,
      null,
      null,
      {}
    );
    if (choice == 0) {
      break;
    }
    if (choice == 1) {
      return;
    }
  }
  Services.prefs.setBoolPref(SAVE_COLUMNS_PREF, withColumns.value);
  const presets = loadPresets().filter(preset => preset.name != name);
  presets.push({
    name,
    ...currentSort(),
    ...(withColumns.value ? { columns: currentColumns() } : {}),
  });
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
  // Sorting by a new column keeps the previous one as the tie-breaker, so
  // sort by the tie-breaker first. Choosing a sort column ungroups the list,
  // so the grouping comes last.
  const secondary = secondaryOf(preset);
  if (secondary) {
    command(secondary.column);
    command(secondary.ascending ? "ascending" : "descending");
  }
  command(preset.column);
  command(preset.ascending ? "ascending" : "descending");
  command(preset.mode);
  threadPane.restoreSortIndicator();
  if (preset.columns) {
    threadPane.applyPersistedColumnsState(preset.columns.states);
    threadPane.updateColumns();
    threadTree.reset();
    threadPane.persistColumnStates();
    applyWidths(preset);
  }
}

/**
 * Use the column widths of a saved sort everywhere: they replace all current
 * widths (message lists follow the pref).
 *
 * @param {SortPreset} preset
 */
function applyWidths(preset) {
  if (preset.columns) {
    Services.prefs.setStringPref(
      WIDTHS_PREF,
      JSON.stringify(preset.columns.widths ?? {})
    );
  }
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
  const database = folder.msgDatabase;
  const info = database.dBFolderInfo;
  info.viewFlags = preset.viewFlags;
  info.sortType = preset.sortType;
  info.sortOrder = preset.sortOrder;
  // The folder's sort keys as nsMsgDBView::EncodeColumnSort writes them:
  // one character for the sort type, one for the order (+ "0").
  const encode = (type, ascending) =>
    String.fromCharCode(type) +
    String.fromCharCode(
      48 +
        (ascending
          ? Ci.nsMsgViewSortOrder.ascending
          : Ci.nsMsgViewSortOrder.descending)
    );
  const secondary = secondaryOf(preset);
  const secondaryType = secondary && sortTypeForColumn(secondary.column);
  info.setProperty(
    "sortColumns",
    encode(preset.sortType, preset.sortOrder == Ci.nsMsgViewSortOrder.ascending) +
      (secondaryType ? encode(secondaryType, secondary.ascending) : "")
  );
  if (preset.columns) {
    info.setCharProperty("columnStates", JSON.stringify(preset.columns.states));
  }
  // Without a commit the change is lost when the database closes.
  database.commit(Ci.nsMsgDBCommitType.kLargeCommit);
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
  if (result.uris.length) {
    applyWidths(preset);
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
