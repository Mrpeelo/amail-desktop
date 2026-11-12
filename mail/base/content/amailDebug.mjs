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
  /** Chat is gone: no space, tab type, menus or modules; reply placement. */
  async "no-chat"(record) {
    const top = window.browsingContext.topChromeWindow;
    const doc = top.document;
    const { MailServices } = ChromeUtils.importESModule(
      "resource:///modules/MailServices.sys.mjs"
    );
    const exists = async url => {
      try {
        await fetch(url);
        return true;
      } catch {
        return false;
      }
    };
    const identity = MailServices.accounts.defaultAccount.defaultIdentity;
    record({
      label: "chat",
      leftovers: [
        "chatButton",
        "spacesPopupButtonChat",
        "menu_goChat",
        "imAccountsStatus",
        "joinChatMenuItem",
        "newIMAccountMenuItem",
        "newIMContactMenuItem",
        "chatTabPanel",
        "appmenu_newIMAccountMenuItem",
      ].filter(id => doc.getElementById(id)),
      tabModes: Object.keys(doc.getElementById("tabmail").tabModes).filter(m =>
        /chat/i.test(m)
      ),
      chatModule: await exists("resource:///modules/IMServices.sys.mjs"),
      chatContent: await exists("chrome://chat/content/conv.html"),
      imServerType: "@mozilla.org/messenger/server;1?type=im" in Cc,
      replyOnTop: identity.replyOnTop,
      sigBottom: identity.sigBottom,
    });
  },

  /** Tasks are gone: no Tasks space, tab, Today Pane list or menu items. */
  async "no-tasks"(record) {
    const top = window.browsingContext.topChromeWindow;
    const doc = top.document;
    const errors = () =>
      Services.console
        .getMessageArray()
        .filter(m => m instanceof Ci.nsIScriptError && !(m.flags & Ci.nsIScriptError.warningFlag))
        .filter(m => /^(chrome|resource):/.test(m.sourceName))
        .map(m => `${m.errorMessage} @ ${m.sourceName.split("/").pop()}:${m.lineNumber}`);
    const startErrors = errors();
    record({ label: "startup errors", errors: startErrors });
    record({
      label: "elements",
      spaces: top.gSpacesToolbar.spaces.map(s => s.name),
      leftovers: [
        "tasksButton",
        "spacesPopupButtonTasks",
        "todo-tab-panel",
        "calendar-task-box",
        "calNewTask2",
        "calMenuSwitchToTask",
        "taskitem-context-menu",
        "calendar-new-task-menuitem",
        "appmenu_calendar-new-task-menu-item",
        "calTasksMenu",
        "sidePanelNewTask",
        "today-pane-cycler-next",
      ].filter(id => doc.getElementById(id)),
      tabModes: Object.keys(doc.getElementById("tabmail").tabModes).filter(m => /task/i.test(m)),
      newTodoEnabled: top.calendarController.isCommandEnabled("calendar_new_todo_command"),
      mailContextTask: !!document.getElementById("mailContext-calendar-convert-task-menuitem"),
    });
    const tabmail = doc.getElementById("tabmail");
    tabmail.openTab("calendar");
    await wait(2500);
    const pane = doc.getElementById("today-pane-panel");
    pane.setVisible(true, true, true);
    top.TodayPane.updateDisplay();
    await wait(1000);
    const menu = doc.getElementById("menu_Event_Task_Popup");
    record({
      label: "calendar tab",
      mode: top.gCurrentMode,
      tasksInView: top.currentView().tasksInView,
      todayHeader: doc.getElementById("today-pane-header").getAttribute("value"),
      eventsMenu: [...menu.children]
        .filter(i => i.localName != "menuseparator")
        .map(i => i.label || i.getAttribute("data-l10n-id") || i.id),
      viewContext: [...doc.getElementById("calendar-view-context-menu").children].map(i => i.id),
    });
    await snapshot("no-tasks-calendar");
    tabmail.closeTab(tabmail.currentTabInfo);
    await wait(1000);
    record({
      label: "new errors",
      errors: errors().filter(e => !startErrors.includes(e)),
    });
  },

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
    record({
      label: "from row",
      fromInToolbar: !!cw.document.querySelector("#composeToolbar2 #msgIdentity"),
      sendRect: rect(cw.document.getElementById("button-send")),
      fromRect: rect(cw.document.getElementById("msgIdentity")),
      toRect: rect(cw.document.getElementById("toAddrContainer")),
      attachRect: rect(cw.document.getElementById("button-attach")),
      encryptRect: rect(cw.document.getElementById("button-encryption")),
      ccStyle: (() => {
        const cs = cw.getComputedStyle(
          cw.document.getElementById("addr_ccShowAddressRowButton")
        );
        return `${cs.borderTopWidth} ${cs.borderTopLeftRadius} ${cs.backgroundColor}`;
      })(),
      replyToShown: cw.document
        .getElementById("addr_replyShowAddressRowMenuItem")
        .checkVisibility(),
      moreButtonHidden: cw.document.getElementById("extraAddressRowsMenuButton").hidden,
    });

    // A second new message while the first is untouched: replaced in place.
    const first = browser;
    top.goDoCommand("cmd_newMessage");
    await wait(5000);
    const second = document.getElementById("amailComposeBrowser");
    record({
      label: "second new message (first untouched)",
      windowsOpened: [...Services.wm.getEnumerator(null)].length - windowsBefore,
      replaced: !!second && second != first,
      firstGone: !first.isConnected,
      ready: !!second?.contentWindow?.gMsgCompose,
    });

    // A third while the second has changes: it must be saved to Drafts and
    // closed. The save itself is stubbed, nothing is written to the mailbox.
    const cw2 = second.contentWindow;
    const to = cw2.document.getElementById("toAddrInput");
    to.value = "first@example.invalid, second@example.invalid";
    cw2.recipientAddPills(to);
    cw2.document.getElementById("msgSubject").value = "A subject";
    cw2.gContentChanged = true;
    await wait(1000);
    await snapshot("inline-compose-filled");
    let saveCalls = 0;
    let closeAfterSave = null;
    cw2.SaveAsDraft = () => {
      saveCalls++;
      closeAfterSave = cw2.gCloseWindowAfterSave;
      cw2.SetContentAndBodyAsUnmodified();
      cw2.amailCloseCompose();
    };
    top.goDoCommand("cmd_newMessage");
    await wait(5000);
    const third = document.getElementById("amailComposeBrowser");
    record({
      label: "third new message (second edited)",
      windowsOpened: [...Services.wm.getEnumerator(null)].length - windowsBefore,
      saveToDraftsCalls: saveCalls,
      closeAfterSave,
      replaced: !!third && third != second,
      secondGone: !second.isConnected,
      newSubject: third?.contentWindow?.document.getElementById("msgSubject")?.value,
    });
    const cw3 = third?.contentWindow;
    if (cw3) {
      cw3.amailShowDraftSaved();
      await wait(800);
      const doc3 = cw3.document;
      record({
        label: "band below subject",
        parts: [
          "MsgHeadersToolbar",
          "recipientsContainer",
          "subject-box",
          "msgSubjectContainer",
          "FormatToolbox",
          "FormatToolbar",
          "headersSplitter",
          "messageArea",
        ].map(id => `${id} ${rect(doc3.getElementById(id))}`),
        headersRows: cw3.getComputedStyle(doc3.getElementById("MsgHeadersToolbar"))
          .gridTemplateRows,
        contentRows: cw3.getComputedStyle(doc3.getElementById("composeContentBox"))
          .gridTemplateRows,
        headersBox: (() => {
          const cs = cw3.getComputedStyle(doc3.getElementById("MsgHeadersToolbar"));
          return `pad ${cs.paddingTop}/${cs.paddingBottom} min ${cs.minHeight} h ${cs.height} align ${cs.alignContent} display ${cs.display}`;
        })(),
        subjectBox: (() => {
          const cs = cw3.getComputedStyle(doc3.getElementById("subject-box"));
          return `margin ${cs.marginTop}/${cs.marginBottom} min ${cs.minHeight}`;
        })(),
        headersChildren: [...doc3.getElementById("MsgHeadersToolbar").children].map(
          c => `${c.id || c.localName} ${rect(c)}`
        ),
        draftSaved: doc3.getElementById("amailDraftSaved")?.textContent,
      });
      await snapshot("inline-compose-draft-saved");

      // Pop out the untouched message into a window.
      const opened = new Promise(resolve => {
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
      document.getElementById("amailComposePopOut").click();
      const popped = await Promise.race([opened, wait(10000)]);
      await wait(2000);
      record({
        label: "pop out",
        windowOpened: !!popped,
        inlineClosed: !document.getElementById("amailComposeBrowser"),
        listBack: document.getElementById("threadPane").checkVisibility(),
        formatOnTop: popped
          ? popped.document.getElementById("FormatToolbox").getBoundingClientRect().top <
            popped.document.getElementById("composeToolbar2").getBoundingClientRect().top
          : null,
        menubarHidden: popped
          ? !popped.document.getElementById("compose-toolbar-menubar2").checkVisibility()
          : null,
      });
      if (popped) {
        popped.resizeTo(1400, 900);
        await wait(1500);
        await snapshot("compose-window", popped);
        popped.gContentChanged = false;
        popped.gMsgCompose.bodyModified = false;
        popped.close();
        await wait(1000);
      }
    }
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
   * Named signatures (new / reply defaults, Signature menu), Templates menu,
   * Settings signatures tab.
   */
  async "compose-signatures"(record) {
    const top = window.browsingContext.topChromeWindow;
    const { MailServices } = ChromeUtils.importESModule(
      "resource:///modules/MailServices.sys.mjs"
    );
    const { AmailSignatures } = ChromeUtils.importESModule(
      "resource:///modules/AmailSignatures.sys.mjs"
    );
    const identity = MailServices.accounts.defaultAccount.defaultIdentity;
    AmailSignatures.save(
      identity,
      [
        { id: "work", name: "Work", text: "Best regards\nWork Signature" },
        { id: "short", name: "Short", text: "<b>Thanks!</b>" },
      ],
      "work",
      "short"
    );
    await wait(5000);
    const sigText = cw =>
      [...cw.getBrowser().contentDocument.body.querySelectorAll(".moz-signature")]
        .filter(n => !n.closest("blockquote, .moz-forward-container"))
        .map(n => n.innerHTML.replace(/\s+/g, " "));
    const waitCompose = async () => {
      for (let i = 0; i < 80; i++) {
        await wait(250);
        const cw = document.getElementById("amailComposeBrowser")?.contentWindow;
        if (cw?.gMsgCompose && cw.getBrowser()?.contentDocument?.body) {
          await wait(1500);
          return cw;
        }
      }
      return null;
    };

    top.goDoCommand("cmd_newMessage");
    const cw = await waitCompose();
    record({
      label: "new message",
      signatures: cw ? sigText(cw) : null,
      buttons: cw
        ? ["amail-signature-button", "amail-templates-button"].map(id =>
            cw.document.getElementById(id)?.checkVisibility()
          )
        : null,
      modified: cw ? cw.gContentChanged || cw.GetCurrentEditor().getModificationCount() : null,
    });
    if (!cw) {
      return;
    }
    const popup = cw.document.getElementById("amail-signature-popup");
    popup.dispatchEvent(new cw.Event("popupshowing"));
    record({
      label: "signature menu",
      items: [...popup.children].map(i => i.label || i.getAttribute("data-l10n-id") || i.localName),
    });
    cw.amailSetSignature(AmailSignatures.get(identity, "short"));
    const afterShort = sigText(cw);
    cw.amailSetSignature(null);
    record({ label: "switch + none", afterShort, afterNone: sigText(cw) });

    const tplPopup = cw.document.getElementById("amail-templates-popup");
    tplPopup.dispatchEvent(new cw.Event("popupshowing"));
    const templates = cw.amailListTemplates();
    record({
      label: "templates menu",
      templates: templates.length,
      items: [...tplPopup.children].map(i => i.getAttribute("data-l10n-id") || i.localName),
    });
    if (templates.length) {
      const { folder, hdr } = templates[0];
      await cw.amailUseTemplate(folder.getUriForMsg(hdr));
      await wait(1000);
      record({
        label: "used template",
        subject: cw.document.getElementById("msgSubject").value,
        bodyStart: cw.getBrowser().contentDocument.body.textContent.trim().slice(0, 80),
      });
    }
    await snapshot("compose-signature");
    {
      const outer = document.getElementById("amailComposeBrowser").getBoundingClientRect();
      const frame = window.frameElement?.getBoundingClientRect() ?? { x: 0, y: 0 };
      const bar = cw.document.getElementById("composeToolbar2").getBoundingClientRect();
      await snapshot(
        "compose-toolbar",
        top,
        new top.DOMRect(frame.x + outer.x, frame.y + outer.y + bar.y, Math.min(outer.width, 1300), bar.height)
      );
    }
    cw.gContentChanged = false;
    cw.gMsgCompose.bodyModified = false;
    cw.GetCurrentEditor().resetModificationCount();
    cw.gAmailInlineHost.close();
    await wait(1500);

    // Reply: the reply signature goes above the quote.
    const { threadTree, gDBView } = window;
    if (gDBView?.rowCount) {
      const hdr = gDBView.getMsgHdrAt(0);
      const wasRead = hdr.isRead;
      threadTree.selectedIndex = 0;
      await wait(1500);
      const windowsBeforeReply = [...Services.wm.getEnumerator(null)].length;
      top.goDoCommand("cmd_reply");
      const rw = await waitCompose();
      record({
        label: "reply attempt",
        selected: window.gDBView.numSelected,
        replyEnabled: top.document.getElementById("cmd_reply")?.getAttribute("disabled"),
        newWindows: [...Services.wm.getEnumerator(null)]
          .slice(windowsBeforeReply)
          .map(w => w.document.documentURI.replace(/.*\//, "")),
        frontWindow: Services.wm.getMostRecentWindow(null)?.document.documentURI.replace(/.*\//, ""),
        currentTabIsThis: top.document.getElementById("tabmail").currentAbout3Pane == window,
      });
      if (rw) {
        const body = rw.getBrowser().contentDocument.body;
        const sig = [...body.querySelectorAll(".moz-signature")].find(
          n => !n.closest("blockquote")
        );
        const quote = body.querySelector("blockquote[type='cite'], .moz-cite-prefix");
        record({
          label: "reply",
          signatures: sigText(rw),
          aboveQuote: !!(sig && quote && sig.compareDocumentPosition(quote) & Node.DOCUMENT_POSITION_FOLLOWING),
        });
        rw.gContentChanged = false;
        rw.gMsgCompose.bodyModified = false;
        rw.GetCurrentEditor().resetModificationCount();
        rw.gAmailInlineHost.close();
        await wait(1500);
      } else {
        record({ label: "reply did not open inline" });
      }
      if (!wasRead) {
        hdr.folder.markMessagesRead([hdr], false);
      }
    }

    // Picking a folder while writing: saved to Drafts (stubbed here) and the
    // folder shows.
    {
      top.goDoCommand("cmd_newMessage");
      const fw = await waitCompose();
      if (fw) {
        fw.document.getElementById("msgSubject").value = "Folder switch test";
        fw.gContentChanged = true;
        let saves = 0;
        fw.SaveAsDraft = () => {
          saves++;
          fw.SetContentAndBodyAsUnmodified();
          fw.amailCloseCompose();
        };
        const before = window.gFolder?.URI;
        const rows = [...document.querySelectorAll("#folderTree li")].filter(r => r.uri && r.checkVisibility());
        const target = rows.find(r => r.uri != before && r.querySelector(".container"));
        target?.querySelector(".container").click();
        await wait(3000);
        record({
          label: "folder click while writing",
          clicked: target?.uri,
          nowShowing: window.gFolder?.URI,
          saveToDrafts: saves,
          composeClosed: !document.getElementById("amailComposeBrowser"),
          listShown: document.getElementById("threadPane").checkVisibility(),
        });
        if (before) {
          const back = rows.find(r => r.uri == before);
          back?.querySelector(".container").click();
          await wait(1500);
        }
      }
    }

    // Settings tab.
    top.amailSettingsDialog.openSettings("signatures");
    await wait(2500);
    const page = top.document.getElementById("amailSettingsBrowser").contentDocument;
    record({
      label: "settings tab",
      blocks: page.querySelectorAll(".signature").length,
      itemsFirst: page.querySelector(".signature")?.querySelectorAll(".signature-item").length,
      selects: [...(page.querySelector(".signature")?.querySelectorAll("select") ?? [])].map(
        s => `${s.value} (${s.options.length})`
      ),
    });
    await snapshot("settings-signatures");
    top.amailSettingsDialog.close();
  },
  /**
   * Signature button in a new inline message, driven like a user: real click
   * opens the menu, each item changes the body, No signature, From switch,
   * Manage signatures.
   */
  async "signature-menu"(record) {
    const top = window.browsingContext.topChromeWindow;
    const { MailServices } = ChromeUtils.importESModule(
      "resource:///modules/MailServices.sys.mjs"
    );
    const { AmailSignatures } = ChromeUtils.importESModule(
      "resource:///modules/AmailSignatures.sys.mjs"
    );
    // Every address gets its own test signatures (profile prefs are
    // restored after the run).
    const identities = MailServices.accounts.allIdentities.filter(i => i.email);
    identities.forEach((identity, n) =>
      AmailSignatures.save(
        identity,
        [
          { id: "work", name: `Work ${n}`, text: `Best regards
Work ${n}` },
          { id: "short", name: `Short ${n}`, text: `<b>Thanks ${n}!</b>` },
        ],
        "work",
        "short"
      )
    );
    await wait(5000);

    const waitCompose = async () => {
      for (let i = 0; i < 80; i++) {
        await wait(250);
        const cw = document.getElementById("amailComposeBrowser")?.contentWindow;
        if (cw?.gMsgCompose && cw.getBrowser()?.contentDocument?.body) {
          await wait(1500);
          return cw;
        }
      }
      return null;
    };
    const ownSignatures = cw =>
      [...cw.getBrowser().contentDocument.body.querySelectorAll(".moz-signature")]
        .filter(n => !n.closest("blockquote, .moz-forward-container"))
        .map(n => n.textContent.replace(/\s+/g, " ").trim());

    top.goDoCommand("cmd_newMessage");
    const cw = await waitCompose();
    if (!cw) {
      record({ label: "ERROR new message did not open inline" });
      return;
    }
    const button = cw.document.getElementById("amail-signature-button");
    const popup = cw.document.getElementById("amail-signature-popup");
    const r = button.getBoundingClientRect();
    record({
      label: "start",
      from: cw.gCurrentIdentity.email,
      body: ownSignatures(cw),
      buttonVisible: button.checkVisibility(),
      buttonRect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
    });

    // Real mouse click on the button.
    const shown = new Promise(resolve =>
      popup.addEventListener("popupshown", resolve, { once: true })
    );
    for (const type of ["mousedown", "mouseup"]) {
      cw.synthesizeMouseEvent(type, r.x + r.width / 2, r.y + r.height / 2, {
        button: 0,
        clickCount: 1,
      });
    }
    const opened = await Promise.race([shown.then(() => true), wait(3000).then(() => false)]);
    const pr = popup.getOuterScreenRect();
    const br = button.getBoundingClientRect();
    await screenShot("signature-menu-open");
    record({
      label: "click opens menu",
      opened,
      state: popup.state,
      items: [...popup.children].map(i =>
        i.localName == "menuseparator" ? "---" : i.label || i.getAttribute("label")
      ),
      menuSize: `${Math.round(pr.width)}x${Math.round(pr.height)}`,
      menuBelowButton: pr.top >= cw.mozInnerScreenY + br.bottom - 2,
    });

    const pick = async label => {
      if (popup.state != "open") {
        const again = new Promise(resolve =>
          popup.addEventListener("popupshown", resolve, { once: true })
        );
        button.open = true;
        await Promise.race([again, wait(2000)]);
      }
      const item = [...popup.children].find(i => i.label == label);
      if (!item) {
        return `no item ${label}`;
      }
      const hidden = new Promise(resolve =>
        popup.addEventListener("popuphidden", resolve, { once: true })
      );
      popup.activateItem(item);
      await Promise.race([hidden, wait(2000)]);
      await wait(300);
      return ownSignatures(cw);
    };

    const n = identities.indexOf(cw.gCurrentIdentity);
    record({ label: "pick Short", body: await pick(`Short ${n}`), changed: cw.gContentChanged });
    record({ label: "pick Work", body: await pick(`Work ${n}`) });
    record({ label: "pick No signature", body: await pick("No signature") });
    record({ label: "pick Short again", body: await pick(`Short ${n}`) });
    record({ label: "pick Short twice", body: await pick(`Short ${n}`) });
    if (popup.state == "open") {
      popup.hidePopup();
      await wait(300);
    }

    const second = identities.find(i => i != cw.gCurrentIdentity);
    if (second) {
      const list = cw.document.getElementById("msgIdentity");
      const item = list.getElementsByAttribute("identitykey", second.key)[0];
      list.selectedItem = item;
      cw.LoadIdentity(false);
      await wait(1500);
      const reopened = new Promise(resolve =>
        popup.addEventListener("popupshown", resolve, { once: true })
      );
      const rr = button.getBoundingClientRect();
      for (const type of ["mousedown", "mouseup"]) {
        cw.synthesizeMouseEvent(type, rr.x + rr.width / 2, rr.y + rr.height / 2, {
          button: 0,
          clickCount: 1,
        });
      }
      await Promise.race([reopened, wait(2000)]);
      record({
        label: "From switched",
        from: cw.gCurrentIdentity.email,
        body: ownSignatures(cw),
        items: [...popup.children].map(i =>
          i.localName == "menuseparator" ? "---" : i.label || i.getAttribute("label")
        ),
      });
      popup.hidePopup();
      await wait(300);
    }

    // Manage signatures opens Settings on the Signatures tab.
    button.open = true;
    await wait(800);
    const manage = [...popup.children].find(i => i.label == "Manage signatures…");
    popup.activateItem(manage);
    await wait(3000);
    const settings = top.document.getElementById("amailSettingsBrowser");
    record({
      label: "Manage signatures",
      settingsShown: !top.document.getElementById("amailSettingsModal").hidden,
      url: settings.currentURI?.spec,
      composeStillOpen: !!document.getElementById("amailComposeBrowser"),
    });
    top.amailSettingsDialog.close();
    await wait(500);

    cw.gContentChanged = false;
    cw.gMsgCompose.bodyModified = false;
    cw.GetCurrentEditor().resetModificationCount();
    cw.gAmailInlineHost.close();
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
