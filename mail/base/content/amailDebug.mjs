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
  /** Folders never open in a tab: no menu item, middle-click does nothing. */
  async "folder-no-tab"(record) {
    const top = window.browsingContext.topChromeWindow;
    const tabmail = top.document.getElementById("tabmail");
    const about3 = tabmail.currentAbout3Pane;
    const before = tabmail.tabInfo.length;
    const row = about3.folderTree.selectedRow ?? about3.folderTree.querySelector("li");
    row.dispatchEvent(new about3.MouseEvent("auxclick", { bubbles: true, button: 1 }));
    await wait(1500);
    record({
      label: "folder",
      menuItem: !!about3.document.getElementById("folderPaneContext-openNewTab"),
      middleClickTabsAdded: tabmail.tabInfo.length - before,
      runFiltersShown: !about3.document.getElementById("amailRunFiltersButton").hidden,
    });
  },
  /** Search results and "Open as list" are views without tabs, with Back. */
  async "search-views"(record) {
    const top = window.browsingContext.topChromeWindow;
    const doc = top.document;
    const tabmail = doc.getElementById("tabmail");
    const look = label => {
      const current = tabmail.currentTabInfo;
      const about3 = current.mode.name == "mail3PaneTab" && current.chromeBrowser?.contentWindow;
      record({
        label,
        stripHidden: doc.getElementById("tabs-toolbar").collapsed,
        tabs: tabmail.tabInfo.map(t => `${t.mode.name}${t.amailTransient ? " (search)" : ""}${t.tabNode.hasAttribute("amail-view") ? "" : " SHOWN"}${t == current ? " *" : ""}`),
        on: [...doc.querySelectorAll("#amailAppSwitch .on")].map(b => b.id),
        backShown: about3 ? !about3.document.getElementById("amailSearchBack").hidden : undefined,
        listRows: about3 ? about3.gDBView?.rowCount : undefined,
        title: about3 ? about3.document.getElementById("threadPaneFolderName").textContent : undefined,
      });
    };
    const search = async text => {
      doc.querySelector("#amailSearch global-search-bar").dispatchEvent(
        new top.CustomEvent("search", { detail: text })
      );
      await wait(4000);
    };
    const openAsList = async () => {
      tabmail.currentTabInfo.browser.contentDocument.getElementById("gloda-showall").click();
      await wait(2500);
    };
    await search("patreon");
    look("search results page");
    await openAsList();
    look("open as list");
    await snapshot("search-list", top);
    await wait(4000);
    look("6 s later, list still open");
    tabmail.currentTabInfo.chromeBrowser.contentDocument.getElementById("amailSearchBack").click();
    await wait(1500);
    look("after Back");
    await openAsList();
    await search("anime");
    look("new search from a list");
    await openAsList();
    doc.getElementById("amailGoMail").click();
    await wait(1500);
    look("Mail button from a list");
    const mainAbout3 = tabmail.tabInfo[0].chromeBrowser.contentWindow;
    record({ label: "main view intact", folder: mainAbout3.gFolder?.name, synthetic: !!mainAbout3.gViewWrapper?.isSynthetic });
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
