/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * aMail message list column sizing. Replaces Thunderbird's header splitters
 * for the table layout:
 *  - Subject takes the free width, every other text column has a fixed pixel
 *    width that only changes when the user drags it.
 *  - Each text column is resized at the edge facing Subject, where the
 *    column visibly grows or shrinks.
 *  - Widths are stored in one pref and shared by all folders. Sender,
 *    recipient and correspondent share one width.
 *  - If the list gets too narrow, columns are shown narrower without
 *    changing the stored widths.
 */

const PREF = "amail.columns.widths";
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
    if (excess <= 0) {
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
 * Give every text column its drag handles: one inside the column at the edge
 * facing Subject, one inside the neighbouring cell on the other side of the
 * same line. Both stay inside their cell because header cells clip.
 */
function sync() {
  syncPending = false;
  for (const grip of header.querySelectorAll(".amail-col-grip")) {
    grip.remove();
  }
  const cells = visibleCells();
  const subjectIndex = cells.findIndex(th => th.id == SUBJECT_ID);
  for (const [index, th] of cells.entries()) {
    const sized = isSized(th);
    th.classList.toggle("amail-col-sized", sized);
    if (!sized) {
      continue;
    }
    const afterSubject = index > subjectIndex;
    addGrip(th, th, afterSubject ? "start" : "end", afterSubject);
    const neighbour = cells[afterSubject ? index - 1 : index + 1];
    if (neighbour) {
      addGrip(neighbour, th, afterSubject ? "end" : "start", afterSubject);
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
 * @param {HTMLElement} target - Header cell the handle resizes.
 * @param {"start"|"end"} side - Edge of the host the handle sits on.
 * @param {boolean} growsToStart - Whether dragging towards the start of the
 *   row makes the column wider.
 */
function addGrip(host, target, side, growsToStart) {
  const grip = document.createElement("div");
  grip.className = `amail-col-grip amail-col-grip-${side}`;
  grip.addEventListener("pointerdown", event => {
    if (event.button != 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    startDrag(event, grip, target, growsToStart);
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
    delete widths[keyFor(target.id)];
    save();
    layout();
  });
  host.append(grip);
}

function startDrag(event, grip, target, growsToStart) {
  const rtl = getComputedStyle(header).direction == "rtl";
  const sign = growsToStart != rtl ? -1 : 1;
  const startX = event.clientX;
  const startWidth = target.getBoundingClientRect().width;
  const subject = header.querySelector(`#${SUBJECT_ID}:not([hidden])`);
  const room = subject
    ? Math.max(0, subject.getBoundingClientRect().width - SUBJECT_MIN)
    : Infinity;
  const key = keyFor(target.id);
  try {
    grip.setPointerCapture(event.pointerId);
  } catch {}
  header.classList.add("amail-col-resizing");
  grip.classList.add("active");

  const onMove = moveEvent => {
    const wanted = startWidth + sign * (moveEvent.clientX - startX);
    widths[key] = Math.round(
      Math.max(COLUMN_MIN, Math.min(wanted, startWidth + room))
    );
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
  sync();
}
