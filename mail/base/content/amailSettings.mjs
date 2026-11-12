/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * aMail Settings: about:preferences and about:accountsettings open in a
 * dialog over the app (like Outlook on the web) instead of a tab.
 * openPreferencesTab() and MsgAccountManager() use window.amailSettings.
 */

const PREFERENCES = "about:preferences";
const ACCOUNTS = "about:accountsettings";

const modal = document.getElementById("amailSettingsModal");
const browser = document.getElementById("amailSettingsBrowser");
const title = document.getElementById("amailSettingsTitle");
const back = document.getElementById("amailSettingsBack");
let returnFocus = null;

function show(url) {
  if (modal.hidden) {
    returnFocus = document.activeElement;
    modal.hidden = false;
  }
  back.hidden = url != ACCOUNTS;
  document.l10n.setAttributes(
    title,
    url == ACCOUNTS ? "amail-settings-accounts-title" : "amail-settings-title"
  );
}

function load(url) {
  browser.loadURI(Services.io.newURI(url), {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
}

function currentURL() {
  return modal.hidden ? null : browser.currentURI?.spec;
}

/**
 * Open Settings at a pane.
 *
 * @param {string} [paneID] - The pane to show, e.g. "paneCompose".
 * @param {string} [scrollPaneTo] - The id of an element to scroll to.
 * @param {object} [otherArgs] - Passed to selectPrefPane.
 * @returns {Promise<Window>} The preferences window once the pane is shown.
 */
async function open(paneID, scrollPaneTo, otherArgs) {
  const loaded = currentURL() == PREFERENCES;
  show(PREFERENCES);
  if (!loaded) {
    const { promise, resolve } = Promise.withResolvers();
    browser.addEventListener("paneSelected", () => setTimeout(resolve), {
      once: true,
    });
    load(PREFERENCES);
    await promise;
  }
  await browser.contentWindow.selectPrefPane(paneID, scrollPaneTo, otherArgs);
  return browser.contentWindow;
}

/**
 * Open account settings.
 *
 * @param {nsIMsgIncomingServer|nsIMsgFolder} [server] - What to select.
 * @param {string} [selectPage] - The account page to show.
 */
function openAccounts(server, selectPage) {
  if (currentURL() == ACCOUNTS) {
    const root = browser.contentDocument.documentElement;
    root.server = server;
    root.selectPage = selectPage;
    browser.contentWindow.onLoad();
    return;
  }
  show(ACCOUNTS);
  browser.addEventListener(
    "DOMContentLoaded",
    function setUp(event) {
      if (event.target != browser.contentDocument) {
        return;
      }
      browser.removeEventListener("DOMContentLoaded", setUp, true);
      const root = browser.contentDocument.documentElement;
      root.server = server;
      root.selectPage = selectPage;
    },
    true
  );
  load(ACCOUNTS);
}

function close() {
  if (modal.hidden) {
    return;
  }
  load("about:blank");
  modal.hidden = true;
  if (returnFocus?.isConnected) {
    returnFocus.focus();
  }
  returnFocus = null;
}

document
  .getElementById("amailSettingsClose")
  .addEventListener("click", close);
back.addEventListener("click", () => open());

function onKeyDown(event) {
  if (event.key != "Escape" || event.defaultPrevented) {
    return;
  }
  if (browser.contentWindow?.gSubDialog?._dialogs.length) {
    return;
  }
  event.preventDefault();
  close();
}
modal.addEventListener("keydown", onKeyDown);

const tabmail = document.getElementById("tabmail");
tabmail?.registerTabMonitor({
  monitorName: "amailSettings",
  onTabTitleChanged() {},
  onTabSwitched: close,
  onTabOpened: close,
  onTabClosing() {},
  onTabPersist() {
    return null;
  },
  onTabRestored() {},
});

window.amailSettings = { open, openAccounts, close };
