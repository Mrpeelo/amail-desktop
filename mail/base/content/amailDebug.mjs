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
  /** Mail, Calendar and Address book switch views without showing tabs. */
  async "view-tabs"(record) {
    const top = window.browsingContext.topChromeWindow;
    const doc = top.document;
    const tabmail = doc.getElementById("tabmail");
    const look = label =>
      record({
        label,
        stripHidden: doc.getElementById("tabs-toolbar").collapsed,
        tabbarhidden: doc.documentElement.getAttribute("tabbarhidden"),
        tabs: tabmail.tabInfo.map(t => `${t.mode.name}${t.tabNode.hasAttribute("amail-view") ? " (view)" : ""}${t == tabmail.currentTabInfo ? " *" : ""}`),
        shownTabs: tabmail.tabContainer.allTabs.filter(t => t.getBoundingClientRect().width > 0).length,
        on: [...doc.querySelectorAll("#amailAppSwitch .on")].map(b => b.id),
        addressBookPressed: doc.getElementById("amailAddressBook").getAttribute("aria-pressed"),
      });
    await look("start");
    doc.getElementById("amailGoCalendar").click();
    await wait(1500);
    await look("calendar");
    await snapshot("view-calendar", top);
    doc.getElementById("amailGoMail").click();
    await wait(800);
    await look("mail again");
    doc.getElementById("amailAddressBook").click();
    await wait(1500);
    await look("address book");
    doc.getElementById("amailGoMail").click();
    await wait(800);
    const folder = tabmail.currentAbout3Pane.gFolder;
    const extra = tabmail.openTab("mail3PaneTab", { folderURI: folder?.URI });
    await wait(1500);
    await look("extra tab open");
    await snapshot("view-extra-tab", top);
    tabmail.closeTab(extra);
    await wait(800);
    await look("extra tab closed");
    for (const mode of ["calendar", "addressBookTab"]) {
      for (const t of tabmail.tabModes[mode]?.tabs ?? []) {
        tabmail.closeTab(t);
      }
    }
    await wait(500);
    await look("views closed");
  },
  /** Theme import/export: round trip, applying, validation, delete. */
  async "theme-import-export"(record) {
    const top = window.browsingContext.topChromeWindow;
    top.resizeTo(1920, 1040);
    await wait(800);
    const { AmailTheme, AmailThemeError } = ChromeUtils.importESModule(
      "resource:///modules/AmailTheme.sys.mjs"
    );
    const { AddonManager } = ChromeUtils.importESModule(
      "resource://gre/modules/AddonManager.sys.mjs"
    );
    const activeTheme = async () =>
      (await AddonManager.getAddonsByTypes(["theme"])).find(t => t.isActive)?.id.split("@")[0];
    const dir = PathUtils.profileDir;
    const original = Services.prefs.getStringPref("amail.theme.palette");
    const write = () =>
      top.document.querySelector('li[item-id="write-message"] .unified-toolbar-button');
    const look = async label => {
      const about3 = top.document.getElementById("tabmail").currentAbout3Pane;
      record({
        label,
        palette: Services.prefs.getStringPref("amail.theme.palette"),
        theme: await activeTheme(),
        scheme: top.getComputedStyle(top.document.documentElement).colorScheme,
        writeBg: write() && top.getComputedStyle(write()).backgroundColor,
        folderPaneBg: about3 && about3.getComputedStyle(about3.document.getElementById("folderPane")).backgroundColor,
      });
    };

    const exported = PathUtils.join(dir, "amail-test-kingsley.css");
    await AmailTheme.exportFile("kingsley", exported);
    const text = await IOUtils.readUTF8(exported);
    record({ label: "export kingsley", lines: text.split("\n").length, head: text.split("\n").slice(2, 6) });
    const synth = PathUtils.join(dir, "amail-test-synthwave.css");
    await AmailTheme.exportFile("synthwave", synth);
    const synthText = await IOUtils.readUTF8(synth);
    record({ label: "export synthwave", lightDark: (synthText.match(/light-dark\(/g) || []).length, mode: /mode: (\w+)/.exec(synthText)?.[1] });

    const edited = PathUtils.join(dir, "amail-test-edited.css");
    await IOUtils.writeUTF8(
      edited,
      text
        .replace('"Kingsley Amber"', '"Test Green"')
        .replace(/--color-primary-default: [^;]+;/, "--color-primary-default: #00aa00;")
        .replace(/--amail-topbar-bg: [^;]+;/, "--amail-topbar-bg: #004400;")
    );
    const { palette, name } = await AmailTheme.importFile(edited);
    record({ label: "imported", palette, name, list: (await AmailTheme.listImported()).map(t => `${t.name} (${t.mode})`) });
    Services.prefs.setStringPref("amail.theme.palette", palette);
    await AmailTheme.apply();
    await wait(1500);
    await look("imported active");
    await snapshot("theme-imported", top);

    top.amailSettingsDialog.openSettings("general");
    await wait(2500);
    const page = top.document.getElementById("amailSettingsBrowser").contentDocument;
    record({
      label: "settings",
      selected: page.getElementById("palette").value,
      importedOptions: [...page.querySelectorAll("#paletteImported option")].map(o => o.textContent),
      deleteShown: !page.getElementById("themeDelete").hidden,
      exportEnabled: !page.getElementById("themeExport").disabled,
      importButton: page.getElementById("themeImport").textContent,
    });
    await snapshot("theme-settings", top);
    top.amailSettingsDialog.close();

    const bad = {
      selector: "body { color: red }",
      url: ':root { --amail-theme-name: "x"; --color-surface-base: url(https://example.com/x.png); }',
      notColor: ':root { --amail-theme-name: "x"; --color-text-base: banana(1); }',
      noName: ":root { --color-text-base: #fff; }",
    };
    for (const [kind, css] of Object.entries(bad)) {
      const path = PathUtils.join(dir, `amail-test-bad-${kind}.css`);
      await IOUtils.writeUTF8(path, css);
      try {
        await AmailTheme.importFile(path);
        record({ label: `bad ${kind}`, result: "ACCEPTED (wrong)" });
      } catch (e) {
        record({ label: `bad ${kind}`, rejected: e instanceof AmailThemeError, message: e.message });
      }
      await IOUtils.remove(path);
    }

    AmailTheme.startup();
    await wait(800);
    await look("after startup path");

    await AmailTheme.deleteImported(palette);
    await AmailTheme.apply();
    await wait(1500);
    await look("after delete");
    record({
      label: "files",
      themesFolder: await IOUtils.getChildren(PathUtils.join(dir, "amail-themes")).catch(() => []),
    });
    for (const f of [exported, synth, edited]) {
      await IOUtils.remove(f);
    }
    Services.prefs.setStringPref("amail.theme.palette", original);
    await AmailTheme.apply();
  },
  /** Settings dropdowns open with a short fade and slide; choosing still works. */
  async "select-dropdown-anim"(record) {
    const top = window.browsingContext.topChromeWindow;
    top.amailSettingsDialog.openSettings("general");
    await wait(2500);
    const browser = top.document.getElementById("amailSettingsBrowser");
    const page = browser.contentWindow;
    const select = [...page.document.querySelectorAll("select")].find(
      s => s.closest("label")?.textContent.includes("sending") || s.id == "undoSendDelay"
    ) ?? page.document.querySelectorAll("select")[3];
    const original = select.value;
    select.scrollIntoView();
    const rect = select.getBoundingClientRect();
    const offset = browser.getBoundingClientRect();
    const states = [];
    const shown = new Promise(resolve => {
      const onShowing = e => {
        if (e.target.closest?.("#ContentSelectDropdown")) {
          const cs = top.getComputedStyle(e.target);
          states.push({ at: "showing", animate: e.target.getAttribute("animate"), transform: cs.transform, opacity: cs.opacity, duration: cs.transitionDuration, cls: e.target.className });
        }
      };
      const onShown = e => {
        if (e.target.closest?.("#ContentSelectDropdown")) {
          const cs = top.getComputedStyle(e.target);
          states.push({ at: "shown", animate: e.target.getAttribute("animate"), transform: cs.transform, opacity: cs.opacity });
          top.document.removeEventListener("popupshowing", onShowing, true);
          top.document.removeEventListener("popupshown", onShown, true);
          resolve(e.target);
        }
      };
      top.document.addEventListener("popupshowing", onShowing, true);
      top.document.addEventListener("popupshown", onShown, true);
    });
    const x = offset.x + rect.x + 20;
    const y = offset.y + rect.y + 10;
    top.synthesizeMouseEvent("mousedown", x, y, { button: 0, clickCount: 1 });
    top.synthesizeMouseEvent("mouseup", x, y, { button: 0, clickCount: 1 });
    const popup = await Promise.race([shown, wait(3000).then(() => null)]);
    await wait(400);
    if (popup) {
      const cs = top.getComputedStyle(popup);
      states.push({ at: "settled", animate: popup.getAttribute("animate"), transform: cs.transform, opacity: cs.opacity });
      const item = [...popup.children].find(i => i.localName == "menuitem" && !i.selected && !i.hasAttribute("selected"));
      record({ label: "items", count: popup.childElementCount, itemTransition: item && top.getComputedStyle(item).transition });
      const hidden = new Promise(r => popup.addEventListener("popuphidden", r, { once: true }));
      popup.activateItem(item);
      await Promise.race([hidden, wait(2000)]);
      await wait(300);
      record({ label: "choose", picked: item?.label, value: select.value, original, changed: select.value != original });
    }
    record({ label: "dropdown", opened: !!popup, states });
    select.value = original;
    select.dispatchEvent(new page.Event("change", { bubbles: true }));
    top.amailSettingsDialog.close();
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
