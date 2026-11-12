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
const subfolders = document.getElementById("subfolders");

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

/**
 * Check or uncheck the folders below a folder: the labels that follow it
 * with a greater depth.
 *
 * @param {HTMLLabelElement} label
 * @param {boolean} checked
 */
function setSubfolders(label, checked) {
  const depth = Number(label.dataset.depth);
  for (
    let next = label.nextElementSibling;
    next?.matches("label.folder") && Number(next.dataset.depth) > depth;
    next = next.nextElementSibling
  ) {
    next.querySelector("input").checked = checked;
  }
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
    const depth = depthOf(folder);
    label.dataset.depth = depth;
    label.style.paddingInlineStart = `${depth * 20}px`;
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = folder.URI;
    box.addEventListener("change", () => {
      if (subfolders.checked) {
        setSubfolders(label, box.checked);
      }
      updateState();
    });
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
// Turning the toggle on also selects the subfolders of folders already
// chosen; turning it off leaves the selection as it is.
subfolders.addEventListener("change", () => {
  if (subfolders.checked) {
    for (const box of checkboxes().filter(b => b.checked)) {
      setSubfolders(box.closest("label"), true);
    }
  }
  updateState();
});

applyButton.addEventListener("click", () => {
  const uris = new Set(
    checkboxes()
      .filter(box => box.checked)
      .map(box => box.value)
  );
  // Include subfolders hidden by the filter too.
  if (subfolders.checked) {
    for (const uri of [...uris]) {
      const folder = MailServices.folderLookup.getFolderForURL(uri);
      for (const child of folder?.descendants ?? []) {
        uris.add(child.URI);
      }
    }
  }
  result.uris = [...uris];
  window.close();
});

updateState();
window.addEventListener("load", () => window.sizeToContent?.());
