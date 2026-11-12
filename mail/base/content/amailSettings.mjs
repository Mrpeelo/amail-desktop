/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * aMail Settings: a dialog over the app (like Outlook on the web) instead of
 * a tab. It shows the aMail Settings page (amailSettingsPage.xhtml); "All
 * settings" (about:preferences) and account settings open in the same
 * dialog with a back button. openPreferencesTab() and MsgAccountManager()
 * use window.amailSettingsDialog.
 */

const SETTINGS = "chrome://messenger/content/amailSettingsPage.xhtml";
const PREFERENCES = "about:preferences";
const ACCOUNTS = "about:accountsettings";

const modal = document.getElementById("amailSettingsModal");
const card = document.getElementById("amailSettingsCard");
const browser = document.getElementById("amailSettingsBrowser");
const title = document.getElementById("amailSettingsTitle");
const back = document.getElementById("amailSettingsBack");
let returnFocus = null;
let settingsTab = "general";

const TITLES = {
  [SETTINGS]: "amail-settings-title",
  [PREFERENCES]: "amail-settings-all-title",
  [ACCOUNTS]: "amail-settings-accounts-title",
};

function show(url) {
  if (modal.hidden) {
    returnFocus = document.activeElement;
    modal.hidden = false;
    browser.docShellIsActive = true;
  }
  back.hidden = url == SETTINGS;
  card.classList.toggle("amail-settings-wide", url != SETTINGS);
  document.l10n.setAttributes(title, TITLES[url]);
}

function load(url) {
  browser.loadURI(Services.io.newURI(url), {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
}

function currentURL() {
  if (modal.hidden || !browser.currentURI) {
    return null;
  }
  const uri = browser.currentURI;
  return uri.schemeIs("chrome") ? uri.specIgnoringRef : uri.prePath + uri.filePath;
}

function rememberTab() {
  if (currentURL() == SETTINGS) {
    settingsTab = browser.currentURI.ref || settingsTab;
  }
}

/**
 * Open the aMail Settings page.
 *
 * @param {string} [tab] - general, accounts, signatures, trusted, filters
 *   or about. Defaults to the last one shown.
 */
function openSettings(tab = settingsTab) {
  settingsTab = tab;
  const loaded = currentURL() == SETTINGS;
  show(SETTINGS);
  if (loaded) {
    browser.contentWindow.location.hash = tab;
  } else {
    load(`${SETTINGS}#${tab}`);
  }
}

/**
 * Open Settings. Without a pane this is the aMail Settings page; with a
 * pane it is that pane of all settings (about:preferences).
 *
 * @param {string} [paneID] - The pane to show, e.g. "paneCompose".
 * @param {string} [scrollPaneTo] - The id of an element to scroll to.
 * @param {object} [otherArgs] - Passed to selectPrefPane.
 * @returns {Promise<Window>} The settings window once it is shown.
 */
async function open(paneID, scrollPaneTo, otherArgs) {
  rememberTab();
  if (!paneID) {
    openSettings();
    return browser.contentWindow;
  }
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
  rememberTab();
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
  rememberTab();
  load("about:blank");
  modal.hidden = true;
  browser.docShellIsActive = false;
  if (returnFocus?.isConnected) {
    returnFocus.focus();
  }
  returnFocus = null;
}

document
  .getElementById("amailSettingsClose")
  .addEventListener("click", close);
back.addEventListener("click", () => openSettings());

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

window.amailSettingsDialog = { open, openSettings, openAccounts, close };
