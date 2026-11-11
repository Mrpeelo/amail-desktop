/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global gSpacesToolbar, goDoCommand, openPreferencesTab, toAddressBook */

/**
 * aMail top bar: brand + Mail/Calendar switch, the tab strip (only shown
 * while more than one tab is open, see mail.tabs.autoHide), global search,
 * quick actions and the window buttons. Replaces the spaces toolbar.
 */

const tabmail = document.getElementById("tabmail");

function openSpaceByName(name) {
  const space = gSpacesToolbar.spaces?.find(s => s.name == name);
  if (space) {
    gSpacesToolbar.openSpace(tabmail, space);
  }
}

function updateAppSwitch() {
  const tabInfo = tabmail.currentTabInfo;
  const current = tabInfo
    ? gSpacesToolbar.spaces?.find(space => space.tabInSpace(tabInfo))?.name
    : gSpacesToolbar.currentSpace?.name;
  document.documentElement.setAttribute("amail-space", current ?? "mail");
  document
    .getElementById("amailGoMail")
    .classList.toggle("on", current != "calendar");
  document
    .getElementById("amailGoCalendar")
    .classList.toggle("on", current == "calendar");
}

function adoptToolbarParts() {
  const appMenuButton = document.getElementById("button-appmenu");
  if (appMenuButton) {
    document.getElementById("amailTopActions").append(appMenuButton);
  }
}

/**
 * New profiles start in the Light theme (the aMail default) instead of
 * following Windows. Done once; after that the user's choice is kept.
 */
async function applyDefaultThemeOnce() {
  const pref = "amail.theme.defaultApplied";
  if (Services.prefs.getBoolPref(pref, false)) {
    return;
  }
  Services.prefs.setBoolPref(pref, true);
  const { AddonManager } = ChromeUtils.importESModule(
    "resource://gre/modules/AddonManager.sys.mjs"
  );
  const light = await AddonManager.getAddonByID(
    "thunderbird-compact-light@mozilla.org"
  );
  await light?.enable();
}

function onSpacesReady() {
  applyDefaultThemeOnce();
  gSpacesToolbar.toggleToolbar(true);
  adoptToolbarParts();
  updateAppSwitch();
}

document
  .getElementById("amailTabsSlot")
  .append(document.getElementById("tabs-toolbar"));

document
  .getElementById("amailGoMail")
  .addEventListener("click", () => openSpaceByName("mail"));
document
  .getElementById("amailGoCalendar")
  .addEventListener("click", () => openSpaceByName("calendar"));
document
  .getElementById("amailGetMessages")
  .addEventListener("click", () => goDoCommand("cmd_getMsgsForAuthAccounts"));
document
  .getElementById("amailAddressBook")
  .addEventListener("click", () => toAddressBook());
document
  .getElementById("amailSettings")
  .addEventListener("click", () => openPreferencesTab());

tabmail.tabContainer.addEventListener("TabSelect", updateAppSwitch);

if (gSpacesToolbar.isLoaded) {
  onSpacesReady();
} else {
  window.addEventListener("spaces-toolbar-ready", onSpacesReady, {
    once: true,
  });
}
