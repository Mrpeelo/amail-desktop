/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * aMail message list column sizing. Replaces Thunderbird's header splitters
 * for the table layout:
 *  - Subject takes the free width, every other text column has a fixed pixel
 *    width that only changes when the user drags it.
 *  - Dragging the line between two columns moves that line: one column
 *    grows by what the other gives up.
 *  - "Lock columns" removes the handles and never narrows columns.
 *  - Widths are stored in one pref and shared by all folders. Sender,
 *    recipient and correspondent share one width.
 *  - If the list gets too narrow, columns are shown narrower without
 *    changing the stored widths (unless locked).
 */

const PREF = "amail.columns.widths";
const LOCK_PREF = "amail.columns.locked";
const SUBJECT_ID = "subjectCol";
const SUBJECT_MIN = 160;
const COLUMN_MIN = 70;
const WHO_COLUMNS = ["senderCol", "recipientCol", "correspondentCol"];
const DEFAULT_WIDTHS = { who: 220, dateCol: 140, receivedCol: 140 };
const DEFAULT_WIDTH = 110;

let tree;
let header;
let widths = {};
let syncPending = false;
let locked = false;

const keyFor = id => (WHO_COLUMNS.includes(id) ? "who" : id);

const desiredWidth = id =>
  widths[keyFor(id)] ?? DEFAULT_WIDTHS[keyFor(id)] ?? DEFAULT_WIDTH;

function loadWidths() {
  try {
    widths = JSON.parse(Services.prefs.getStringPref(PREF, "{}")) ?? {};
  } catch {
    widths = {};
  }
}

const visibleCells = () =>
  [...header.querySelectorAll("th")].filter(th => !th.hidden);

const isSized = th => th.dataset.type != "icon" && th.id != SUBJECT_ID;

/**
 * Apply the widths to the header cells. Stored widths are used as they are
 * while Subject keeps its minimum; otherwise columns are narrowed for
 * display only, the ones furthest from Subject last.
 */
function layout() {
  const cells = visibleCells();
  const sized = cells.filter(isSized);
  const fixed = cells
    .filter(th => th.dataset.type == "icon")
    .reduce((sum, th) => sum + th.getBoundingClientRect().width, 0);
  const hasSubject = cells.some(th => th.id == SUBJECT_ID);
  const available =
    tree.clientWidth - fixed - (hasSubject ? SUBJECT_MIN : 0);
  const shown = new Map(sized.map(th => [th, desiredWidth(th.id)]));
  let excess = [...shown.values()].reduce((a, b) => a + b, 0) - available;
  for (const th of sized) {
    if (locked || excess <= 0) {
      break;
    }
    const cut = Math.min(excess, shown.get(th) - COLUMN_MIN);
    shown.set(th, shown.get(th) - cut);
    excess -= cut;
  }
  for (const [th, width] of shown) {
    th.style.setProperty("--amail-col-width", `${Math.round(width)}px`);
  }
}

/**
 * Put drag handles on both edges of every text column. A handle moves the
 * line between the column and the nearest text column on that side (icon
 * columns in between are skipped). Each line gets a handle on either side,
 * inside the two cells that touch it, because header cells clip.
 */
function sync() {
  syncPending = false;
  for (const grip of header.querySelectorAll(".amail-col-grip")) {
    grip.remove();
  }
  const cells = visibleCells();
  for (const [index, th] of cells.entries()) {
    const sized = isSized(th);
    th.classList.toggle("amail-col-sized", sized);
    if (!sized) {
      continue;
    }
    for (const [side, step] of [
      ["start", -1],
      ["end", 1],
    ]) {
      let otherIndex = index + step;
      while (cells[otherIndex]?.dataset.type == "icon") {
        otherIndex += step;
      }
      const other = cells[otherIndex];
      if (!other) {
        continue;
      }
      const [before, after] = side == "start" ? [other, th] : [th, other];
      addGrip(th, side, before, after);
      const neighbour = cells[index + step];
      if (!isSized(neighbour)) {
        addGrip(neighbour, side == "start" ? "end" : "start", before, after);
      }
    }
  }
  layout();
}

