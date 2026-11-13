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
  /**
   * Saved sorts with "Save columns too": saving through the real prompt,
   * applying to the open folder and to a stored folder. Restores the open
   * folder's columns and sort and the other folder's settings afterwards.
   */
  async "sort-columns"(record) {
    const { MailServices } = ChromeUtils.importESModule(
      "resource:///modules/MailServices.sys.mjs"
    );
    const WIDTHS = "amail.columns.widths";
    const popup = document.getElementById("menu_threadPaneSortPopup");
    const layout = () =>
      threadPane.columns
        .filter(c => !c.hidden)
        .sort((a, b) => a.ordinal - b.ordinal)
        .map(c => c.id)
        .join(",");
    const headerWidth = id =>
      Math.round(document.getElementById(id)?.getBoundingClientRect().width ?? -1);
    const tableState = () => {
      const tree = document.getElementById("threadTree");
      return {
        headers: [...tree.querySelectorAll("thead th:not([hidden])")].map(
          th =>
            `${th.id}:${th.textContent.trim().slice(0, 12)}:${th.style.getPropertyValue("--amail-col-width")}:${Math.round(th.getBoundingClientRect().width)}`
        ),
        rows: tree.querySelectorAll("tbody tr[is]").length,
        firstRowText: tree.querySelector("tbody tr[is]")?.textContent.replace(/\s+/g, " ").trim().slice(0, 60),
        visible: document.visibilityState,
      };
    };
    const whoId = () => threadPane.columns.find(c => !c.hidden && ["senderCol", "recipientCol", "correspondentCol"].includes(c.id))?.id;

    // Answer the next modal window whose URL contains `part`. A modal
    // suspends this window's timers, so use a module timer.
    const { setTimeout } = ChromeUtils.importESModule(
      "resource://gre/modules/Timer.sys.mjs"
    );
    const answer = (part, handle) =>
      new Promise(resolve => {
        let tries = 0;
        const poll = () => {
          for (const top of Services.wm.getEnumerator(null)) {
            // Prompts can also open inside a window (tab-modal dialogs).
            for (const shell of top.docShell.getAllDocShellsInSubtree(
              Ci.nsIDocShellTreeItem.typeAll,
              Ci.nsIDocShell.ENUMERATE_FORWARDS
            )) {
              const win = shell.domWindow;
              if (
                win?.location.href.includes(part) &&
                win.document.readyState == "complete"
              ) {
                setTimeout(() => resolve(handle(win)), 300);
                return;
              }
            }
          }
          if (++tries < 60) {
            setTimeout(poll, 100);
          } else {
            resolve("no window");
          }
        };
        setTimeout(poll, 100);
      });
    const savePrompt = (name, withColumns) =>
      answer("commonDialog", win => {
        const doc = win.document;
        doc.getElementById("loginTextbox").value = name;
        const box = doc.getElementById("checkbox");
        const label = box.label;
        if (box.checked != withColumns) {
          box.click();
        }
        doc.getElementById("commonDialog").acceptDialog();
        return label;
      });
    // The Sort menu fills the saved sorts when it is about to show.
    const openMenu = async () => {
      popup.dispatchEvent(new Event("popupshowing"));
      await wait(200);
    };
    const presetItem = async (name, index) => {
      await openMenu();
      const menu = [...document.getElementById("amailSortPresetsMenu").menupopup.children].find(
        m => m.label == name
      );
      const item = menu?.menupopup?.children[index];
      record({
        label: `menu item ${name} #${index}`,
        popupState: popup.state,
        presets: [...document.getElementById("amailSortPresetsMenu").menupopup.children].map(
          m => m.label
        ),
        found: !!item,
      });
      popup.hidePopup();
      await wait(200);
      return item;
    };

    // Work in a real folder (not a unified one); go back at the end.
    const startFolder = gFolder;
    const isReal = f =>
      !f.isServer &&
      !f.getFlag(Ci.nsMsgFolderFlags.Virtual) &&
      f.getTotalMessages(false) > 0;
    const work = MailServices.accounts.allFolders.find(
      f => isReal(f) && f.getFlag(Ci.nsMsgFolderFlags.Inbox)
    );
    window.displayFolder(work.URI);
    await wait(2500);

    // Starting point, restored at the end.
    const original = {
      states: gViewWrapper.dbView && gFolder.msgDatabase.dBFolderInfo.getCharProperty("columnStates"),
      layout: layout(),
      widths: Services.prefs.getStringPref(WIDTHS, "{}"),
      viewFlags: gViewWrapper.dbView.viewFlags,
      sortType: gViewWrapper.dbView.sortType,
      sortOrder: gViewWrapper.dbView.sortOrder,
    };
    record({ label: "start", folder: gFolder.URI, layout: original.layout, widths: original.widths, table: tableState() });

    // Save with columns (prompt shows the toggle).
    Services.prefs.setStringPref(WIDTHS, JSON.stringify({ who: 260, dateCol: 150 }));
    await wait(500);
    const savedLayout = layout();
    const withCols = savePrompt("Test with columns", true);
    document.getElementById("amailSortSave").doCommand();
    const checkboxLabel = await withCols;
    await wait(1000);
    const noCols = savePrompt("Test without columns", false);
    document.getElementById("amailSortSave").doCommand();
    await noCols;
    await wait(1000);
    const presets = JSON.parse(Services.prefs.getStringPref("amail.sort.presets", "[]"));
    const p1 = presets.find(p => p.name == "Test with columns");
    const p2 = presets.find(p => p.name == "Test without columns");
    record({
      label: "saved",
      checkboxLabel,
      withColumns: !!p1?.columns,
      savedWidths: p1?.columns?.widths,
      withoutColumns: !p2?.columns,
      rememberedToggle: Services.prefs.getBoolPref("amail.sort.saveColumns", null),
    });

    // Change the columns: hide the date column, other widths.
    const dateCol = threadPane.columns.find(c => c.id == "dateCol");
    dateCol.hidden = true;
    threadPane.updateColumns();
    threadTree.reset();
    Services.prefs.setStringPref(WIDTHS, JSON.stringify({ who: 120, dateCol: 300 }));
    await wait(800);
    record({ label: "changed", layout: layout(), who: headerWidth(whoId()) });

    // Apply without columns: nothing about the columns changes.
    (await presetItem("Test without columns", 0))?.doCommand();
    await wait(800);
    record({
      label: "apply without columns",
      layout: layout(),
      widths: Services.prefs.getStringPref(WIDTHS, "{}"),
    });

    // Apply with columns: layout and all widths come back.
    (await presetItem("Test with columns", 0))?.doCommand();
    await wait(1200);
    record({
      label: "apply here with columns",
      layoutRestored: layout() == savedLayout,
      layout: layout(),
      widths: Services.prefs.getStringPref(WIDTHS, "{}"),
      whoHeader: headerWidth(whoId()),
      dateHeader: headerWidth("dateCol"),
      storedInFolder: !!gFolder.msgDatabase.dBFolderInfo.getCharProperty("columnStates"),
      table: tableState(),
    });
    await snapshot("sort-columns");

    // Apply to another (stored) folder through the Apply dialog.
    const other = MailServices.accounts.allFolders.find(
      f => isReal(f) && f != gFolder
    );
    const info = other.msgDatabase.dBFolderInfo;
    const before = {
      states: info.getCharProperty("columnStates"),
      sortColumns: info.getProperty("sortColumns"),
      viewFlags: info.viewFlags,
      sortType: info.sortType,
      sortOrder: info.sortOrder,
    };
    Services.prefs.setStringPref(WIDTHS, JSON.stringify({ who: 120 }));
    const dialog = answer("amailSortApply", win => {
      const box = [...win.document.querySelectorAll("#folderList input[type=checkbox]")].find(
        b => b.value == other.URI
      );
      box.checked = true;
      box.dispatchEvent(new win.Event("change"));
      win.document.getElementById("apply").click();
      return "ok";
    });
    (await presetItem("Test with columns", 1))?.doCommand();
    const dialogResult = await dialog;
    await wait(800);
    const otherInfo = other.msgDatabase.dBFolderInfo;
    record({
      label: "apply to other folder",
      folder: other.prettyName,
      dialogResult,
      columnStatesWritten: otherInfo.getCharProperty("columnStates") == JSON.stringify(p1.columns.states),
      widths: Services.prefs.getStringPref(WIDTHS, "{}"),
    });

    // Put everything back.
    otherInfo.setCharProperty("columnStates", before.states);
    otherInfo.setProperty("sortColumns", before.sortColumns);
    otherInfo.viewFlags = before.viewFlags;
    otherInfo.sortType = before.sortType;
    otherInfo.sortOrder = before.sortOrder;
    other.msgDatabase.commit(Ci.nsMsgDBCommitType.kLargeCommit);
    other.msgDatabase = null;

    Services.prefs.setStringPref(WIDTHS, original.widths);
    gFolder.msgDatabase.dBFolderInfo.setCharProperty("columnStates", original.states ?? "");
    gFolder.msgDatabase.dBFolderInfo.viewFlags = original.viewFlags;
    gFolder.msgDatabase.dBFolderInfo.sortType = original.sortType;
    gFolder.msgDatabase.dBFolderInfo.sortOrder = original.sortOrder;
    gFolder.msgDatabase.commit(Ci.nsMsgDBCommitType.kLargeCommit);
    window.displayFolder(startFolder.URI);
    await wait(1500);
    record({ label: "restored", folder: gFolder.URI });
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
