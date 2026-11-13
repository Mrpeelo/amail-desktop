/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global commandController, gMessage */

import {
  labelChips,
  labelsFor,
} from "chrome://messenger/content/amailLabels.mjs";

const { Gloda } = ChromeUtils.importESModule(
  "resource:///modules/gloda/GlodaPublic.sys.mjs"
);
const { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);

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

/**
 * Open a message of the conversation: select it in the list when it is in
 * the open folder, otherwise show it in the reading pane.
 *
 * @param {nsIMsgDBHdr} hdr
 */
function openConversationMessage(hdr) {
  const threePane = parent != top ? parent : null;
  const view = threePane?.gDBView;
  // nsMsgViewIndex_None (0xffffffff) when it is not in the list.
  const index = view?.findIndexOfMsgHdr(hdr, true) ?? 0xffffffff;
  if (index != 0xffffffff) {
    threePane.threadTree.selectedIndex = index;
    threePane.threadTree.scrollToIndex(index, true);
    return;
  }
  const uri = hdr.folder.getUriForMsg(hdr);
  if (threePane?.messagePane) {
    threePane.messagePane.displayMessage(uri);
  } else {
    window.displayMessage(uri);
  }
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "numeric",
  year: "2-digit",
});

let conversationRequest = 0;

/**
 * Other messages of the same conversation (any folder, also Sent), above the
 * message: sender, preview, date. Shown when there is more than one.
 *
 * @param {nsIMsgDBHdr} hdr
 */
function showConversation(hdr) {
  const strip = document.getElementById("amailConversation");
  strip.hidden = true;
  strip.replaceChildren();
  const request = ++conversationRequest;
  // Which copy of a message to show: the open one, then one in the same
  // folder, then one outside All Mail.
  const score = h =>
    h == hdr
      ? 3
      : h.folder == hdr.folder
        ? 2
        : h.folder.getFlag(Ci.nsMsgFolderFlags.Archive)
          ? 0
          : 1;
  const done = items => {
    if (request != conversationRequest) {
      return;
    }
    // Gmail keeps a copy in All Mail: one row per Message-ID.
    const seen = new Map();
    for (const item of items) {
      const folderHdr = item.folderMessage;
      if (!folderHdr) {
        continue;
      }
      const id = folderHdr.messageId;
      const keep = seen.get(id);
      if (!keep || score(folderHdr) > score(keep)) {
        seen.set(id, folderHdr);
      }
    }
    const rows = [...seen.values()].sort((a, b) => a.date - b.date);
    if (rows.length < 2) {
      return;
    }
    const head = document.createElement("div");
    head.className = "amail-conversation-head";
    document.l10n
      .formatValue("amail-reader-conversation", { count: rows.length })
      .then(text => (head.textContent = text));
    strip.append(head);
    for (const row of rows) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "amail-conversation-item";
      button.classList.toggle("current", row.messageId == hdr.messageId);
      button.classList.toggle("unread", !row.isRead);
      const who = document.createElement("span");
      who.className = "who";
      const author = MailServices.headerParser.parseDecodedHeader(
        row.mime2DecodedAuthor
      )[0];
      who.textContent = author?.name || author?.email || row.mime2DecodedAuthor;
      const snip = document.createElement("span");
      snip.className = "snip";
      snip.textContent =
        row.getStringProperty("preview") || row.mime2DecodedSubject;
      const when = document.createElement("span");
      when.className = "when";
      when.textContent = dateFormat.format(new Date(row.date / 1000));
      button.append(who, snip, when);
      button.addEventListener("click", () => openConversationMessage(row));
      strip.append(button);
    }
    strip.hidden = false;
  };
  try {
    Gloda.getMessageCollectionForHeader(hdr, {
      onItemsAdded() {},
      onItemsModified() {},
      onItemsRemoved() {},
      onQueryCompleted(collection) {
        const conversation = collection.items[0]?.conversation;
        if (!conversation || request != conversationRequest) {
          return;
        }
        conversation.getMessagesCollection({
          onItemsAdded() {},
          onItemsModified() {},
          onItemsRemoved() {},
          onQueryCompleted(messages) {
            done(messages.items);
          },
        });
      },
    });
  } catch (error) {
    console.error(error);
  }
}

function onMessageLoading() {
  const labels = document.getElementById("amailReaderLabels");
  labels.replaceChildren(...labelChips(document, labelsFor(gMessage, 10)));
  if (gMessage) {
    showConversation(gMessage);
  }
}

function init() {
  window.addEventListener("MsgLoading", onMessageLoading);
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
