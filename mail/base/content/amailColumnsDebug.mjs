/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global displayFolder, gDBView, gFolder, gViewWrapper, MailServices, threadTree */

// Developer diagnostic for message list column sizing. Only runs when the
// AMAIL_DEBUG_COLUMNS environment variable is set; writes
// amail-columns-debug.json to the profile and quits.

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function snapshot(label) {
  const table = threadTree.table;
  const header = table.header;
  const cells = [...header.querySelectorAll("th")].filter(th => !th.hidden);
  return {
    label,
    tableWidth: table.getBoundingClientRect().width,
    tableLayout: getComputedStyle(table).tableLayout,
    tableStyleWidth: getComputedStyle(table).width,
    paneWidth: document.getElementById("threadPane").getBoundingClientRect()
      .width,
    columns: cells.map(th => {
      const splitter = th.querySelector("hr");
      return {
        id: th.id,
        rect: Math.round(th.getBoundingClientRect().width),
        inlineStyleWidth: th.style.width,
        computedWidth: getComputedStyle(th).width,
        cssVar: th.style.getPropertyValue(`--${th.id}Splitter-width`),
        resizable: th.resizable,
        lastColumn: th.classList.contains("last-column"),
        splitterDisabled: splitter?.isDisabled,
        splitterDisplay: splitter ? getComputedStyle(splitter).display : null,
        splitterWidthProp: splitter?.width,
      };
    }),
  };
}

export async function runColumnsDebug() {
  const out = [];
  try {
    await runChecks(out);
  } catch (error) {
    out.push({ label: `ERROR ${error}`, stack: error.stack, columns: [] });
  }
  await IOUtils.writeJSON(
    PathUtils.join(PathUtils.profileDir, "amail-columns-debug.json"),
    out
  );
  Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
}

