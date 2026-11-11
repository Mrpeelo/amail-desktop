/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { AmailProfileImport } = ChromeUtils.importESModule(
  "resource:///modules/AmailProfileImport.sys.mjs"
);

const list = document.getElementById("profileList");
const importButton = document.getElementById("import");
const cancelButton = document.getElementById("cancel");
const chooseButton = document.getElementById("chooseFolder");
const status = document.getElementById("status");
const progress = document.getElementById("progress");

let busy = false;

function selectedProfile() {
  const input = list.querySelector("input:checked");
  return input ? { path: input.value, name: input.dataset.name } : null;
}

function addProfile({ app, name, path, lastUsed }, checked) {
  const label = document.createElement("label");
  label.className = "profile";
  const input = document.createElement("input");
  input.type = "radio";
  input.name = "profile";
  input.value = path;
  input.dataset.name = name;
  input.checked = checked;
  input.addEventListener("change", () => (importButton.disabled = false));
  const text = document.createElement("span");
  const title = document.createElement("strong");
  title.textContent = `${app} – ${name}`;
  const detail = document.createElement("span");
  detail.className = "dim";
  detail.textContent = lastUsed
    ? `${path} · ${new Date(lastUsed).toLocaleString()}`
    : path;
  text.append(title, detail);
  label.append(input, text);
  list.append(label);
  if (checked) {
    importButton.disabled = false;
  }
}

async function chooseFolder() {
  const picker = Cc["@mozilla.org/filepicker;1"].createInstance(
    Ci.nsIFilePicker
  );
  const [title] = await document.l10n.formatValues([
    { id: "amail-import-choose-folder-title" },
  ]);
  picker.init(window.browsingContext, title, Ci.nsIFilePicker.modeGetFolder);
  const result = await new Promise(resolve => picker.open(resolve));
  if (result != Ci.nsIFilePicker.returnOK) {
    return;
  }
  const path = picker.file.path;
  if (!(await IOUtils.exists(PathUtils.join(path, "prefs.js")))) {
    document.l10n.setAttributes(status, "amail-import-not-a-profile");
    return;
  }
  status.textContent = "";
  document.getElementById("noProfiles").hidden = true;
  list.querySelectorAll("input").forEach(i => (i.checked = false));
  addProfile(
    { app: "Thunderbird", name: PathUtils.filename(path), path, lastUsed: 0 },
    true
  );
}

async function runImport() {
  const source = selectedProfile();
  if (!source || busy) {
    return;
  }
  if (await AmailProfileImport.isInUse(source.path)) {
    document.l10n.setAttributes(status, "amail-import-in-use");
    return;
  }
  busy = true;
  importButton.disabled = true;
  cancelButton.disabled = true;
  chooseButton.disabled = true;
  progress.hidden = false;
  document.l10n.setAttributes(status, "amail-import-copying");
  try {
    const profile = await AmailProfileImport.importFullCopy(
      source.path,
      source.name,
      (done, total) => {
        progress.value = total ? Math.round((done / total) * 100) : 100;
      }
    );
    document.l10n.setAttributes(status, "amail-import-done");
    await new Promise(resolve => setTimeout(resolve, 1200));
    AmailProfileImport.restartInto(profile);
  } catch (error) {
    console.error(error);
    busy = false;
    cancelButton.disabled = false;
    chooseButton.disabled = false;
    importButton.disabled = false;
    progress.hidden = true;
    document.l10n.setAttributes(status, "amail-import-failed", {
      message: String(error.message ?? error),
    });
  }
}

importButton.addEventListener("click", runImport);
cancelButton.addEventListener("click", () => window.close());
chooseButton.addEventListener("click", chooseFolder);
window.addEventListener("keydown", event => {
  if (event.key == "Escape" && !busy) {
    window.close();
  }
});

const profiles = await AmailProfileImport.findProfiles();
profiles.forEach((profile, index) => addProfile(profile, index == 0));
document.getElementById("noProfiles").hidden = profiles.length > 0;

// The window opens before the profile list and strings are in place.
await document.l10n.ready;
window.sizeToContent();
new ResizeObserver(() => window.sizeToContent()).observe(
  document.getElementById("importCard")
);
