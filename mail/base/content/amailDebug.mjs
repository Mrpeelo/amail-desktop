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
   * Theme, colors and mark-as-read in Settings are radio buttons that work
   * with a real click.
   */
  async "settings-theme"(record) {
    const top = window.browsingContext.topChromeWindow;
    const browser = top.document.getElementById("amailSettingsBrowser");
    const { AddonManager } = ChromeUtils.importESModule(
      "resource://gre/modules/AddonManager.sys.mjs"
    );
    const activeTheme = async () =>
      (await AddonManager.getAddonsByTypes(["theme"])).find(t => t.isActive)?.id;
    const original = await activeTheme();
    const palette = Services.prefs.getCharPref("amail.theme.palette");
    await wait(6000);
    top.amailSettingsDialog.openSettings("general");
    await wait(2500);
    const page = browser.contentDocument;
    const win = browser.contentWindow;
    const click = input => {
      const r = input.getBoundingClientRect();
      for (const type of ["mousedown", "mouseup"]) {
        win.synthesizeMouseEvent(type, r.x + r.width / 2, r.y + r.height / 2, {
          button: 0,
          clickCount: 1,
        });
      }
    };
    const checked = name => page.querySelector(`input[name=${name}]:checked`)?.value;
    record({
      label: "before",
      original,
      palette,
      themeRadio: checked("themeMode"),
      paletteRadio: checked("palette"),
      markRead: checked("markRead"),
      delayHidden: page.getElementById("markReadDelay").hidden,
    });
    click(page.querySelector("input[name=themeMode][value*=dark]"));
    click(page.querySelector("input[name=palette][value=synthwave]"));
    await wait(2500);
    record({
      label: "after clicking Dark + Synthwave",
      activeTheme: await activeTheme(),
      palette: Services.prefs.getCharPref("amail.theme.palette"),
      themeRadio: checked("themeMode"),
    });
    await (await AddonManager.getAddonByID(original))?.enable();
    Services.prefs.setCharPref("amail.theme.palette", palette);
    record({ label: "restored", activeTheme: await activeTheme() });
    top.amailSettingsDialog.close();
  },
  /**
   * The gear opens the aMail Settings page (tabs, no Thunderbird category
   * rail); every tab renders; All settings and back work.
   */
  async "settings-page"(record) {
    const top = window.browsingContext.topChromeWindow;
    const doc = top.document;
    const modal = doc.getElementById("amailSettingsModal");
    const browser = doc.getElementById("amailSettingsBrowser");
    await wait(8000);
    const since = Date.now();
    doc.getElementById("amailSettings").click();
    await wait(2500);
    const page = () => browser.contentDocument;
    const card = doc.getElementById("amailSettingsCard").getBoundingClientRect();
    record({
      label: "gear",
      modalShown: !modal.hidden,
      url: browser.currentURI?.spec,
      title: doc.getElementById("amailSettingsTitle").textContent,
      backHidden: doc.getElementById("amailSettingsBack").hidden,
      card: `${Math.round(card.width)}x${Math.round(card.height)}`,
      tabs: [...page().querySelectorAll("[role=tab]")].map(t => t.textContent),
      selected: page().querySelector("[aria-selected=true]")?.dataset.tab,
      hash: page().location.hash,
    });
    for (const tab of ["general", "accounts", "signatures", "trusted", "filters", "about"]) {
      page().querySelector(`[data-tab=${tab}]`).click();
      await wait(tab == "about" ? 2000 : 600);
      const panel = page().getElementById(tab);
      record({
        label: `tab ${tab}`,
        shown: !panel.hidden,
        rows: panel.querySelectorAll("tr").length,
        textareas: panel.querySelectorAll("textarea").length,
        text: panel.innerText.replace(/\s+/g, " ").slice(0, 160),
      });
    }
    const strong = page().getElementById("aboutVersion");
    record({
      label: "about version",
      id: strong.getAttribute("data-l10n-id"),
      args: strong.getAttribute("data-l10n-args"),
      text: strong.textContent,
      formatted: await page().l10n.formatValue("amail-settings-about-version", {
        version: "1",
      }),
      tabFormatted: await page().l10n.formatValue("amail-settings-tab-about"),
    });
    page().getElementById("allSettings").click();
    await wait(3000);
    record({
      label: "all settings",
      titleId: doc.getElementById("amailSettingsTitle").getAttribute("data-l10n-id"),
      titleFormatted: await doc.l10n.formatValue("amail-settings-all-title"),
      url: browser.currentURI?.spec,
      title: doc.getElementById("amailSettingsTitle").textContent,
      backHidden: doc.getElementById("amailSettingsBack").hidden,
    });
    doc.getElementById("amailSettingsBack").click();
    await wait(2000);
    record({
      label: "back",
      url: browser.currentURI?.spec,
      selected: page().querySelector("[aria-selected=true]")?.dataset.tab,
    });
    const errors = Services.console
      .getMessageArray()
      .filter(m => m instanceof Ci.nsIScriptError && m.timeStamp >= since)
      .map(m => `${m.errorMessage} @ ${m.sourceName}:${m.lineNumber}`)
      .slice(0, 15);
    record({ label: "console errors", errors });
    top.amailSettingsDialog.close();
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
