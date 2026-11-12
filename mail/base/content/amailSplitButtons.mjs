/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global goDoCommand, toAddressBook */

/**
 * aMail split buttons in the command bar: the main part runs the usual
 * action, the arrow next to it opens the related options.
 */

/**
 * Options menu for each split button, by unified toolbar item id. A function
 * opens a menu of its own instead.
 */
const SPLITS = {
  "write-message": [
    ["amail-new-message", () => goDoCommand("cmd_newMessage")],
    ["amail-new-event", () => goDoCommand("calendar_new_event_command")],
    ["amail-new-contact", () => toAddressBook(["cmd_newCard"])],
  ],
  // The Get Messages button has a per-account menu on right click.
  "get-messages": button =>
    button.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
    ),
};

function buildMenu(entries) {
  const popup = document.createXULElement("menupopup");
  popup.classList.add("amail-split-menu");
  for (const [l10nId, action] of entries) {
    const item = document.createXULElement("menuitem");
    item.setAttribute("data-l10n-attrs", "acceltext");
    document.l10n.setAttributes(item, l10nId);
    item.addEventListener("command", action);
    popup.append(item);
  }
  document.getElementById("mainPopupSet").append(popup);
  return popup;
}

const menus = new Map();

function addChevron(item) {
  const id = item.getAttribute("item-id");
  const split = SPLITS[id];
  const main = item.querySelector("button");
  if (!split || !main || item.querySelector(".amail-split-chevron")) {
    return;
  }
  const chevron = document.createElement("button");
  chevron.type = "button";
  chevron.className = "amail-split-chevron";
  chevron.setAttribute("aria-haspopup", "menu");
  document.l10n.setAttributes(chevron, `amail-split-${id}`);
  chevron.addEventListener("click", event => {
    event.stopPropagation();
    if (typeof split == "function") {
      split(main);
      return;
    }
    if (!menus.has(id)) {
      menus.set(id, buildMenu(split));
    }
    menus.get(id).openPopup(main, {
      position: "after_start",
      triggerEvent: event,
    });
  });
  item.classList.add("amail-split");
  main.after(chevron);
}

/**
 * @param {number} [attempt=0] - The command bar is created by the unified
 *   toolbar element, possibly after this runs; retry for a few seconds.
 */
export function initSplitButtons(attempt = 0) {
  const content = document.getElementById("unifiedToolbarContent");
  if (!content) {
    if (attempt < 20) {
      setTimeout(() => initSplitButtons(attempt + 1), 250);
    }
    return;
  }
  const update = () => {
    for (const item of content.querySelectorAll("li[item-id]")) {
      addChevron(item);
    }
  };
  // The command bar is rebuilt when switching between Mail and Calendar.
  new MutationObserver(update).observe(content, {
    childList: true,
    subtree: true,
  });
  update();
}
