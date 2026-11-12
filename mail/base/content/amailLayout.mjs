/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * aMail vertical layout: the message list keeps its width when the window
 * or the folder pane is resized; only the reading pane changes. The list
 * width changes only when the list/reader splitter is dragged.
 */

const PREF = "amail.layout.listWidth";

let body;
let threadPane;
let folderSplitter;
let messageSplitter;
let listWidth = 0;

const width = element =>
  element.hidden ? 0 : element.getBoundingClientRect().width;

const active = () =>
  body.classList.contains("layout-vertical") &&
  !body.classList.contains("account-central") &&
  !messageSplitter.isCollapsed &&
  width(threadPane) > 0;

function rememberListWidth() {
  if (!active()) {
    return;
  }
  listWidth = Math.round(width(threadPane));
  Services.prefs.setIntPref(PREF, listWidth);
}

function fitReader() {
  if (!active()) {
    return;
  }
  if (!listWidth) {
    rememberListWidth();
    return;
  }
  const messagePane = document.getElementById("messagePane");
  const reader = width(messagePane) + width(threadPane) - listWidth;
  if (Math.abs(width(threadPane) - listWidth) >= 1) {
    messageSplitter.width = Math.max(0, Math.round(reader));
  }
}

export function initAmailLayout() {
  body = document.body;
  threadPane = document.getElementById("threadPane");
  folderSplitter = document.getElementById("folderPaneSplitter");
  messageSplitter = document.getElementById("messagePaneSplitter");

  listWidth = Services.prefs.getIntPref(PREF, 0);

  messageSplitter.addEventListener("splitter-resized", rememberListWidth);
  messageSplitter.addEventListener("splitter-expanded", () =>
    requestAnimationFrame(fitReader)
  );
  folderSplitter.addEventListener("splitter-resized", fitReader);
  folderSplitter.addEventListener("splitter-collapsed", fitReader);
  folderSplitter.addEventListener("splitter-expanded", fitReader);
  new ResizeObserver(fitReader).observe(body);
  new MutationObserver(fitReader).observe(body, {
    attributes: true,
    attributeFilter: ["class"],
  });
}
