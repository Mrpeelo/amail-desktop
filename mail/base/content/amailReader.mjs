/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global commandController */

/**
 * aMail reading pane: the subject (with tags and security info) sits on a
 * bar above the message card, with close and previous/next buttons, like
 * Outlook on the web.
 */

function closeMessage() {
  const about3Pane = window.parent != window ? window.parent : null;
  if (about3Pane?.threadTree) {
    about3Pane.threadTree.selectedIndices = [];
    about3Pane.threadTree.table.body.focus();
    return;
  }
  const top = window.browsingContext.topChromeWindow;
  if (top.document.documentElement.getAttribute("windowtype") == "mail:messageWindow") {
    top.close();
  } else {
    top.document.getElementById("tabmail")?.closeTab();
  }
}

function navigate(command) {
  if (commandController.isCommandEnabled(command)) {
    commandController.doCommand(command);
  }
}

function init() {
  const slot = document.getElementById("amailSubjectSlot");
  slot.append(
    document.getElementById("headerSubjectSecurityContainer"),
    document.getElementById("expandedtagsRow")
  );

  const header = document.getElementById("messageHeader");
  header.classList.add("message-header-show-big-avatar");
  header.classList.remove("message-header-show-sender-full-address");

  document
    .getElementById("amailCloseMessage")
    .addEventListener("click", closeMessage);
  document
    .getElementById("amailPreviousMessage")
    .addEventListener("click", () => navigate("cmd_previousMsg"));
  document
    .getElementById("amailNextMessage")
    .addEventListener("click", () => navigate("cmd_nextMsg"));
}

if (document.readyState == "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
