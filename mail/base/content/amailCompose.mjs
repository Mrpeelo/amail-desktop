/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * aMail inline compose: writing, replying and forwarding happen in place of
 * the message list and reader (like Outlook on the web) instead of in a
 * separate window. The compose service asks with "amail-compose-open"
 * before it opens a window; if this is the mail tab in front and nothing is
 * being written here yet, the compose UI is loaded into #amailCompose.
 * Otherwise a normal compose window opens.
 */

const TOPIC = "amail-compose-open";
const COMPOSE_URL =
  "chrome://messenger/content/messengercompose/messengercompose.xhtml";

const topWindow = window.browsingContext.topChromeWindow;
const host = document.getElementById("amailCompose");
let browser = null;

function canHost() {
  if (browser || !Services.prefs.getBoolPref("amail.compose.inline", true)) {
    return false;
  }
  if (Services.wm.getMostRecentWindow(null) != topWindow) {
    return false;
  }
  const tabmail = topWindow.document.getElementById("tabmail");
  return tabmail?.currentAbout3Pane == window;
}

function close() {
  if (!browser) {
    return;
  }
  const closing = browser;
  browser = null;
  // Called from the compose scripts: let them finish before they unload.
  setTimeout(() => {
    closing.remove();
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
    if (!wrapper.data || !canHost()) {
      return;
    }
    const params = wrapper.data.QueryInterface(Ci.nsIMsgComposeParams);
    wrapper.data = null;
    open(params);
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

document.getElementById("amailComposeClose").addEventListener("click", () => {
  browser?.contentWindow.goDoCommand("cmd_close");
});