async function runChecks(out) {
  const top = window.browsingContext.topChromeWindow;
  await wait(4000);
  // Needs a message list: leave Account Central for the default Inbox.
  if (!gFolder || gFolder.isServer) {
    const inbox =
      MailServices.accounts.defaultAccount?.incomingServer.rootFolder.getFolderWithFlags(
        Ci.nsMsgFolderFlags.Inbox
      );
    out.push({ label: `opened inbox (was account central)`, columns: [] });
    displayFolder(inbox.URI);
    await wait(3000);
  }
  out.push(snapshot("start"));
  {
    const button = document.getElementById("amailColumnsButton");
    const popup = threadTree.querySelector(".menupopup-column-picker");
    const shown = new Promise(resolve =>
      popup.addEventListener("popupshown", resolve, { once: true })
    );
    button.click();
    await Promise.race([shown, wait(2000)]);
    const items = [...popup.querySelectorAll("menuitem[name='toggle']")].map(
      item => item.value
    );
    popup.hidePopup();
    out.push({
      label: "select columns button",
      buttonVisible: !button.hidden && button.getBoundingClientRect().width > 0,
      nextToCompact:
        button.nextElementSibling?.id == "amailCompactButton",
      popupOpened: popup.state != "closed" || items.length > 0,
      menuItems: items,
      threadColumnPresent: !!document.getElementById("threadCol"),
      headerPickersVisible: [
        ...threadTree.table.header.querySelectorAll(".button-column-picker"),
      ].filter(b => getComputedStyle(b).display != "none").length,
      columns: [],
    });
  }

  {
    const button = document.getElementById("amailSortButton");
    const popup = document.getElementById("menu_threadPaneSortPopup");
    const shown = new Promise(resolve =>
      popup.addEventListener("popupshown", resolve, { once: true })
    );
    button.click();
    await Promise.race([shown, wait(2000)]);
    out.push({
      label: "sort button",
      nextToColumns: button.nextElementSibling?.id == "amailColumnsButton",
      popupState: popup.state,
      checked: [...popup.querySelectorAll("menuitem[checked]")].map(
        item => item.getAttribute("value")
      ),
      columns: [],
    });
    popup.hidePopup();
    await wait(300);

    // Saved sorts: apply a test sort from the menu, then restore.
    const original = {
      name: "zz original",
      column: gViewWrapper.primarySortColumnId,
      ascending: gViewWrapper.isSortedAscending,
      mode: gViewWrapper.showGroupedBySort
        ? "group"
        : gViewWrapper.showThreaded
          ? "threaded"
          : "unthreaded",
      viewFlags: gViewWrapper.dbView.viewFlags,
      sortType: gViewWrapper.dbView.sortType,
      sortOrder: gViewWrapper.dbView.sortOrder,
    };
    const savedPresets = Services.prefs.getStringPref("amail.sort.presets", "");
    const test = {
      ...original,
      name: "aa test",
      column: original.column == "subjectCol" ? "dateCol" : "subjectCol",
      ascending: !original.ascending,
    };
    Services.prefs.setStringPref(
      "amail.sort.presets",
      JSON.stringify([test, original])
    );
    const applyFromMenu = async index => {
      const opened = new Promise(resolve =>
        popup.addEventListener("popupshown", resolve, { once: true })
      );
      button.click();
      await Promise.race([opened, wait(2000)]);
      const menu = document.getElementById("amailSortPresetsMenu");
      const presetMenu = menu.querySelector("menupopup").children[index];
      presetMenu.querySelector("menuitem").doCommand();
      popup.hidePopup();
      await wait(800);
      return {
        presetsMenuDisabled: menu.disabled,
        presetLabels: [...menu.querySelector("menupopup").children].map(m =>
          m.getAttribute("label")
        ),
        sortedBy: gViewWrapper.primarySortColumnId,
        ascending: gViewWrapper.isSortedAscending,
      };
    };
    out.push({
      label: "saved sort applied",
      wanted: `${test.column} ascending=${test.ascending}`,
      ...(await applyFromMenu(0)),
      saveItem: !!document.getElementById("amailSortSave"),
      columns: [],
    });
    out.push({
      label: "original sort restored",
      wanted: `${original.column} ascending=${original.ascending}`,
      ...(await applyFromMenu(1)),
      columns: [],
    });
    if (savedPresets) {
      Services.prefs.setStringPref("amail.sort.presets", savedPresets);
    } else {
      Services.prefs.clearUserPref("amail.sort.presets");
    }

    const dialog = window.browsingContext.topChromeWindow.openDialog(
      "chrome://messenger/content/amailSortApply.xhtml",
      "",
      "chrome,centerscreen,resizable",
      { presetName: "test", result: { uris: [] } }
    );
    await new Promise(resolve =>
      dialog.addEventListener("load", resolve, { once: true })
    );
    await wait(1000);
    out.push({
      label: "apply dialog",
      folders: dialog.document.querySelectorAll("label.folder").length,
      accounts: dialog.document.querySelectorAll("#folderList h2").length,
      heading: dialog.document.getElementById("heading").textContent,
      size: `${dialog.outerWidth}x${dialog.outerHeight}`,
      columns: [],
    });
    dialog.close();

    const date = threadTree.querySelector("tr.table-layout td.datecol-column");
    const sender = threadTree.querySelector(
      "tr.table-layout td.sendercol-column"
    );
    out.push({
      label: "date font",
      dateAlign: date && getComputedStyle(date).textAlign,
      headerAlign: getComputedStyle(
        document.querySelector("th#dateCol button")
      ).textAlign,
      date: date && `${getComputedStyle(date).fontSize} ${getComputedStyle(date).color}`,
      sender:
        sender &&
        `${getComputedStyle(sender).fontSize} ${getComputedStyle(sender).color}`,
      columns: [],
    });
  }

  // Selecting marks the message read; remember and restore that state.
  const firstHdr = gDBView?.rowCount ? gDBView.getMsgHdrAt(0) : null;
  const wasRead = firstHdr?.isRead;
  threadTree.selectedIndex = 0;
  threadTree.table.body.focus();
  await wait(800);
  const row = threadTree.table.body.querySelector(".table-layout.selected");
  if (firstHdr && !wasRead) {
    firstHdr.folder.markMessagesRead([firstHdr], false);
  }
  if (row) {
    const subject = row.querySelector(".subjectcol-column");
    out.push({
      label: "selected row colors",
      rowBackground: getComputedStyle(row).backgroundColor,
      rowColor: getComputedStyle(row).color,
      subjectColor: subject && getComputedStyle(subject).color,
      unread: row.dataset.properties,
      treeFocused: threadTree.contains(document.activeElement),
      activeElement: document.activeElement?.localName,
      topActive: top.document.activeElement?.id,
      rowClass: row.className,
      columns: [],
    });
  }

  {
    const popup = threadTree.querySelector(".menupopup-column-picker");
    const shown = new Promise(resolve =>
      popup.addEventListener("popupshown", resolve, { once: true })
    );
    document.getElementById("amailColumnsButton").click();
    await Promise.race([shown, wait(2000)]);
    const item = popup.querySelector("menuitem[name='toggle']:not([disabled])");
    item?.setAttribute("_moz-menuactive", "true");
    const other = item?.nextElementSibling;
    const reader = document.getElementById("messageBrowser");
    const card = reader?.contentDocument?.getElementById("messagepanebox");
    const readerTop =
      card && !reader.hidden
        ? reader.getBoundingClientRect().top +
          card.getBoundingClientRect().top
        : null;
    out.push({
      label: "menu and panes",
      menuBackground: getComputedStyle(popup).getPropertyValue(
        "--panel-background-color"
      ),
      hoverBackground: item && getComputedStyle(item).backgroundColor,
      hoverText: item && getComputedStyle(item).color,
      normalBackground: other && getComputedStyle(other).backgroundColor,
      listTop: document.getElementById("threadPane").getBoundingClientRect()
        .top,
      readerTop,
      splitterBorder: getComputedStyle(
        document.getElementById("messagePaneSplitter")
      ).borderInlineStartColor,
      columns: [],
    });
    item?.removeAttribute("_moz-menuactive");
    popup.hidePopup();
  }

  const origW = top.outerWidth;
  const origH = top.outerHeight;
  const panes = label => ({
    label,
    list: Math.round(document.getElementById("threadPane").getBoundingClientRect().width),
    reader: Math.round(document.getElementById("messagePane").getBoundingClientRect().width),
    window: top.outerWidth,
    columns: [],
  });
  out.push(panes("panes at start"));
  top.resizeTo(Math.max(1000, origW - 300), origH);
  await wait(1500);
  out.push(panes("panes, window narrower by 300"));
  top.resizeTo(origW, origH);
  await wait(1500);
  out.push(panes("panes, window restored"));
  top.resizeTo(Math.max(1000, origW - 600), origH);
  await wait(1500);
  out.push(snapshot("window narrower by 600"));
  top.resizeTo(origW, origH);
  await wait(1500);
  out.push(snapshot("window restored"));

  const body = document.body;
  const before = body.style.getPropertyValue("--messagePaneSplitter-width");
  body.style.setProperty("--messagePaneSplitter-width", "300px");
  await wait(800);
  out.push(snapshot("reader 300px"));
  body.style.setProperty("--messagePaneSplitter-width", "900px");
  await wait(800);
  out.push(snapshot("reader 900px"));
  if (before) {
    body.style.setProperty("--messagePaneSplitter-width", before);
  } else {
    body.style.removeProperty("--messagePaneSplitter-width");
  }
  await wait(800);

  for (const id of ["senderCol", "dateCol", "correspondentCol"]) {
    const th = document.getElementById(id);
    const splitter = th?.querySelector("hr");
    if (!splitter || th.hidden) {
      continue;
    }
    // Hit-test both sides of the column's left edge like a real pointer.
    const savedWidths = Services.prefs.getStringPref("amail.columns.widths", "");
    for (const [edge, offset, locked] of [
      ["left", -4],
      ["left", 4],
      ["right", -4],
      ["right", 4],
      ["left", 4, true],
    ]) {
      Services.prefs.setStringPref(
        "amail.columns.lockedColumns",
        locked ? '["who"]' : "[]"
      );
      // The module reads locks at startup and on menu use; drive the menu.
      if (locked) {
        th.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
        await wait(700);
        const item = document.getElementById("amailLockColumn");
        out.push({
          label: `${id} menu item present: ${!!item}`,
          columns: [],
        });
        item?.click();
        item?.closest("menupopup").hidePopup();
      }
      await wait(200);
      const start = th.getBoundingClientRect();
      const x = start[edge] + offset;
      const y = start.top + start.height / 2;
      const hit = document.elementFromPoint(x, y);
      const pointer = (target, type, clientX) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button: 0,
            buttons: 1,
            pointerId: 1,
            clientX,
            clientY: y,
          })
        );
      pointer(hit, "pointerdown", x);
      pointer(hit, "pointermove", x - 60);
      pointer(hit, "pointermove", x - 120);
      pointer(hit, "pointerup", x - 120);
      await wait(300);
      const end = th.getBoundingClientRect();
      out.push({
        label: `${id} drag 120px left, pointer ${offset}px from its ${edge} edge${locked ? ", LOCKED" : ""}`,
        rightBefore: Math.round(start.right),
        rightAfter: Math.round(end.right),
        dateWidth: Math.round(
          document.getElementById("dateCol").getBoundingClientRect().width
        ),
        hit: `${hit?.localName}.${hit?.className} in ${hit?.closest("th")?.id}`,
        widthBefore: Math.round(start.width),
        widthAfter: Math.round(end.width),
        leftBefore: Math.round(start.left),
        leftAfter: Math.round(end.left),
        columns: [],
      });
      if (savedWidths) {
        Services.prefs.setStringPref("amail.columns.widths", savedWidths);
      } else {
        Services.prefs.clearUserPref("amail.columns.widths");
      }
    }
    Services.prefs.clearUserPref("amail.columns.lockedColumns");
  }

}