function requestSync() {
  if (!syncPending) {
    syncPending = true;
    requestAnimationFrame(sync);
  }
}

/**
 * @param {HTMLElement} host - Header cell that contains the handle.
 * @param {"start"|"end"} side - Edge of the host the handle sits on.
 * @param {HTMLElement} before - Text column before the line.
 * @param {HTMLElement} after - Text column after the line.
 */
function addGrip(host, side, before, after) {
  const grip = document.createElement("div");
  grip.className = `amail-col-grip amail-col-grip-${side}`;
  grip.addEventListener("pointerdown", event => {
    if (event.button != 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    startDrag(event, grip, before, after);
  });
  // Keep the header's own handling (sorting, column reordering) away.
  for (const type of ["mousedown", "click", "dragstart"]) {
    grip.addEventListener(type, event => {
      event.preventDefault();
      event.stopPropagation();
    });
  }
  grip.addEventListener("dblclick", event => {
    event.stopPropagation();
    for (const th of [before, after]) {
      delete widths[keyFor(th.id)];
    }
    save();
    layout();
  });
  host.append(grip);
}

/**
 * Move the line between two columns: one grows by what the other gives up.
 * Subject has no stored width; it simply absorbs the change.
 */
function startDrag(event, grip, before, after) {
  const direction = getComputedStyle(header).direction == "rtl" ? -1 : 1;
  const startX = event.clientX;
  const minOf = th => (th.id == SUBJECT_ID ? SUBJECT_MIN : COLUMN_MIN);
  const startBefore = before.getBoundingClientRect().width;
  const startAfter = after.getBoundingClientRect().width;
  const maxShrink = Math.max(0, startBefore - minOf(before));
  const maxGrow = Math.max(0, startAfter - minOf(after));
  try {
    grip.setPointerCapture(event.pointerId);
  } catch {}
  header.classList.add("amail-col-resizing");
  grip.classList.add("active");

  const onMove = moveEvent => {
    const delta = Math.max(
      -maxShrink,
      Math.min(direction * (moveEvent.clientX - startX), maxGrow)
    );
    if (isSized(before)) {
      widths[keyFor(before.id)] = Math.round(startBefore + delta);
    }
    if (isSized(after)) {
      widths[keyFor(after.id)] = Math.round(startAfter - delta);
    }
    layout();
  };
  const onEnd = () => {
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onEnd, true);
    window.removeEventListener("pointercancel", onEnd, true);
    header.classList.remove("amail-col-resizing");
    grip.classList.remove("active");
    save();
  };
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onEnd, true);
  window.addEventListener("pointercancel", onEnd, true);
}

function updateLock() {
  locked = Services.prefs.getBoolPref(LOCK_PREF, false);
  tree.classList.toggle("amail-columns-locked", locked);
  document
    .getElementById("amailLockColumnsButton")
    .setAttribute("aria-pressed", locked);
  layout();
}

function save() {
  Services.prefs.setStringPref(PREF, JSON.stringify(widths));
}

/**
 * @param {HTMLElement} threadTree - The message list tree-view.
 */
export function initAmailColumns(threadTree) {
  tree = threadTree;
  header = threadTree.table.header;
  loadWidths();
  threadTree.classList.add("amail-columns");

  // Columns are shown, hidden and reordered by Thunderbird; follow along.
  new MutationObserver(records => {
    if (
      records.some(
        r =>
          r.type == "attributes" ||
          [...r.addedNodes, ...r.removedNodes].some(
            node => !node.classList?.contains("amail-col-grip")
          )
      )
    ) {
      requestSync();
    }
  }).observe(header, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden"],
  });
  new ResizeObserver(() => layout()).observe(threadTree);
  document
    .getElementById("amailLockColumnsButton")
    .addEventListener("click", () =>
      Services.prefs.setBoolPref(LOCK_PREF, !locked)
    );
  Services.prefs.addObserver(LOCK_PREF, updateLock);
  window.addEventListener("unload", () =>
    Services.prefs.removeObserver(LOCK_PREF, updateLock)
  );
  sync();
  updateLock();
}
