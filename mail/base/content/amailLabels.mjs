/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * aMail label chips: the other Gmail labels (folders) a message is in, read
 * from the X-GM-LABELS that Thunderbird stores for Gmail messages. System
 * labels (\Inbox, \Important, ...) and the folder the message is shown in
 * are left out. Labels are shown with the folder's own name.
 */

const LABELS = "X-GM-LABELS";

/** @type {Map<string, Map<string, nsIMsgFolder>>} server key -> label -> folder */
const foldersByServer = new Map();

/**
 * Split an X-GM-LABELS value: space separated, quoted when needed, with
 * backslash escapes.
 *
 * @param {string} value
 * @returns {string[]}
 */
function parseLabels(value) {
  const labels = [];
  for (const match of value.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)) {
    labels.push(
      match[1] !== undefined ? match[1].replace(/\\(.)/g, "$1") : match[2]
    );
  }
  return labels;
}

function folderMap(server) {
  let map = foldersByServer.get(server.key);
  if (!map) {
    map = new Map();
    for (const folder of server.rootFolder.descendants) {
      try {
        const name = folder.QueryInterface(Ci.nsIMsgImapMailFolder).onlineName;
        if (name) {
          map.set(name, folder);
        }
      } catch {}
    }
    foldersByServer.set(server.key, map);
  }
  return map;
}

// Folders come and go; build the maps again when that happens.
const folderListener = {
  QueryInterface: ChromeUtils.generateQI(["nsIMsgFolderListener"]),
  folderAdded() {
    foldersByServer.clear();
  },
  folderDeleted() {
    foldersByServer.clear();
  },
  folderRenamed() {
    foldersByServer.clear();
  },
};
let listening = false;

/**
 * The label names to show for a message.
 *
 * @param {?nsIMsgDBHdr} hdr
 * @param {integer} [max=3]
 * @returns {string[]}
 */
export function labelsFor(hdr, max = 3) {
  const value = hdr?.getStringProperty(LABELS);
  if (!value) {
    return [];
  }
  if (!listening) {
    listening = true;
    const { MailServices } = ChromeUtils.importESModule(
      "resource:///modules/MailServices.sys.mjs"
    );
    MailServices.mfn.addListener(
      folderListener,
      Ci.nsIMsgFolderNotificationService.folderAdded |
        Ci.nsIMsgFolderNotificationService.folderDeleted |
        Ci.nsIMsgFolderNotificationService.folderRenamed
    );
  }
  const folder = hdr.folder;
  let own = "";
  try {
    own = folder.QueryInterface(Ci.nsIMsgImapMailFolder).onlineName;
  } catch {}
  const map = folderMap(folder.server);
  const names = [];
  for (const label of parseLabels(value)) {
    if (label.startsWith("\\") || label == own) {
      continue;
    }
    const target = map.get(label);
    if (target == folder) {
      continue;
    }
    const name = target?.localizedName ?? label.split("/").pop();
    if (!names.includes(name)) {
      names.push(name);
    }
    if (names.length == max) {
      break;
    }
  }
  return names;
}

/**
 * Chip elements for the label names.
 *
 * @param {Document} doc
 * @param {string[]} names
 * @returns {HTMLSpanElement[]}
 */
export function labelChips(doc, names) {
  return names.map(name => {
    const chip = doc.createElement("span");
    chip.className = "amail-label-chip";
    chip.textContent = name;
    return chip;
  });
}
