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
   * The gear button opens Settings in the dialog and it stays open.
   */
  async "settings-gear"(record) {
    const top = window.browsingContext.topChromeWindow;
    const doc = top.document;
    const modal = doc.getElementById("amailSettingsModal");
    const browser = doc.getElementById("amailSettingsBrowser");
    await wait(8000);
    const since = Date.now();
    record({
      label: "before click",
      dialogGlobal: typeof top.amailSettingsDialog?.open,
      oldGlobalName: String(top.amailSettings),
      gearId: doc.getElementById("amailSettings")?.localName,
    });
    doc.getElementById("amailSettings").click();
    for (const ms of [300, 2000, 6000]) {
      await wait(ms);
      record({
        label: `after click +${ms}`,
        modalShown: !modal.hidden,
        url: browser.currentURI?.spec,
        modalRect: (() => {
          const r = modal.getBoundingClientRect();
          return `${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}`;
        })(),
      });
    }
    const errors = Services.console
      .getMessageArray()
      .filter(m => m instanceof Ci.nsIScriptError && m.timeStamp >= since)
      .map(m => `${m.errorMessage} @ ${m.sourceName}:${m.lineNumber}`)
      .slice(0, 15);
    record({ label: "console errors", errors });
    top.amailSettingsDialog?.close();
  },
  /**
   * Settings open in the dialog over the app (a pane, account settings,
   * back, close), not in a tab.
   */
  async "settings-modal"(record) {
    const top = window.browsingContext.topChromeWindow;
    const doc = top.document;
    const modal = doc.getElementById("amailSettingsModal");
    const browser = doc.getElementById("amailSettingsBrowser");
    const tabsBefore = top.document.getElementById("tabmail").tabInfo.length;
    const prefs = await Promise.race([
      top.openPreferencesTab("paneCompose"),
      wait(15000),
    ]);
    await wait(500);
    const card = doc.getElementById("amailSettingsCard").getBoundingClientRect();
    record({
      label: "settings",
      modalShown: !modal.hidden,
      url: browser.currentURI?.spec,
      resolved: !!prefs,
      pane: browser.contentDocument
        .querySelector("#categories > .category[selected]")
        ?.getAttribute("value"),
      footerLinks: [
        ...browser.contentDocument.querySelectorAll(".sidebar-footer-link"),
      ].map(a => a.id),
      card: `${Math.round(card.width)}x${Math.round(card.height)}`,
      tabsAdded: top.document.getElementById("tabmail").tabInfo.length - tabsBefore,
    });
    top.MsgAccountManager(null);
    await wait(3000);
    record({
      label: "accounts",
      url: browser.currentURI?.spec,
      backShown: !doc.getElementById("amailSettingsBack").hidden,
      title: doc.getElementById("amailSettingsTitle").textContent,
      accounts: browser.contentDocument.getElementById("accounttree")?.rowCount ??
        browser.contentDocument.querySelectorAll("#accounttree li").length,
    });
    doc.getElementById("amailSettingsBack").click();
    await wait(3000);
    record({ label: "back", url: browser.currentURI?.spec });
    modal.dispatchEvent(
      new top.KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
    await wait(500);
    record({
      label: "closed by Esc",
      hidden: modal.hidden,
      url: browser.currentURI?.spec,
      tabsAdded: top.document.getElementById("tabmail").tabInfo.length - tabsBefore,
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
