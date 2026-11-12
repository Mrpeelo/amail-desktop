/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * aMail inline compose: writing, replying and forwarding happen in place of
 * the message list and reader (like Outlook on the web) instead of in a
 * separate window. The compose service asks with "amail-compose-open"
 * before it opens a window; if this is the mail tab in front, the compose UI
 * is loaded into #amailCompose. A message already being written there is
 * saved to Drafts first. Otherwise a normal compose window opens. Picking a
 * folder while writing saves the message to Drafts too and shows the folder.
 */

const TOPIC = "amail-compose-open";
const COMPOSE_URL =
  "chrome://messenger/content/messengercompose/messengercompose.xhtml";

const { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);

const topWindow = window.browsingContext.topChromeWindow;
const host = document.getElementById("amailCompose");
let browser = null;

/** A compose request that waits for the current message to close. */
let queuedParams = null;
let queueTimer = null;
/** The current message moves to a window once it is saved and closed. */
let popOutPending = false;
/** Lets one compose request through to a window. */
let forceWindow = false;
/** The current message closes (saved to Drafts) to show a folder. */
let leaving = false;

function isFrontMailTab() {
  if (!Services.prefs.getBoolPref("amail.compose.inline", true)) {
    return false;
  }
  if (Services.wm.getMostRecentWindow(null) != topWindow) {
    return false;
  }
  const tabmail = topWindow.document.getElementById("tabmail");
  return tabmail?.currentAbout3Pane == window;
}

function openInWindow(params) {
  // Naming the window URL skips the inline hook of the compose service.
  MailServices.compose.OpenComposeWindowWithParams(COMPOSE_URL, params);
}

/**
 * Open a saved draft in a compose window.
 *
 * @param {string} draftURI
 * @param {nsIMsgIdentity} identity
 */
function openDraftInWindow(draftURI, identity) {
  const hdr = MailServices.messageServiceFromURI(draftURI).messageURIToMsgHdr(
    draftURI
  );
  forceWindow = true;
  try {
    MailServices.compose.OpenComposeWindow(
      null,
      hdr,
      draftURI,
      Ci.nsIMsgCompType.Draft,
      Ci.nsIMsgCompFormat.Default,
      identity,
      null,
      topWindow.msgWindow
    );
  } finally {
    forceWindow = false;
  }
}

/**
 * Move the message being written to its own window: save it to Drafts and
 * open that draft in a window. An untouched message just reopens there.
 */
function popOut() {
  const cw = browser?.contentWindow;
  if (!cw?.gMsgCompose || cw.gWindowLocked || popOutPending) {
    return;
  }
  const changed =
    cw.gContentChanged ||
    cw.gMsgCompose.bodyModified ||
    cw.gAutoSaveKickedIn ||
    !!cw.gMsgCompose.compFields.draftId;
  if (!changed) {
    const [params] = browser.amailComposeHost.args;
    close();
    openInWindow(params);
    return;
  }
  popOutPending = true;
  cw.gCloseWindowAfterSave = true;
  cw.SaveAsDraft();
}

function close() {
  if (!browser) {
    return;
  }
  const closing = browser;
  browser = null;
  leaving = false;
  let draft = null;
  if (popOutPending) {
    popOutPending = false;
    const cw = closing.contentWindow;
    draft = {
      uri: cw?.gMsgCompose?.compFields.draftId,
      identity: cw?.gCurrentIdentity,
    };
  }
  // Called from the compose scripts: let them finish before they unload.
  setTimeout(() => {
    closing.remove();
    if (draft?.uri) {
      openDraftInWindow(draft.uri, draft.identity);
    } else if (draft) {
      console.error("aMail compose: the saved draft was not found");
    }
    clearTimeout(queueTimer);
    const next = queuedParams;
    queuedParams = null;
    if (next) {
      open(next);
      return;
    }
    host.hidden = true;
    document.body.classList.remove("amail-composing");
    window.threadTree?.table.body.focus();
  });
}

/**
 * @param {nsIMsgComposeParams} params
 */
