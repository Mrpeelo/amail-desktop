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
 * Ask scratchpad screen-watch.ps1 (run next to the test) for a capture of the
 * whole screen, which includes open menus.
 */
async function screenShot(name) {
  const dir = PathUtils.profileDir;
  const done = PathUtils.join(dir, "amail-shot-done");
  await IOUtils.remove(done, { ignoreAbsent: true });
  await IOUtils.writeUTF8(PathUtils.join(dir, "amail-shot-request"), name);
  for (let i = 0; i < 25 && !(await IOUtils.exists(done)); i++) {
    await wait(200);
  }
}

/**
 * Save a picture of the main window as amail-debug-<name>.png in the profile.
 */
async function snapshot(
  name,
  win = window.browsingContext.topChromeWindow,
  rect = null
) {
  const top = win;
  const bitmap = await top.browsingContext.currentWindowGlobal.drawSnapshot(
    rect,
    rect ? 2 : 1,
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
  /** Batch A: Conversations button gone, ungrouped default, separator before
   * Reply, no alerts-service errors, reader button sizes. */
  async "batch-a"(record) {
    const top = window.browsingContext.topChromeWindow;
    const { MailServices } = ChromeUtils.importESModule(
      "resource:///modules/MailServices.sys.mjs"
    );
    const errorsBefore = Services.console
      .getMessageArray()
      .map(m => m.message ?? String(m));
    const header = [...document.querySelectorAll("#threadPaneHeaderBar button:not([hidden])")]
      .filter(b => b.getBoundingClientRect().width)
      .map(b => b.textContent.trim() || b.id);
    record({
      label: "list header",
      conversationsButton: !!document.getElementById("amailConversationsButton"),
      buttons: header,
      defaultViewFlags: Services.prefs.getIntPref("mailnews.default_view_flags"),
    });

    const folder = MailServices.accounts.allFolders
      .filter(f => f.getFlag(Ci.nsMsgFolderFlags.Archive) && f.server.type == "imap")
      .sort((a, b) => b.getTotalMessages(false) - a.getTotalMessages(false))[0];
    window.displayFolder(folder.URI);
    await wait(3000);
    const wasThreaded = window.gViewWrapper.showThreaded;
    window.sortController.sortThreaded();
    await wait(1000);
    const threaded = window.gViewWrapper.showThreaded;
    if (!wasThreaded) {
      window.sortController.sortUnthreaded();
      await wait(1000);
    }
    record({ label: "sort menu threading", wasThreaded, threaded, after: window.gViewWrapper.showThreaded });

    const bar = top.document.getElementById("unifiedToolbarContent");
    const sep = item => {
      const li = bar.querySelector(`li[item-id="${item}"]`);
      return li ? top.getComputedStyle(li, "::before").content : "missing";
    };
    record({ label: "separators", delete: sep("delete"), toggleRead: sep("toggle-read"), reply: sep("reply") });

    const identity = MailServices.accounts.defaultAccount.defaultIdentity;
    const eml = [
      "From: Test Sender <sender@example.com>",
      `To: ${identity.email}, colleague@example.com`,
      "Cc: another@example.com",
      "Subject: Reader button sizes",
      `Date: ${new Date().toUTCString()}`,
      "Message-ID: <amail-test-buttons@example.com>",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "Test.",
      "",
    ].join("\r\n");
    const emlPath = PathUtils.join(PathUtils.profileDir, "amail-test-buttons.eml");
    await IOUtils.writeUTF8(emlPath, eml);
    const emlUrl = Services.io.newFileURI(await IOUtils.getFile(emlPath)).spec + "?type=application/x-message-display";
    const tabmail = top.document.getElementById("tabmail");
    tabmail.openTab("mailMessageTab", { messageURI: emlUrl, background: false });
    await wait(3500);
    const msgTab = tabmail.currentTabInfo;
    const metrics = (win, el) => {
      if (!el || !el.getBoundingClientRect().width) {
        return null;
      }
      const cs = win.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const icon = el.querySelector(".button-icon, .toolbarbutton-icon") ??
        el.shadowRoot?.querySelector(".toolbarbutton-icon");
      const text = el.querySelector(".button-label, .toolbarbutton-text") ??
        el.shadowRoot?.querySelector(".toolbarbutton-text");
      const ir = icon?.getBoundingClientRect();
      return {
        w: Math.round(r.width), h: Math.round(r.height),
        font: cs.fontSize, weight: cs.fontWeight, pad: `${cs.paddingTop} ${cs.paddingInlineEnd} ${cs.paddingBottom} ${cs.paddingInlineStart}`,
        border: cs.borderTopWidth, radius: cs.borderTopLeftRadius, bg: cs.backgroundColor, color: cs.color,
        icon: ir ? `${Math.round(ir.width)}x${Math.round(ir.height)}` : null,
        gap: cs.gap,
        textFont: text ? win.getComputedStyle(text).fontSize : null,
        textW: text ? Math.round(text.getBoundingClientRect().width) : null,
      };
    };
    const cmd = {};
    for (const id of ["delete", "flag-message", "reply", "reply-all", "forward-inline"]) {
      cmd[id] = metrics(top, bar.querySelector(`li[item-id="${id}"] .unified-toolbar-button`));
    }
    record({ label: "command bar buttons", cmd });
    const msgWin = msgTab.chromeBrowser.contentWindow;
    const doc = msgWin.document;
    const reader = {};
    for (const id of ["hdrReplyButton", "hdrReplyAllButton", "hdrReplyListButton", "hdrForwardButton", "otherActionsButton"]) {
      const el = doc.getElementById(id);
      reader[id] = metrics(msgWin, el);
      if (reader[id] && el.getAttribute("is") == "toolbarbutton-menu-button") {
        reader[id].inner = metrics(msgWin, el.querySelector(".toolbarbutton-menubutton-button"));
        reader[id].marker = metrics(msgWin, el.querySelector(".toolbarbutton-menubutton-dropmarker"));
      }
    }
    record({ label: "reader buttons", reader, toolbar: doc.getElementById("header-view-toolbar")?.getBoundingClientRect().height });
    const tb = doc.getElementById("header-view-toolbar").getBoundingClientRect();
    const br = msgTab.chromeBrowser.getBoundingClientRect();
    await snapshot("batch-a-reader", top, new top.DOMRect(br.x + tb.x - 40, br.y + tb.y - 30, tb.width + 80, tb.height + 60));
    await snapshot("batch-a-bar", top, new top.DOMRect(0, 0, 1400, 110));
    tabmail.closeTab(msgTab);
    await IOUtils.remove(emlPath);

    const errors = Services.console
      .getMessageArray()
      .map(m => m.message ?? String(m))
      .filter(m => /alerts|MailGlue|msgHdrView/i.test(m));
    record({
      label: "alert errors",
      atStartup: errorsBefore.filter(m => /alerts|MailGlue|msgHdrView/i.test(m)).map(m => m.slice(0, 200)),
      all: errors.map(m => m.slice(0, 200)),
    });
  },

  /** Attachments browser: paperclip opens it, list, filters, sort. */
  async "attachments-browser"(record) {
    const top = window.browsingContext.topChromeWindow;
    top.document.getElementById("amailAttachments").click();
    const browser = top.document.getElementById("amailSettingsBrowser");
    let page = null;
    const started = Date.now();
    for (let i = 0; i < 240; i++) {
      await wait(500);
      const doc = browser.contentDocument;
      if (doc?.location.href.includes("amailAttachments") && doc.getElementById("loading")?.hidden) {
        page = browser.contentWindow;
        break;
      }
    }
    if (!page) {
      record({ label: "ERROR attachments did not load", url: browser.currentURI?.spec });
      return;
    }
    const doc = page.document;
    const api = page.wrappedJSObject.amailAttachments;
    const state = () => ({
      count: doc.getElementById("count").textContent,
      rows: doc.querySelectorAll("#list tbody tr").length,
      first: doc.querySelector("#list tbody tr td:nth-child(2)")?.textContent,
      firstSize: doc.querySelector("#list tbody tr td:nth-child(3)")?.textContent,
    });
    record({
      label: "loaded",
      seconds: Math.round((Date.now() - started) / 1000),
      title: top.document.getElementById("amailSettingsTitle").textContent,
      backHidden: top.document.getElementById("amailSettingsBack").hidden,
      all: api.rows.length,
      pending: doc.getElementById("pending").hidden ? 0 : doc.getElementById("pendingText").textContent,
      ...state(),
      accounts: [...doc.getElementById("account").options].map(o => o.textContent),
    });
    const set = (id, value) => {
      const el = doc.getElementById(id);
      el.value = value;
      el.dispatchEvent(new page.Event(id == "search" ? "input" : "change"));
      return wait(400);
    };
    await set("type", "pdf");
    record({ label: "type pdf", ...state() });
    await set("type", "");
    await set("sort", "largest");
    record({ label: "largest first", ...state() });
    await set("size", "10485760");
    record({ label: "over 10 MB", ...state() });
    await set("size", "0");
    await set("sort", "newest");
    const box = doc.querySelector("#list tbody tr td.pick input");
    box?.click();
    await wait(400);
    record({ label: "one picked", remove: doc.getElementById("remove").textContent, disabled: doc.getElementById("remove").disabled });
    box?.click();
    await snapshot("attachments-browser");
    top.amailSettingsDialog.close();
  },

  /** Search server: button on the global search page, results tab. */
  async "server-search"(record) {
    const top = window.browsingContext.topChromeWindow;
    const tabmail = top.document.getElementById("tabmail");
    const { GlodaMsgSearcher } = ChromeUtils.importESModule(
      "resource:///modules/gloda/GlodaMsgSearcher.sys.mjs"
    );
    const { serverSearchFolders } = ChromeUtils.importESModule(
      "chrome://messenger/content/amailServerSearch.mjs"
    );
    record({ label: "folders", folders: serverSearchFolders().map(f => f.URI) });
    const query = "Patreon";
    tabmail.openTab("glodaFacet", { searcher: new GlodaMsgSearcher(null, query) });
    await wait(5000);
    const facetTab = tabmail.currentTabInfo;
    const facetDoc = facetTab.browser?.contentDocument;
    const button = facetDoc?.getElementById("amail-search-server");
    record({
      label: "facet page",
      button: button?.textContent,
      title: button?.title,
    });
    button?.click();
    let tab = null;
    for (let i = 0; i < 40; i++) {
      await wait(500);
      const current = tabmail.currentTabInfo;
      if (current != facetTab && current.mode.name == "mail3PaneTab") {
        tab = current;
        const win = current.chromeBrowser.contentWindow;
        if (win.gDBView && i > 10) {
          break;
        }
      }
    }
    const win = tab?.chromeBrowser.contentWindow;
    // The server takes its time: wait for the hits to stop coming in.
    let last = -1;
    for (let i = 0; i < 45; i++) {
      await wait(1000);
      const rows = win?.gDBView?.rowCount ?? 0;
      if (i % 5 == 0) {
        record({
          label: `t+${i}s`,
          rows,
          tabs: tabmail.tabInfo.map(t => `${t.mode.name}:${t.title}`),
          searching: win?.gViewWrapper?.searching,
        });
      }
      if (rows && rows == last && i > 8) {
        break;
      }
      last = rows;
    }
    record({
      label: "errors",
      errors: Services.console
        .getMessageArray()
        .filter(m => m instanceof Ci.nsIScriptError && !(m.flags & Ci.nsIScriptError.warningFlag))
        .slice(-8)
        .map(m => `${m.errorMessage} @ ${m.sourceName.split("/").pop()}:${m.lineNumber}`),
      tabs: tabmail.tabInfo.map(t => `${t.mode.name}:${t.title}`),
    });
    record({
      label: "server results",
      title: tab?.title,
      rows: win?.gDBView?.rowCount,
      first: win?.gDBView?.rowCount ? win.gDBView.getMsgHdrAt(0).mime2DecodedSubject.slice(0, 50) : null,
      headerCount: win?.document.getElementById("threadPaneFolderCount")?.textContent,
      renderedRows: win?.document.querySelectorAll("#threadTree tbody tr[is]").length,
      treeRows: win?.threadTree?.view?.rowCount,
      columns: win?.threadPane.columns.filter(c => !c.hidden).map(c => c.id),
    });
    await snapshot("server-search");
    // Close every search and results tab, also ones left by earlier runs.
    for (const t of [...tabmail.tabInfo]) {
      if (t.mode.name == "glodaFacet" || (t.mode.name == "mail3PaneTab" && t != tabmail.tabInfo[0])) {
        tabmail.closeTab(t);
      }
    }
    record({ label: "tabs left", tabs: tabmail.tabInfo.map(t => `${t.mode.name}:${t.title}`) });
  },

  /** Command bar: ported icons, Reply / Reply all / Forward added once. */
  async "command-bar"(record) {
    const top = window.browsingContext.topChromeWindow;
    const items = [...top.document.querySelectorAll("#unifiedToolbarContent > li")].map(li => {
      const icon = li.querySelector(".button-icon");
      return `${li.getAttribute("item-id")}: ${icon ? top.getComputedStyle(icon).content.split("/").pop().slice(0, 20) : "-"}`;
    });
    record({
      label: "command bar",
      items,
      migrated: Services.prefs.getBoolPref("amail.toolbar.replyItemsAdded", false),
      windowIcon: top.document.documentElement.getAttribute("icon"),
    });
    await snapshot("command-bar", top, new top.DOMRect(0, 0, 1400, 110));
  },

  /** Label chips, conversation strip, invitation card. */
  async "reader-batch"(record) {
    const top = window.browsingContext.topChromeWindow;
    const { MailServices } = ChromeUtils.importESModule(
      "resource:///modules/MailServices.sys.mjs"
    );
    const { labelsFor } = ChromeUtils.importESModule(
      "chrome://messenger/content/amailLabels.mjs"
    );

    // "N unread" header: a folder with unread mail.
    const unreadFolder = MailServices.accounts.allFolders.find(
      f => !f.isServer && !f.getFlag(Ci.nsMsgFolderFlags.Virtual) && f.getNumUnread(false) > 0
    );
    if (unreadFolder) {
      window.displayFolder(unreadFolder.URI);
      await wait(2500);
      record({
        label: "unread header",
        unread: unreadFolder.getNumUnread(false),
        shown: document.getElementById("threadPaneFolderCount").textContent,
      });
    }

    // Label chips: Gmail Inbox.
    const inbox = MailServices.accounts.allFolders.find(
      f => f.getFlag(Ci.nsMsgFolderFlags.Archive) && f.server.type == "imap" && f.server.QueryInterface(Ci.nsIImapIncomingServer).isGMailServer && f.getTotalMessages(false) > 0
    );
    window.displayFolder(inbox.URI);
    await wait(3000);
    const view = window.gDBView;
    const sample = [];
    for (let i = 0; i < Math.min(view.rowCount, 200) && sample.length < 5; i++) {
      const hdr = view.getMsgHdrAt(i);
      const labels = labelsFor(hdr);
      if (labels.length) {
        sample.push({ i, raw: hdr.getStringProperty("X-GM-LABELS"), labels });
      }
    }
    const rowsWithChips = [...document.querySelectorAll("#threadTree tbody tr .amail-label-chip")].map(
      c => c.textContent
    );
    record({
      label: "label chips",
      folder: inbox.prettyName,
      firstRaw: view.rowCount ? view.getMsgHdrAt(0).getStringProperty("X-GM-LABELS") : null,
      sample,
      chipsInList: rowsWithChips.slice(0, 8),
    });

    // Find a real conversation (2+ different messages) with Gloda.
    const { Gloda } = ChromeUtils.importESModule(
      "resource:///modules/gloda/GlodaPublic.sys.mjs"
    );
    const conversationSize = hdr =>
      new Promise(resolve => {
        Gloda.getMessageCollectionForHeader(hdr, {
          onItemsAdded() {},
          onItemsModified() {},
          onItemsRemoved() {},
          onQueryCompleted(c) {
            const conv = c.items[0]?.conversation;
            if (!conv) {
              resolve(0);
              return;
            }
            conv.getMessagesCollection({
              onItemsAdded() {},
              onItemsModified() {},
              onItemsRemoved() {},
              onQueryCompleted(m) {
                resolve(new Set(m.items.map(x => x.headerMessageID)).size);
              },
            });
          },
        });
      });
    const sent = MailServices.accounts.allFolders.find(
      f => f.getFlag(Ci.nsMsgFolderFlags.SentMail) && f.server == inbox.server && f.getTotalMessages(false) > 0
    );
    window.displayFolder(sent.URI);
    await wait(3000);
    const sentView = window.gDBView;
    let target = -1;
    let scanned = 0;
    for (let i = 0; i < Math.min(sentView.rowCount, 400) && target < 0; i++) {
      scanned++;
      if ((await conversationSize(sentView.getMsgHdrAt(i))) >= 2) {
        target = i;
      }
    }
    record({ label: "conversation search", scanned, target });
    const aboutMessage = document.getElementById("messageBrowser").contentWindow;
    let found = null;
    if (target >= 0) {
      const hdr = sentView.getMsgHdrAt(target);
      const wasRead = hdr.isRead;
      window.threadTree.selectedIndex = target;
      await wait(2500);
      const strip = aboutMessage.document.getElementById("amailConversation");
      found = {
        shown: !strip.hidden,
        head: strip.querySelector(".amail-conversation-head")?.textContent,
        rows: [...strip.querySelectorAll(".amail-conversation-item")].map(b =>
          [...b.children].map(c => c.textContent.slice(0, 30)).join(" | ") + (b.classList.contains("current") ? "  <current>" : "")
        ),
        readerChips: [...aboutMessage.document.querySelectorAll("#amailReaderLabels .amail-label-chip")].map(c => c.textContent),
      };
      if (!wasRead) {
        hdr.folder.markMessagesRead([hdr], false);
      }
    }
    record({ label: "conversation strip", found });
    if (found) {
      await snapshot("conversation-strip");
      // Clicking another row shows that message.
      const strip = aboutMessage.document.getElementById("amailConversation");
      const other = [...strip.querySelectorAll(".amail-conversation-item")].find(b => !b.classList.contains("current"));
      const before = aboutMessage.gMessage?.messageId;
      other?.click();
      await wait(2000);
      record({
        label: "strip click",
        changed: aboutMessage.gMessage?.messageId != before,
        nowCurrent: aboutMessage.document.querySelector("#amailConversation .current .who")?.textContent,
      });
    }
    window.threadTree.selectedIndices = [];
    await wait(500);

    // Invitation card from a generated invitation email.
    const now = new Date(Date.now() + 3 * 86400000);
    const stamp = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const end = new Date(now.getTime() + 3600000);
    const identity = MailServices.accounts.defaultAccount.defaultIdentity;
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//aMail test//EN", "METHOD:REQUEST",
      "BEGIN:VEVENT", "UID:amail-test-invite-1@example.com", `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(now)}`, `DTEND:${stamp(end)}`, "SUMMARY:Project review",
      "LOCATION:Meeting room 3", "ORGANIZER;CN=Test Organizer:mailto:organizer@example.com",
      `ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${identity.email}`,
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const eml = [
      "From: Test Organizer <organizer@example.com>",
      `To: ${identity.email}`,
      "Subject: Invitation: Project review",
      `Date: ${new Date().toUTCString()}`,
      "Message-ID: <amail-test-invite-1@example.com>",
      "MIME-Version: 1.0",
      'Content-Type: multipart/alternative; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "You are invited.",
      "--b1",
      'Content-Type: text/calendar; charset=UTF-8; method=REQUEST',
      "",
      ics,
      "--b1--",
      "",
    ].join("\r\n");
    const path = PathUtils.join(PathUtils.profileDir, "amail-test-invite.eml");
    await IOUtils.writeUTF8(path, eml);
    const file = await IOUtils.getFile(path);
    const url = Services.io.newFileURI(file).spec + "?type=application/x-message-display";
    const tabmail = top.document.getElementById("tabmail");
    tabmail.openTab("mailMessageTab", { messageURI: url, background: false });
    await wait(4000);
    const tab = tabmail.currentTabInfo;
    const msgWin = tab.chromeBrowser?.contentWindow;
    const bar = msgWin?.document.getElementById("imip-bar");
    const visibleButtons = bar
      ? [...bar.querySelectorAll("toolbarbutton")].filter(b => !b.hidden).map(b => b.label)
      : null;
    record({
      label: "invitation card",
      shown: bar && !bar.collapsed,
      card: bar?.classList.contains("amail-invite"),
      day: msgWin?.document.getElementById("amailInviteDay")?.textContent,
      month: msgWin?.document.getElementById("amailInviteMonth")?.textContent,
      title: msgWin?.document.getElementById("amailInviteTitle")?.textContent,
      when: msgWin?.document.getElementById("amailInviteWhen")?.textContent,
      organizer: msgWin?.document.getElementById("amailInviteOrganizer")?.textContent,
      buttons: visibleButtons,
      accept: (() => {
        const b = msgWin?.document.getElementById("imipAcceptButton");
        if (!b) {
          return null;
        }
        const info = el => {
          const cs = msgWin.getComputedStyle(el);
          return `${el.localName}.${el.className}[${el.hasAttribute("disabled") ? "disabled" : ""}] bg=${cs.backgroundColor} color=${cs.color} op=${cs.opacity} app=${cs.appearance}`;
        };
        return [info(b), ...[...b.querySelectorAll("*")].slice(0, 6).map(info)];
      })(),
    });
    await snapshot("invitation-card");
    tabmail.closeTab(tab);
    await IOUtils.remove(path);
  },

};

export async function runDebugChecks(names) {
  const out = [];
  const file = PathUtils.join(PathUtils.profileDir, "amail-debug.json");
  // Written after every entry, so a check that hangs still shows how far
  // it got.
  const record = entry => {
    out.push(entry);
    IOUtils.writeJSON(file, out).catch(console.error);
  };
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
