/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * aMail attachments browser (paperclip in the title bar): every attachment
 * in the mail, from the global search index. Filter by text, type, account
 * and size; open, save, save as, show the message, or remove attachments
 * from the mail. Messages whose attachments the index doesn't know yet
 * (bodies not downloaded) are counted, with a button to download them.
 */

const { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);
const { Gloda } = ChromeUtils.importESModule(
  "resource:///modules/gloda/GlodaPublic.sys.mjs"
);
const { AttachmentInfo } = ChromeUtils.importESModule(
  "resource:///modules/AttachmentInfo.sys.mjs"
);
const { MailUtils } = ChromeUtils.importESModule(
  "resource:///modules/MailUtils.sys.mjs"
);
const { Downloads } = ChromeUtils.importESModule(
  "resource://gre/modules/Downloads.sys.mjs"
);

const $ = id => document.getElementById(id);
const F = Ci.nsMsgFolderFlags;
const PAGE = 300;

/**
 * @typedef {object} Row
 * @property {string} name
 * @property {string} contentType
 * @property {number} size
 * @property {string} url
 * @property {nsIMsgDBHdr} hdr
 * @property {string} accountKey
 * @property {string} sender
 * @property {string} subject
 * @property {number} date - Milliseconds.
 * @property {string} kind - image, pdf, document, archive, media, other.
 */

/** @type {Row[]} */
let rows = [];
/** @type {Row[]} */
let shown = [];
let limit = PAGE;
const picked = new Set();
/** Messages with attachments the index has no details for, per folder. */
let pendingFolders = new Map();

const sizeFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});
function formatSize(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${sizeFormat.format(value)} ${units[unit]}`;
}
const dateFormat = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

function kindOf(contentType, name) {
  const type = (contentType || "").toLowerCase();
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (type.startsWith("image/")) {
    return "image";
  }
  if (type == "application/pdf" || ext == "pdf") {
    return "pdf";
  }
  if (type.startsWith("audio/") || type.startsWith("video/")) {
    return "media";
  }
  if (
    /zip|rar|7z|tar|gzip|compressed/.test(type) ||
    ["zip", "rar", "7z", "tar", "gz", "tgz"].includes(ext)
  ) {
    return "archive";
  }
  if (
    /word|excel|powerpoint|officedocument|opendocument|rtf|csv|text\/plain/.test(type) ||
    ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "txt", "csv"].includes(ext)
  ) {
    return "document";
  }
  return "other";
}

/**
 * Messages flagged as having attachments, one per Message-ID (Gmail keeps
 * copies in All Mail; prefer the copy elsewhere).
 *
 * @returns {nsIMsgDBHdr[]}
 */
function messagesWithAttachments() {
  const byId = new Map();
  for (const folder of MailServices.accounts.allFolders) {
    if (folder.isServer || folder.getFlag(F.Virtual) || folder.getFlag(F.Trash) || folder.getFlag(F.Junk)) {
      continue;
    }
    let messages;
    try {
      messages = folder.messages;
    } catch {
      continue;
    }
    for (const hdr of messages) {
      if (!(hdr.flags & Ci.nsMsgMessageFlags.Attachment)) {
        continue;
      }
      const keep = byId.get(hdr.messageId);
      if (!keep || (keep.folder.getFlag(F.Archive) && !folder.getFlag(F.Archive))) {
        byId.set(hdr.messageId, hdr);
      }
    }
  }
  return [...byId.values()];
}

function glodaMessages(hdrs) {
  return new Promise(resolve => {
    Gloda.getMessageCollectionForHeaders(hdrs, {
      onItemsAdded() {},
      onItemsModified() {},
      onItemsRemoved() {},
      onQueryCompleted(collection) {
        resolve(collection.items);
      },
    });
  });
}

async function load() {
  const hdrs = messagesWithAttachments();
  const found = new Set();
  rows = [];
  for (let i = 0; i < hdrs.length; i += 200) {
    for (const message of await glodaMessages(hdrs.slice(i, i + 200))) {
      const hdr = message.folderMessage;
      const infos = message.attachmentInfos;
      if (!hdr || !infos) {
        continue;
      }
      found.add(hdr.messageId);
      const author = MailServices.headerParser.parseDecodedHeader(hdr.mime2DecodedAuthor)[0];
      for (const att of infos) {
        if (att.isExternal || att.contentType == "text/x-moz-deleted") {
          continue;
        }
        let url;
        try {
          url = att.url;
        } catch {
          continue;
        }
        rows.push({
          name: att.name,
          contentType: att.contentType,
          size: att.size,
          url,
          hdr,
          accountKey: MailServices.accounts.findAccountForServer(hdr.folder.server)?.key ?? "",
          sender: author?.name || author?.email || hdr.mime2DecodedAuthor,
          subject: hdr.mime2DecodedSubject,
          date: hdr.date / 1000,
          kind: kindOf(att.contentType, att.name),
        });
      }
    }
  }
  // Messages the index knows nothing about yet: their bodies are usually not
  // downloaded.
  pendingFolders = new Map();
  for (const hdr of hdrs) {
    if (!found.has(hdr.messageId) && !(hdr.flags & Ci.nsMsgMessageFlags.Offline)) {
      pendingFolders.set(hdr.folder, (pendingFolders.get(hdr.folder) ?? 0) + 1);
    }
  }
  $("loading").hidden = true;
  showPending();
  render();
}

function showPending() {
  const count = [...pendingFolders.values()].reduce((a, b) => a + b, 0);
  $("pending").hidden = !count;
  document.l10n.setAttributes($("pendingText"), "amail-attachments-pending", { count });
}

function filtered() {
  const text = $("search").value.trim().toLowerCase();
  const kind = $("type").value;
  const account = $("account").value;
  const minSize = Number($("size").value);
  const list = rows.filter(
    row =>
      (!kind || row.kind == kind) &&
      (!account || row.accountKey == account) &&
      row.size >= minSize &&
      (!text ||
        row.name.toLowerCase().includes(text) ||
        row.sender.toLowerCase().includes(text) ||
        row.subject.toLowerCase().includes(text))
  );
  const compare = {
    newest: (a, b) => b.date - a.date,
    oldest: (a, b) => a.date - b.date,
    largest: (a, b) => b.size - a.size,
    smallest: (a, b) => a.size - b.size,
    az: (a, b) => a.name.localeCompare(b.name),
    za: (a, b) => b.name.localeCompare(a.name),
  }[$("sort").value];
  return list.sort(compare);
}

function button(l10nId, onClick, className = "btn") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  document.l10n.setAttributes(b, l10nId);
  b.addEventListener("click", onClick);
  return b;
}

function attachmentInfo(row) {
  return new AttachmentInfo({
    contentType: row.contentType,
    url: row.url,
    name: row.name,
    uri: row.hdr.folder.getUriForMsg(row.hdr),
    message: row.hdr,
  });
}

async function saveToDownloads(row) {
  const dir = await Downloads.getPreferredDownloadsDirectory();
  let path = PathUtils.join(dir, row.name);
  const dot = row.name.lastIndexOf(".");
  const base = dot > 0 ? row.name.slice(0, dot) : row.name;
  const ext = dot > 0 ? row.name.slice(dot) : "";
  for (let n = 2; await IOUtils.exists(path); n++) {
    path = PathUtils.join(dir, `${base} (${n})${ext}`);
  }
  await attachmentInfo(row).saveToFile(path);
  return path;
}

function render() {
  shown = filtered();
  const tbody = $("list").tBodies[0];
  tbody.replaceChildren();
  for (const row of shown.slice(0, limit)) {
    const tr = document.createElement("tr");
    const pick = document.createElement("input");
    pick.type = "checkbox";
    pick.checked = picked.has(row);
    pick.addEventListener("change", () => {
      if (pick.checked) {
        picked.add(row);
      } else {
        picked.delete(row);
      }
      updateSummary();
    });
    const name = document.createElement("button");
    name.type = "button";
    name.className = "link name";
    name.textContent = row.name;
    name.title = row.contentType;
    name.addEventListener("click", () => attachmentInfo(row).open(window.browsingContext));
    const message = document.createElement("div");
    message.className = "message";
    const sender = document.createElement("strong");
    sender.textContent = row.sender;
    const subject = document.createElement("span");
    subject.className = "dim";
    subject.textContent = row.subject;
    message.append(sender, subject);
    const cells = [
      [pick, "pick"],
      [name, ""],
      [formatSize(row.size), "num"],
      [message, ""],
      [dateFormat.format(new Date(row.date)), "nowrap"],
      [
        [
          button("amail-attachments-save", async () => {
            await saveToDownloads(row);
          }),
          button("amail-attachments-save-as", () =>
            attachmentInfo(row).save(window.browsingContext)
          ),
          button("amail-attachments-show-message", () => {
            const top = window.browsingContext.topChromeWindow;
            top.amailSettingsDialog?.close();
            MailUtils.displayMessageInFolderTab(row.hdr);
          }),
        ],
        "end",
      ],
    ];
    for (const [content, className] of cells) {
      const td = document.createElement("td");
      td.className = className;
      if (Array.isArray(content)) {
        td.append(...content);
      } else if (typeof content == "string") {
        td.textContent = content;
      } else {
        td.append(content);
      }
      tr.append(td);
    }
    tbody.append(tr);
  }
  $("more").hidden = shown.length <= limit;
  updateSummary();
}

function updateSummary() {
  const total = shown.reduce((sum, row) => sum + row.size, 0);
  document.l10n.setAttributes($("count"), "amail-attachments-count", {
    count: shown.length,
    size: formatSize(total),
  });
  const selected = [...picked];
  const selectedSize = selected.reduce((sum, row) => sum + row.size, 0);
  $("remove").disabled = !selected.length;
  document.l10n.setAttributes($("remove"), "amail-attachments-remove", {
    count: selected.length,
    size: formatSize(selectedSize),
  });
  $("pickAll").checked = shown.length && shown.every(row => picked.has(row));
}

async function removeSelected() {
  const selected = [...picked];
  if (!selected.length) {
    return;
  }
  const size = formatSize(selected.reduce((sum, row) => sum + row.size, 0));
  const [title, message, detach, remove] = await document.l10n.formatValues([
    "amail-attachments-remove-title",
    { id: "amail-attachments-remove-message", args: { count: selected.length, size } },
    "amail-attachments-remove-detach",
    "amail-attachments-remove-delete",
  ]);
  const P = Ci.nsIPromptService;
  const choice = Services.prompt.confirmEx(
    window,
    title,
    message,
    P.BUTTON_POS_0 * P.BUTTON_TITLE_IS_STRING +
      P.BUTTON_POS_1 * P.BUTTON_TITLE_CANCEL +
      P.BUTTON_POS_2 * P.BUTTON_TITLE_IS_STRING,
    detach,
    null,
    remove,
    null,
    {}
  );
  if (choice == 1) {
    return;
  }
  const byMessage = new Map();
  for (const row of selected) {
    const list = byMessage.get(row.hdr) ?? [];
    list.push(row);
    byMessage.set(row.hdr, list);
  }
  let detachDir = null;
  if (choice == 0) {
    // Keep a copy: choose the folder once.
    const picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    picker.init(window.browsingContext, title, Ci.nsIFilePicker.modeGetFolder);
    const result = await new Promise(resolve => picker.open(resolve));
    if (result != Ci.nsIFilePicker.returnOK) {
      return;
    }
    detachDir = picker.file.path;
  }
  for (const [hdr, list] of byMessage) {
    const infos = list.map(attachmentInfo);
    try {
      if (detachDir) {
        await AttachmentInfo.detachAttachments(hdr, infos, detachDir);
      } else {
        await AttachmentInfo.deleteAttachments(hdr, infos, true);
      }
    } catch (error) {
      console.error(error);
    }
  }
  picked.clear();
  rows = rows.filter(row => !selected.includes(row));
  render();
}

function downloadPending() {
  const msgWindow = window.browsingContext.topChromeWindow.msgWindow;
  for (const folder of pendingFolders.keys()) {
    try {
      folder.downloadAllForOffline(null, msgWindow);
    } catch (error) {
      console.error(error);
    }
  }
  $("download").disabled = true;
  document.l10n.setAttributes($("pendingText"), "amail-attachments-downloading");
}

function init() {
  const accounts = $("account");
  for (const account of MailServices.accounts.accounts) {
    if (!account.incomingServer || account.incomingServer.type == "none") {
      continue;
    }
    const option = document.createElement("option");
    option.value = account.key;
    option.textContent = account.incomingServer.prettyName;
    accounts.append(option);
  }
  for (const id of ["search"]) {
    $(id).addEventListener("input", () => {
      limit = PAGE;
      render();
    });
  }
  for (const id of ["type", "account", "size", "sort"]) {
    $(id).addEventListener("change", () => {
      limit = PAGE;
      render();
    });
  }
  $("more").addEventListener("click", () => {
    limit += PAGE;
    render();
  });
  $("pickAll").addEventListener("change", () => {
    for (const row of shown) {
      if ($("pickAll").checked) {
        picked.add(row);
      } else {
        picked.delete(row);
      }
    }
    render();
  });
  $("remove").addEventListener("click", removeSelected);
  $("download").addEventListener("click", downloadPending);
  load().catch(error => {
    console.error(error);
    $("loading").hidden = true;
  });
}

window.amailAttachments = {
  get rows() {
    return rows;
  },
  get shown() {
    return shown;
  },
  get pending() {
    return pendingFolders;
  },
};

init();