function open(params) {
  browser = document.createXULElement("browser");
  browser.id = "amailComposeBrowser";
  browser.setAttribute("type", "content");
  browser.setAttribute("disablehistory", "true");
  browser.setAttribute("messagemanagergroup", "single-page");
  browser.amailComposeHost = { args: [params], close };
  host.append(browser);
  host.hidden = false;
  document.body.classList.add("amail-composing");
  browser.loadURI(Services.io.newURI(COMPOSE_URL), {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
}

/**
 * Another message is started while one is being written here: save the
 * current one to Drafts (if it has changes), close it and open the new one in
 * its place.
 *
 * @param {nsIMsgComposeParams} params - The new message.
 */
function replace(params) {
  if (queuedParams) {
    // Only one can wait; an older request gets a window.
    openInWindow(queuedParams);
  }
  queuedParams = params;
  clearTimeout(queueTimer);
  // If the save fails (the compose UI reports that), don't lose the request.
  queueTimer = setTimeout(() => {
    const waiting = queuedParams;
    queuedParams = null;
    if (waiting) {
      openInWindow(waiting);
    }
  }, 30000);
  saveAndClose();
}

/**
 * A folder was picked while a message is being written: save it to Drafts (if
 * it has changes) and close it, so the folder shows.
 */
function leave() {
  if (!browser || queuedParams || popOutPending || leaving) {
    return;
  }
  leaving = true;
  saveAndClose();
}

function saveAndClose() {
  const cw = browser?.contentWindow;
  if (!browser || (!queuedParams && !leaving)) {
    return;
  }
  if (!cw?.gMsgCompose || cw.gWindowLocked) {
    // Still loading, or busy sending or saving.
    setTimeout(saveAndClose, 300);
    return;
  }
  const modified =
    cw.gContentChanged || cw.gMsgCompose.bodyModified || cw.gAutoSaveKickedIn;
  if (!modified) {
    cw.goDoCommand("cmd_close");
    return;
  }
  cw.gCloseWindowAfterSave = true;
  cw.SaveAsDraft();
}

/**
 * @returns {boolean} false if a message is being written and the user chose
 *   to keep writing it.
 */
function canClose() {
  return !browser || !!browser.contentWindow?.ComposeCanClose?.();
}

const observer = {
  QueryInterface: ChromeUtils.generateQI(["nsIObserver"]),
  observe(subject, topic) {
    if (topic == "quit-application-requested") {
      const cancel = subject.QueryInterface(Ci.nsISupportsPRBool);
      if (!cancel.data && !canClose()) {
        cancel.data = true;
      }
      return;
    }
    const wrapper = subject.QueryInterface(Ci.nsISupportsInterfacePointer);
    if (!wrapper.data || forceWindow || !isFrontMailTab()) {
      return;
    }
    const params = wrapper.data.QueryInterface(Ci.nsIMsgComposeParams);
    wrapper.data = null;
    if (browser) {
      replace(params);
    } else {
      open(params);
    }
  },
};
Services.obs.addObserver(observer, TOPIC);
Services.obs.addObserver(observer, "quit-application-requested");

function onWindowClose(event) {
  if (!canClose()) {
    event.preventDefault();
  }
}
topWindow.addEventListener("close", onWindowClose, true);

window.addEventListener("unload", () => {
  Services.obs.removeObserver(observer, TOPIC);
  Services.obs.removeObserver(observer, "quit-application-requested");
  topWindow.removeEventListener("close", onWindowClose, true);
});

document.getElementById("amailComposePopOut").addEventListener("click", popOut);

const folderTree = document.getElementById("folderTree");
folderTree.addEventListener("select", leave);
folderTree.addEventListener("click", event => {
  // Clicking the folder that is already selected also returns to it; the
  // twisty only expands or collapses.
  if (event.button == 0 && !event.target.closest(".twisty")) {
    if (event.target.closest("li")) {
      leave();
    }
  }
});
document.getElementById("amailComposeClose").addEventListener("click", () => {
  browser?.contentWindow.goDoCommand("cmd_close");
});
