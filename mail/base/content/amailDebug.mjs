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
 * Save a picture of the main window as amail-debug-<name>.png in the profile.
 */
async function snapshot(name) {
  const top = window.browsingContext.topChromeWindow;
  const bitmap = await top.browsingContext.currentWindowGlobal.drawSnapshot(
    null,
    1,
    "white"
  );
  const canvas = new top.OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  await IOUtils.write(
    PathUtils.join(PathUtils.profileDir, `amail-debug-${name}.png`),
    new Uint8Array(await blob.arrayBuffer())
  );
}

/**
 * Checks by name. Each receives a function to record results.
 *
 * @type {Record<string, function(function(object): void): Promise<void>>}
 */
const CHECKS = {
  /**
   * Writing a new message opens inline in place of the message list and
   * reader, not in a window; closing brings the list back.
   */
  async "inline-compose"(record) {
    const top = window.browsingContext.topChromeWindow;
    const { MailServices } = ChromeUtils.importESModule(
      "resource:///modules/MailServices.sys.mjs"
    );
    await wait(5000);
    const windowsBefore = [...Services.wm.getEnumerator(null)].length;
    const since = Date.now();
    top.goDoCommand("cmd_newMessage");
    await wait(6000);
    const host = document.getElementById("amailCompose");
    const browser = document.getElementById("amailComposeBrowser");
    const cw = browser?.contentWindow;
    const rect = el => {
      const r = el?.getBoundingClientRect();
      return r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` : null;
    };
    record({
      label: "new message",
      windowsOpened: [...Services.wm.getEnumerator(null)].length - windowsBefore,
      hostShown: host && !host.hidden,
      hostRect: rect(host),
      folderPaneRect: rect(document.getElementById("folderPane")),
      threadPaneShown: document.getElementById("threadPane").checkVisibility(),
      messagePaneShown: document.getElementById("messagePane").checkVisibility(),
      url: browser?.currentURI?.spec,
      composeReady: !!cw?.gMsgCompose,
      inlineAttr: cw?.document.documentElement.hasAttribute("amail-inline"),
      titlebarShown: cw?.document.getElementById("titlebar")?.checkVisibility(),
      focused: cw?.document.activeElement?.id || cw?.document.activeElement?.localName,
      identity: cw?.document.getElementById("msgIdentity")?.value,
      errors: Services.console
        .getMessageArray()
        .filter(m => m instanceof Ci.nsIScriptError && m.timeStamp >= since && !(m.flags & 1))
        .map(m => `${m.errorMessage} @ ${m.sourceName.replace(/.*\//, "")}:${m.lineNumber}`)
        .slice(0, 10),
    });
    await snapshot("inline-compose");
    if (!cw) {
      return;
    }
    const to = cw.document.getElementById("toAddrInput");
    to.value = "first@example.invalid, second@example.invalid";
    cw.recipientAddPills(to);
    cw.document.getElementById("addr_ccShowAddressRowButton").click();
    cw.document.getElementById("msgSubject").value = "A subject";
    cw.updateSendLock?.();
    cw.goUpdateCommand?.("cmd_sendButton");
    await wait(1500);
    await snapshot("inline-compose-filled");
    cw.gContentChanged = false;
    cw.gMsgCompose.bodyModified = false;
    for (const pill of cw.document.querySelectorAll("mail-address-pill")) {
      pill.remove();
    }
    cw.document.getElementById("msgSubject").value = "";
    cw.gAmailInlineHost.close();
    await wait(2500);
    record({
      label: "closed",
      hostHidden: host.hidden,
      browserGone: !document.getElementById("amailComposeBrowser"),
      threadPaneShown: document.getElementById("threadPane").checkVisibility(),
      windows: [...Services.wm.getEnumerator(null)].length - windowsBefore,
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
