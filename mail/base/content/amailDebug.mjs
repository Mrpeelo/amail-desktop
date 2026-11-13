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
