/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global gDBView, threadTree */

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
  const top = window.browsingContext.topChromeWindow;
  await wait(4000);
  out.push(snapshot("start"));

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
      columns: [],
    });
  }

  const origW = top.outerWidth;
  const origH = top.outerHeight;
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
    for (const offset of [-4, -1, 1, 4]) {
      const start = th.getBoundingClientRect();
      const x = start.left + offset;
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
        label: `${id} drag 120px left, pointer ${offset}px from its left edge`,
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
  }

  await IOUtils.writeJSON(
    PathUtils.join(PathUtils.profileDir, "amail-columns-debug.json"),
    out
  );
  Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
}
