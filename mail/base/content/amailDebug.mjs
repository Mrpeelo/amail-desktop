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
   * Mailing list row on the Owlcat newsletter: readable text, raw value in
   * the tooltip, Unsubscribe link.
   */
  async "list-id"(record) {
    const about3Pane = window;
    const { threadTree } = about3Pane;
    const home = about3Pane.gFolder;
    let found = null;
    for (const account of about3Pane.MailServices.accounts.accounts) {
      const inbox = account.incomingServer.rootFolder.getFolderWithFlags(
        Ci.nsMsgFolderFlags.Inbox
      );
      if (!inbox) {
        continue;
      }
      for (const hdr of inbox.messages) {
        if (hdr.mime2DecodedSubject.includes("Dark Heresy Release Date")) {
          found = hdr;
          break;
        }
      }
      if (found) {
        break;
      }
    }
    if (!found) {
      record({ label: "Owlcat message not found" });
      return;
    }
    const wasRead = found.isRead;
    if (about3Pane.gFolder != found.folder) {
      about3Pane.displayFolder(found.folder.URI);
      await wait(2500);
    }
    const before = threadTree.selectedIndices;
    threadTree.selectedIndex = about3Pane.gDBView.findIndexOfMsgHdr(found, true);
    await wait(2500);
    const rdoc = about3Pane.document.getElementById("messageBrowser")
      .contentDocument;
    const row = rdoc.getElementById("expandedlist-idBox");
    const unsub = row.querySelector(".amail-list-unsubscribe");
    record({
      label: "mailing list row",
      rowVisible: !rdoc.getElementById("expandedlist-id").hidden,
      heading: row.heading.textContent,
      value: row.value.textContent,
      tooltip: row.title,
      unsubscribeShown: !unsub.hidden,
      unsubscribeText: unsub.textContent,
      unsubscribeHeader: rdoc.defaultView.currentHeaderData["list-unsubscribe"]
        ?.headerValue.slice(0, 120),
    });
    threadTree.selectedIndices = before;
    if (!wasRead) {
      found.folder.markMessagesRead([found], false);
    }
    if (home && about3Pane.gFolder != home) {
      about3Pane.displayFolder(home.URI);
      await wait(1500);
    }
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
