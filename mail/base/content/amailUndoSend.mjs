/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The undo send bar at the bottom centre of the main window: one row per
 * pending send with a countdown and "Cancel sending".
 */

const { AmailUndoSend } = ChromeUtils.importESModule(
  "resource:///modules/AmailUndoSend.sys.mjs"
);

const bar = document.getElementById("amailUndoSendBar");
let ticker = null;

function secondsLeft(item) {
  return Math.max(0, Math.ceil((item.sendAt - Date.now()) / 1000));
}

function row(item) {
  const node = document.createElement("div");
  node.className = "amail-undo-send";
  node.dataset.messageId = item.messageId;

  const text = document.createElement("span");
  text.className = "amail-undo-send-text";
  const countdown = document.createElement("span");
  countdown.className = "amail-undo-send-countdown";
  const subject = document.createElement("span");
  subject.className = "amail-undo-send-subject";
  subject.textContent = item.subject;
  text.append(countdown, " · ", subject);

  const cancel = document.createElement("button");
  cancel.className = "amail-undo-send-cancel";
  document.l10n.setAttributes(cancel, "amail-undo-send-cancel");
  cancel.addEventListener("click", () =>
    AmailUndoSend.cancel(item.messageId, window)
  );

  node.append(text, cancel);
  return node;
}

function tick() {
  const items = AmailUndoSend.pending;
  for (const node of bar.children) {
    const item = items.find(p => p.messageId == node.dataset.messageId);
    if (item) {
      document.l10n.setAttributes(
        node.querySelector(".amail-undo-send-countdown"),
        "amail-undo-send-countdown",
        { seconds: secondsLeft(item) }
      );
    }
  }
}

function render() {
  const items = AmailUndoSend.pending;
  bar.replaceChildren(...items.map(row));
  bar.hidden = !items.length;
  tick();
  if (items.length && !ticker) {
    ticker = setInterval(tick, 500);
  } else if (!items.length && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

const observer = { observe: render };
Services.obs.addObserver(observer, AmailUndoSend.CHANGED_TOPIC);
window.addEventListener("unload", () =>
  Services.obs.removeObserver(observer, AmailUndoSend.CHANGED_TOPIC)
);
render();
