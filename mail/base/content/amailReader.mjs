/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global commandController */

/**
 * aMail reading pane: the subject (with tags and security info) sits on a
 * row at the top of the message card, with previous/next buttons, like
 * Outlook on the web.
 */

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
