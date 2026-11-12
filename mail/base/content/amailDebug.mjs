/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Developer diagnostic for features in progress. Only runs when the
 * AMAIL_DEBUG_CHECKS environment variable lists check names (comma
 * separated); writes amail-debug.json to the profile and quits.
 *
 * Keep only checks for unconfirmed work: remove a check once the feature is
 * confirmed.
 */

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Checks by name. Each receives a function to record results.
 *
 * @type {Record<string, function(function(object): void): Promise<void>>}
 */
const CHECKS = {
  /**
   * Undo send: Send queues the message and shows the bar; Cancel sending
   * reopens it. Uses a fake recipient and never lets it go out.
   */
  async "undo-send"(record) {
    const top = window.browsingContext.topChromeWindow;
    const doc = top.document;
    const { AmailUndoSend } = ChromeUtils.importESModule(
      "resource:///modules/AmailUndoSend.sys.mjs"
    );
    const { MailServices } = ChromeUtils.importESModule(
      "resource:///modules/MailServices.sys.mjs"
    );
    Services.prefs.setIntPref("amail.undo_send.seconds", 30);
    await wait(4000);
    const settings = doc.getElementById("amailSettingsBrowser");
    top.amailSettingsDialog.openSettings("general");
    await wait(2500);
    const select = settings.contentDocument.querySelector(
      "[data-pref='amail.undo_send.seconds']"
    );
    record({
      label: "settings",
      value: select?.value,
      options: [...(select?.options ?? [])].map(o => o.textContent),
    });
    top.amailSettingsDialog.close();

    const subject = `aMail undo send test ${Date.now()}`;
    const composeOpened = new Promise(resolve => {
      const listener = {
        observe(win, topic) {
          if (topic != "domwindowopened") {
            return;
          }
          win.addEventListener(
            "compose-editor-ready",
            () => {
              Services.ww.unregisterNotification(listener);
              resolve(win);
            },
            { once: true }
          );
        },
      };
      Services.ww.registerNotification(listener);
    });
    const params = Cc[
      "@mozilla.org/messengercompose/composeparams;1"
    ].createInstance(Ci.nsIMsgComposeParams);
    params.composeFields = Cc[
      "@mozilla.org/messengercompose/composefields;1"
    ].createInstance(Ci.nsIMsgCompFields);
    params.composeFields.to = "undo-test@example.invalid";
    params.composeFields.subject = subject;
    params.composeFields.body = "Test, never sent.";
    params.identity = MailServices.accounts.defaultAccount.defaultIdentity;
    params.type = Ci.nsIMsgCompType.New;
    params.format = Ci.nsIMsgCompFormat.HTML;
    MailServices.compose.OpenComposeWindowWithParams(null, params);
    const cw = await composeOpened;
    await wait(1500);
    const before = Date.now();
    let sendError = null;
    const steps = [];
    for (const type of [
      "compose-prepare-message-start",
      "beforesend",
      "compose-send-message",
      "aftersend",
    ]) {
      cw.addEventListener(type, () => steps.push(`${Date.now() - before}ms ${type}`));
    }
    cw.SendMessage()
      .then(() => steps.push(`${Date.now() - before}ms SendMessage resolved`))
      .catch(e => (sendError = String(e)));
    await wait(12000);
    const modal = cw.document.getElementById("window-modal-dialog");
    record({
      label: "windows",
      sendError,
      steps,
      undoFlag: cw.gAmailUndoSend,
      consoleApi: Cc["@mozilla.org/consoleAPI-storage;1"]
        .getService(Ci.nsIConsoleAPIStorage)
        .getEvents()
        .filter(e => e.timeStamp >= before && ["warn", "error"].includes(e.level))
        .map(e =>
          [...e.arguments]
            .map(a => (a?.message ? `${a.message} ${a.stack ?? ""}` : String(a)))
            .join(" ")
            .slice(0, 400)
        )
        .slice(0, 8),
      modalOpen: modal?.open,
      modalText: modal?.open
        ? modal.querySelector("browser")?.contentDocument?.body?.textContent
            .replace(/\s+/g, " ")
            .slice(0, 300)
        : null,
      undoGlobal: typeof cw.AmailUndoSend?.queued,
      windows: [...Services.wm.getEnumerator(null)].map(
        w => `${w.document.documentURI.replace(/.*\//, "")} "${w.document.title}"`
      ),
      dialogs: [...Services.wm.getEnumerator(null)].flatMap(w =>
        [...w.document.querySelectorAll("dialog, .dialogBox")].map(
          d => d.textContent.replace(/\s+/g, " ").slice(0, 120)
        )
      ),
      errors: Services.console
        .getMessageArray()
        .filter(m => m instanceof Ci.nsIScriptError && m.timeStamp >= before)
        .map(m => `${m.errorMessage} @ ${m.sourceName.replace(/.*\//, "")}:${m.lineNumber}`)
        .slice(0, 12),
    });
    const bar = doc.getElementById("amailUndoSendBar");
    const outbox = Cc["@mozilla.org/messengercompose/sendlater;1"]
      .getService(Ci.nsIMsgSendLater)
      .getUnsentMessagesFolder(null);
    const item = AmailUndoSend.pending.find(p => p.subject == subject);
    const hdr = item && outbox.msgDatabase.getMsgHdrForMessageID(item.messageId);
    record({
      label: "after Send",
      composeClosed: cw.closed,
      barShown: !bar.hidden,
      barText: bar.textContent,
      layout: (() => {
        const t = bar.querySelector(".amail-undo-send-text")?.getBoundingClientRect();
        const c = bar.querySelector(".amail-undo-send-cancel")?.getBoundingClientRect();
        return t && c
          ? {
              cancelBelowText: c.top >= t.bottom,
              cancelSize: `${Math.round(c.width)}x${Math.round(c.height)}`,
              cancelFont: top.getComputedStyle(bar.querySelector(".amail-undo-send-cancel")).fontSize,
              centred: Math.abs((c.left + c.right) / 2 - (t.left + t.right) / 2) < 2,
            }
          : null;
      })(),
      secondsLeft: item ? Math.round((item.sendAt - Date.now()) / 1000) : null,
      inOutbox: !!hdr,
      queuedFlag: hdr ? !!(hdr.flags & Ci.nsMsgMessageFlags.Queued) : null,
      sentInTime: Date.now() - before,
    });
    if (!item) {
      return;
    }
    const reopened = new Promise(resolve => {
      const listener = {
        observe(win, topic) {
          if (topic == "domwindowopened") {
            win.addEventListener(
              "compose-editor-ready",
              () => {
                Services.ww.unregisterNotification(listener);
                resolve(win);
              },
              { once: true }
            );
          }
        },
      };
      Services.ww.registerNotification(listener);
    });
    bar.querySelector(
      `[data-message-id="${CSS.escape(item.messageId)}"] .amail-undo-send-cancel`
    ).click();
    const draft = await Promise.race([reopened, wait(10000)]);
    await wait(1500);
    record({
      label: "after Cancel sending",
      barHidden: bar.hidden,
      pending: AmailUndoSend.pending.length,
      reopened: !!draft,
      reopenedSubject: draft?.document.getElementById("msgSubject")?.value,
      reopenedTo: draft
        ? [...draft.document.querySelectorAll("#toAddrContainer mail-address-pill")].map(
            p => p.fullAddress
          )
        : null,
      stillInOutbox: !!outbox.msgDatabase.getMsgHdrForMessageID(item.messageId),
    });
    if (draft) {
      draft.gContentChanged = false;
      draft.gMsgCompose.bodyModified = false;
      draft.close();
    }
    const leftover = outbox.msgDatabase.getMsgHdrForMessageID(item.messageId);
    if (leftover) {
      outbox.deleteMessages([leftover], null, true, false, null, false);
    }
    await wait(1500);
    record({
      label: "cleanup",
      outboxClean: !outbox.msgDatabase.getMsgHdrForMessageID(item.messageId),
    });
  },
  /**
   * Subject row inside the message card without a close button, light
   * header buttons, larger date; no offline status button; chat disabled.
   */
  async "reader-card"(record) {
    const about3Pane = window;
    const top = about3Pane.browsingContext.topChromeWindow;
    const { threadTree } = about3Pane;
    record({
      label: "status bar + chat",
      offlineButton: !!top.document.getElementById("offline-status"),
      chatEnabled: Services.prefs.getBoolPref("mail.chat.enabled"),
      chatLocked: Services.prefs.prefIsLocked("mail.chat.enabled"),
      goChatHidden: top.document.getElementById("menu_goChat")?.hidden,
      cmdChatEnabled: top.goUpdateCommand
        ? !top.document.getElementById("cmd_chat").hasAttribute("disabled")
        : "n/a",
    });
    if (!about3Pane.gDBView?.rowCount) {
      record({ label: "no messages in the open folder" });
      return;
    }
    const before = threadTree.selectedIndices;
    const hdr = about3Pane.gDBView.getMsgHdrAt(0);
    const wasRead = hdr.isRead;
    threadTree.selectedIndex = 0;
    await wait(1500);
    const rdoc = about3Pane.document.getElementById("messageBrowser")
      .contentDocument;
    const bar = rdoc.getElementById("amailSubjectBar");
    const box = rdoc.getElementById("messagepanebox");
    const reply = rdoc.getElementById("hdrReplyButton").checkVisibility()
      ? rdoc.getElementById("hdrReplyButton")
      : rdoc.getElementById("hdrReplyToSenderButton");
    const cs = rdoc.defaultView.getComputedStyle(reply);
    record({
      label: "reader card",
      closeButton: !!rdoc.getElementById("amailCloseMessage"),
      barInsideCard: box.contains(bar),
      barTop: Math.round(bar.getBoundingClientRect().top),
      cardTop: Math.round(box.getBoundingClientRect().top),
      subject: rdoc.getElementById("expandedsubjectBox").textContent.slice(0, 60),
      replyBg: cs.backgroundColor,
      replyBorder: `${cs.borderTopWidth} ${cs.borderTopColor}`,
      dateFont: rdoc.defaultView.getComputedStyle(
        rdoc.querySelector(".message-header-datetime")
      ).fontSize,
    });
    threadTree.selectedIndices = before;
    if (!wasRead) {
      hdr.folder.markMessagesRead([hdr], false);
    }
  },
};

export async function runDebugChecks(names) {
  const out = [];
  const record = entry => out.push(entry);
  await wait(4000);
  for (const name of names) {
    const check = CHECKS[name];
    if (!check) {
      record({ label: `ERROR unknown check ${name}` });
      continue;
    }
    try {
      await check(record);
    } catch (error) {
      record({ label: `ERROR ${name}: ${error}`, stack: error.stack });
    }
  }
  await IOUtils.writeJSON(
    PathUtils.join(PathUtils.profileDir, "amail-debug.json"),
    out
  );
  Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
}
