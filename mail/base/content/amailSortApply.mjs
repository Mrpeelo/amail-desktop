/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);

const { presetName, result } = window.arguments[0];
const list = document.getElementById("folderList");
const filter = document.getElementById("filter");
const applyButton = document.getElementById("apply");
const status = document.getElementById("status");

document.l10n.setAttributes(
  document.getElementById("heading"),
  "amail-sort-apply-heading",
  { name: presetName }
);

const checkboxes = () => [...list.querySelectorAll("input[type=checkbox]")];

function updateState() {
  const count = checkboxes().filter(box => box.checked).length;
  applyButton.disabled = !count;
  document.l10n.setAttributes(status, "amail-sort-apply-count", { count });
}

function depthOf(folder) {
  let depth = 0;
  for (let parent = folder.parent; parent && !parent.isServer; ) {
    depth++;
    parent = parent.parent;
  }
  return depth;
}

for (const account of MailServices.accounts.accounts) {
  const root = account.incomingServer?.rootFolder;
  if (!root?.hasSubFolders) {
    continue;
  }
  const heading = document.createElement("h2");
  heading.textContent = root.localizedName;
  list.append(heading);
  for (const folder of root.descendants) {
    const label = document.createElement("label");
    label.className = "folder";
    label.style.paddingInlineStart = `${depthOf(folder) * 20}px`;
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = folder.URI;
    box.addEventListener("change", updateState);
    const name = document.createElement("span");
    name.textContent = folder.localizedName;
    label.append(box, name);
    label.dataset.search = folder.localizedName.toLowerCase();
    list.append(label);
  }
}

filter.addEventListener("input", () => {
  const text = filter.value.trim().toLowerCase();
  for (const label of list.querySelectorAll("label.folder")) {
    label.hidden = text && !label.dataset.search.includes(text);
  }
});

function setVisible(checked) {
  for (const box of checkboxes()) {
    if (!box.closest("label").hidden) {
      box.checked = checked;
    }
  }
  updateState();
}

document
  .getElementById("selectAll")
  .addEventListener("click", () => setVisible(true));
document
  .getElementById("selectNone")
  .addEventListener("click", () => setVisible(false));
document
  .getElementById("cancel")
  .addEventListener("click", () => window.close());
applyButton.addEventListener("click", () => {
  result.uris = checkboxes()
    .filter(box => box.checked)
    .map(box => box.value);
  window.close();
});

updateState();
window.addEventListener("load", () => window.sizeToContent?.());
