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
   * The Theme dropdown in Settings opens, stays open and picking Dark
   * switches the theme. Traces what closes it.
   */
  async "settings-theme"(record) {
    const top = window.browsingContext.topChromeWindow;
    const doc = top.document;
    const browser = doc.getElementById("amailSettingsBrowser");
    const { AddonManager } = ChromeUtils.importESModule(
      "resource://gre/modules/AddonManager.sys.mjs"
    );
    const activeTheme = async () =>
      (await AddonManager.getAddonsByTypes(["theme"])).find(t => t.isActive)?.id;
    const original = await activeTheme();
    await wait(6000);
    top.amailSettingsDialog.openSettings("general");
    await wait(2500);
    const page = browser.contentDocument;
    const win = browser.contentWindow;
    const select = page.getElementById("themeMode");
    const t0 = Date.now();
    const trace = [];
    const log = (what, stack) =>
      trace.push(`${Date.now() - t0}ms ${what}${stack ? " <- " + stack : ""}`);
    const dropdown = doc.getElementById("ContentSelectDropdown");
    const shortStack = () =>
      new Error().stack.split("\n").slice(1, 9).map(l => l.replace(/@.*\//, "@")).join(" | ");
    for (const type of ["popupshowing", "popupshown", "popuphidden"]) {
      dropdown?.addEventListener(type, () => log(type), true);
    }
    dropdown?.addEventListener("popuphiding", () => log("popuphiding", shortStack()), true);
    select.addEventListener("focus", () => log("select focus"));
    select.addEventListener("blur", () => log("select blur"));
    select.addEventListener("mozshowdropdown", () => log("mozshowdropdown"));
    top.addEventListener("focus", e => log(`chrome focus ${e.target.id || e.target.localName}`), true);
    top.addEventListener("blur", e => log(`chrome blur ${e.target.id || e.target.localName}`), true);
    const r = select.getBoundingClientRect();
    log(`rect ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    win.synthesizeMouseEvent("mousedown", r.x + 20, r.y + r.height / 2, { button: 0, clickCount: 1 });
    await wait(150);
    win.synthesizeMouseEvent("mouseup", r.x + 20, r.y + r.height / 2, { button: 0, clickCount: 1 });
    await wait(1500);
    const popup = dropdown?.menupopup;
    const pr = popup?.getOuterScreenRect();
    record({
      label: "open theme list",
      original,
      popupState: popup?.state,
      popupRect: pr ? `${Math.round(pr.left)},${Math.round(pr.top)} ${Math.round(pr.width)}x${Math.round(pr.height)}` : null,
      dropdownParent: dropdown?.parentNode?.id || dropdown?.parentNode?.localName,
      trace,
    });
    const dark = popup && [...popup.querySelectorAll("menuitem")].find(m => /dark/i.test(m.label));
    if (dark && popup.state == "open") {
      popup.activateItem(dark);
      await wait(2500);
      record({ label: "after picking Dark", selectValue: select.value, activeTheme: await activeTheme() });
      await (await AddonManager.getAddonByID(original))?.enable();
    }
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
    const t0 = Date.now();
    const trace = [];
    const log = what => trace.push(`${Date.now() - t0}ms ${what}`);
    new top.MutationObserver(() => log(`modal hidden=${modal.hidden}`)).observe(
      modal,
      { attributes: true, attributeFilter: ["hidden"] }
    );
    doc.getElementById("tabmail").registerTabMonitor({
      monitorName: "amailDebug",
      onTabTitleChanged() {},
      onTabSwitched(tab, old) {
        log(`tabSwitched ${old?.mode?.name}->${tab?.mode?.name} same=${tab == old}`);
      },
      onTabOpened(tab) {
        log(`tabOpened ${tab?.mode?.name}`);
      },
      onTabClosing() {},
      onTabPersist() {
        return null;
      },
      onTabRestored() {},
    });
    browser.addProgressListener?.({
      QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
      onLocationChange(wp, req, uri) {
        log(`location ${uri.spec}`);
      },
    });
    log(`dialog global ${typeof top.amailSettingsDialog?.open}`);
    try {
      doc.getElementById("amailSettings").click();
      log("clicked");
    } catch (e) {
      log(`click threw ${e}`);
    }
    await wait(2500);
    record({
      label: "trace",
      trace,
      errors: Services.console
        .getMessageArray()
        .filter(m => m instanceof Ci.nsIScriptError && m.timeStamp >= since)
        .map(m => `${m.errorMessage} @ ${m.sourceName}:${m.lineNumber}`)
        .slice(0, 15),
    });
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
