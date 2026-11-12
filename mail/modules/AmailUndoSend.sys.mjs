/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * aMail undo send. With a delay set, Send queues the message in the Outbox
 * (marked as queued, so Thunderbird does not send it by itself) and this
 * module sends exactly that message when the delay is over. Until then the
 * main window shows a bar to cancel it, which reopens the message for
 * editing. Pending sends are kept in a pref, so they survive a restart.
 */

const DELAY_PREF = "amail.undo_send.seconds";
const PENDING_PREF = "amail.undo_send.pending";
// Sends that became due while the app was closed wait this long after
// startup, so they can still be cancelled.
const STARTUP_GRACE_MS = 10000;
const CHANGED_TOPIC = "amail-undo-send-changed";

/**
 * @typedef {object} PendingSend
 * @property {string} messageId - The Message-ID, without angle brackets.
 * @property {string} subject
 * @property {number} sendAt - When to send, in ms since the epoch.
 */

/** @type {PendingSend[]} */
let pending = [];
let timer = null;

function stripBrackets(messageId) {
  return messageId.replace(/^<|>$/g, "");
}

function save() {
  Services.prefs.setStringPref(PENDING_PREF, JSON.stringify(pending));
}

function changed() {
  save();
  Services.obs.notifyObservers(null, CHANGED_TOPIC);
  schedule();
}

function load() {
  try {
    pending = JSON.parse(Services.prefs.getStringPref(PENDING_PREF, "[]"));
  } catch (e) {
    pending = [];
  }
  const earliest = Date.now() + STARTUP_GRACE_MS;
  for (const item of pending) {
    item.sendAt = Math.max(item.sendAt, earliest);
  }
}

function sendLater() {
  return Cc["@mozilla.org/messengercompose/sendlater;1"].getService(
    Ci.nsIMsgSendLater
  );
}

/**
 * The queued message for a pending send.
 *
 * @param {PendingSend} item
 * @returns {?{folder: nsIMsgFolder, hdr: nsIMsgDBHdr}}
 */
function findMessage(item) {
  try {
    const folder = sendLater().getUnsentMessagesFolder(null);
    const hdr = folder?.msgDatabase.getMsgHdrForMessageID(item.messageId);
    return hdr ? { folder, hdr } : null;
  } catch (e) {
    console.error(e);
    return null;
  }
}

function deliver(item) {
  const found = findMessage(item);
  if (!found) {
    pending = pending.filter(p => p != item);
    changed();
    return;
  }
  const service = sendLater();
  if (service.sendingMessages || Services.io.offline) {
    // Try again shortly.
    item.sendAt = Date.now() + 2000;
    changed();
    return;
  }
  try {
    service.sendUnsentMessage(found.hdr);
  } catch (e) {
    console.error(e);
    item.sendAt = Date.now() + 5000;
    changed();
    return;
  }
  pending = pending.filter(p => p != item);
  changed();
}

function schedule() {
  if (timer) {
    timer.cancel();
    timer = null;
  }
  if (!pending.length) {
    return;
  }
  const next = Math.min(...pending.map(p => p.sendAt));
  timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
  timer.initWithCallback(
    () => {
      timer = null;
      const now = Date.now();
      const due = pending.filter(p => p.sendAt <= now);
      for (const item of due) {
        deliver(item);
      }
      if (!due.length) {
        schedule();
      }
    },
    Math.max(0, next - Date.now()),
    Ci.nsITimer.TYPE_ONE_SHOT
  );
}

export const AmailUndoSend = {
  CHANGED_TOPIC,

  /** The delay in seconds; 0 sends right away. */
  get delaySeconds() {
    return Math.min(300, Math.max(0, Services.prefs.getIntPref(DELAY_PREF, 0)));
  },

  /** @returns {PendingSend[]} The pending sends, newest first. */
  get pending() {
    return [...pending].sort((a, b) => b.sendAt - a.sendAt);
  },

  /**
   * Called by the compose window once the message is in the Outbox.
   *
   * @param {string} messageId
   * @param {string} subject
   */
  queued(messageId, subject) {
    pending.push({
      messageId: stripBrackets(messageId),
      subject,
      sendAt: Date.now() + this.delaySeconds * 1000,
    });
    changed();
  },

  /**
   * Cancel a pending send and reopen the message for editing. The message
   * stays in the Outbox until it is sent or saved again, so nothing is lost
   * if the compose window is closed.
   *
   * @param {string} messageId
   * @param {Window} win - A main window, to open the compose window from.
   */
  cancel(messageId, win) {
    const item = pending.find(p => p.messageId == messageId);
    if (!item) {
      return;
    }
    pending = pending.filter(p => p != item);
    changed();
    const found = findMessage(item);
    if (found) {
      win.ComposeMessage(
        Ci.nsIMsgCompType.Draft,
        Ci.nsIMsgCompFormat.Default,
        found.folder,
        [found.folder.getUriForMsg(found.hdr)]
      );
    }
  },

  /** @param {string} messageId */
  sendNow(messageId) {
    const item = pending.find(p => p.messageId == messageId);
    if (item) {
      item.sendAt = Date.now();
      changed();
    }
  },
};

load();
if (pending.length) {
  // Let the rest of startup finish first.
  Services.tm.dispatchToMainThread(() => changed());
}
