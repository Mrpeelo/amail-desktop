/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * aMail Settings page, shown in the Settings dialog (amailSettings.mjs):
 * General, Accounts, Signatures & templates, Trusted senders, Filters and
 * About. "All settings" and the per-item details open Thunderbird's own
 * pages in the same dialog.
 */

const { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);
const { AmailSignatures } = ChromeUtils.importESModule(
  "resource:///modules/AmailSignatures.sys.mjs"
);
const { AddonManager } = ChromeUtils.importESModule(
  "resource://gre/modules/AddonManager.sys.mjs"
);
const { AmailTheme, AmailThemeError } = ChromeUtils.importESModule(
  "resource:///modules/AmailTheme.sys.mjs"
);

const top = window.browsingContext.topChromeWindow;
const dialog = top.amailSettingsDialog;
const $ = id => document.getElementById(id);
const EMAIL_ORIGIN = "chrome://messenger/content/email=";

/**
 * Create an element.
 *
 * @param {string} tag - The tag name, optionally with classes: "td.dim".
 * @param {object} [props] - Properties to set, plus `l10n` (id or
 *   [id, args]) and `text`.
 * @param {...(Node|string)} children
 * @returns {HTMLElement}
 */
function el(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split(".");
  const node = document.createElement(name);
  node.classList.add(...classes);
  const { l10n, text, ...rest } = props;
  Object.assign(node, rest);
  if (l10n) {
    const [id, args] = [].concat(l10n);
    document.l10n.setAttributes(node, id, args);
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  node.append(...children);
  return node;
}

function button(l10n, onclick, kind = "") {
  return el(`button.btn${kind ? "." + kind : ""}`, { type: "button", l10n, onclick });
}

const renderers = {
  general: renderGeneral,
  accounts: renderAccounts,
  signatures: renderSignatures,
  trusted: renderTrusted,
  filters: renderFilters,
  about: renderAbout,
};

function showTab(name) {
  if (!(name in renderers)) {
    name = "general";
  }
  for (const tab of document.querySelectorAll("[role=tab]")) {
    const selected = tab.dataset.tab == name;
    tab.setAttribute("aria-selected", selected);
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of document.querySelectorAll("[role=tabpanel]")) {
    panel.hidden = panel.id != name;
  }
  document.querySelector("main").scrollTop = 0;
  if (location.hash != `#${name}`) {
    history.replaceState(null, "", `#${name}`);
  }
  renderers[name]();
}

// General

function bindPrefs() {
  for (const input of document.querySelectorAll("[data-pref]")) {
    const pref = input.dataset.pref;
    if (input.type == "checkbox") {
      input.checked = Services.prefs.getBoolPref(pref, false);
      input.addEventListener("change", () =>
        Services.prefs.setBoolPref(pref, input.checked)
      );
    } else if (input.dataset.type == "int") {
      input.value = String(Services.prefs.getIntPref(pref, 0));
      input.addEventListener("change", () =>
        Services.prefs.setIntPref(pref, Number(input.value))
      );
    } else if (input.type == "number") {
      input.value = Services.prefs.getIntPref(pref, 0);
      input.addEventListener("change", () => {
        const value = Math.min(
          Number(input.max),
          Math.max(Number(input.min), Math.round(Number(input.value)) || 0)
        );
        input.value = value;
        Services.prefs.setIntPref(pref, value);
      });
    } else {
      input.value = Services.prefs.getCharPref(pref, "");
      input.addEventListener("change", () =>
        Services.prefs.setCharPref(pref, input.value)
      );
    }
  }

  const markMode = $("markReadMode");
  markMode.addEventListener("change", () => {
    Services.prefs.setBoolPref(
      "mailnews.mark_message_read.auto",
      markMode.value != "never"
    );
    Services.prefs.setBoolPref(
      "mailnews.mark_message_read.delay",
      markMode.value == "after"
    );
    renderGeneral();
  });

  const themeMode = $("themeMode");
  themeMode.addEventListener("change", async () => {
    const theme = await AddonManager.getAddonByID(themeMode.value);
    await theme?.enable();
  });
  $("palette").addEventListener("change", async () => {
    $("themeStatus").hidden = true;
    await AmailTheme.apply();
    renderGeneral();
  });
  $("themeImport").addEventListener("click", importTheme);
  $("themeExport").addEventListener("click", exportTheme);
  $("themeDelete").addEventListener("click", deleteTheme);
}

/**
 * Show the result of an import, export or delete under the theme buttons.
 *
 * @param {string} id - Fluent id.
 * @param {object} [args]
 */
function themeStatus(id, args) {
  const status = $("themeStatus");
  document.l10n.setAttributes(status, id, args);
  status.hidden = false;
}

/**
 * Ask for a theme file to open or save.
 *
 * @param {integer} mode - nsIFilePicker.modeOpen or modeSave.
 * @param {string} [defaultName]
 * @returns {Promise<?string>} The chosen path.
 */
async function pickThemeFile(mode, defaultName) {
  const [title, filter] = await document.l10n.formatValues([
    mode == Ci.nsIFilePicker.modeOpen
      ? "amail-settings-theme-import-title"
      : "amail-settings-theme-export-title",
    "amail-settings-theme-file-filter",
  ]);
  const picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
  picker.init(window.browsingContext, title, mode);
  picker.appendFilter(filter, "*.css");
  picker.appendFilters(Ci.nsIFilePicker.filterAll);
  if (defaultName) {
    picker.defaultString = defaultName;
    picker.defaultExtension = "css";
  }
  const result = await new Promise(resolve => picker.open(resolve));
  return result == Ci.nsIFilePicker.returnCancel ? null : picker.file.path;
}

async function importTheme() {
  const path = await pickThemeFile(Ci.nsIFilePicker.modeOpen);
  if (!path) {
    return;
  }
  try {
    const { palette, name } = await AmailTheme.importFile(path);
    Services.prefs.setStringPref("amail.theme.palette", palette);
    await AmailTheme.apply();
    await renderGeneral();
    themeStatus("amail-settings-theme-imported", { name });
  } catch (e) {
    if (!(e instanceof AmailThemeError)) {
      console.error(e);
    }
    themeStatus("amail-settings-theme-error", {
      reason: e instanceof AmailThemeError ? e.message : String(e),
    });
  }
}

async function exportTheme() {
  const palette = Services.prefs.getStringPref("amail.theme.palette");
  const name = AmailTheme.exportName(palette);
  const path = await pickThemeFile(Ci.nsIFilePicker.modeSave, `${name}.css`);
  if (!path) {
    return;
  }
  await AmailTheme.exportFile(palette, path);
  themeStatus("amail-settings-theme-exported", { name, file: PathUtils.filename(path) });
}

async function deleteTheme() {
  const palette = Services.prefs.getStringPref("amail.theme.palette");
  const name = AmailTheme.exportName(palette);
  const [title, message] = await document.l10n.formatValues([
    "amail-settings-theme-delete",
    { id: "amail-settings-theme-delete-confirm", args: { name } },
  ]);
  if (!Services.prompt.confirm(window, title, message)) {
    return;
  }
  await AmailTheme.deleteImported(palette);
  await AmailTheme.apply();
  await renderGeneral();
  themeStatus("amail-settings-theme-deleted", { name });
}

/** Fill the Colors list with the imported themes and update the buttons. */
async function renderPalettes() {
  const group = $("paletteImported");
  const imported = await AmailTheme.listImported();
  group.replaceChildren(
    ...imported.map(theme => el("option", { value: theme.palette, text: theme.name }))
  );
  group.hidden = !imported.length;
  const palette = Services.prefs.getStringPref("amail.theme.palette");
  $("palette").value = palette;
  $("themeExport").disabled = !AmailTheme.canExport(palette);
  $("themeDelete").hidden = !palette.startsWith(AmailTheme.CUSTOM_PREFIX);
}

async function renderGeneral() {
  await renderPalettes();
  const markMode = $("markReadMode");
  if (!Services.prefs.getBoolPref("mailnews.mark_message_read.auto")) {
    markMode.value = "never";
  } else if (Services.prefs.getBoolPref("mailnews.mark_message_read.delay")) {
    markMode.value = "after";
  } else {
    markMode.value = "now";
  }
  $("markReadDelay").hidden = markMode.value != "after";

  const themeMode = $("themeMode");
  const themes = await AddonManager.getAddonsByTypes(["theme"]);
  const active = themes.find(theme => theme.isActive)?.id;
  const values = [...themeMode.options].map(option => option.value);
  themeMode.value = values.includes(active) ? active : "default-theme@mozilla.org";
  const forced = AmailTheme.forcedTheme;
  themeMode.disabled = !!forced;
  $("themeModeForced").hidden = !forced;
  if (forced) {
    document.l10n.setAttributes(
      $("themeModeForced"),
      themeMode.value == "thunderbird-compact-dark@mozilla.org"
        ? "amail-settings-theme-forced-dark"
        : "amail-settings-theme-forced-light"
    );
  }
}

// Accounts

function renderAccounts() {
  const table = $("accountList");
  table.replaceChildren();
  const defaultAccount = MailServices.accounts.defaultAccount;
  for (const account of MailServices.accounts.accounts) {
    const server = account.incomingServer;
    if (!server) {
      continue;
    }
    const email = account.defaultIdentity?.email ?? "";
    const name = el("td");
    name.append(el("strong", { text: server.prettyName }));
    if (account == defaultAccount) {
      name.append(" ", el("span.badge", { l10n: "amail-settings-account-default" }));
    }
    if (email && email != server.prettyName) {
      name.append(el("br"), el("span.dim", { text: email }));
    }
    const host =
      server.type == "none"
        ? ""
        : `${server.type.toUpperCase()} · ${server.hostname}`;
    const actions = el(
      "td.end",
      {},
      button("amail-settings-edit", () => dialog.openAccounts(server))
    );
    if (server.protocolInfo.canDelete) {
      actions.append(
        " ",
        button("amail-settings-remove", () => removeAccount(account), "danger")
      );
    }
    table.append(el("tr", {}, name, el("td.dim", { text: host }), actions));
  }
  if (!table.rows.length) {
    table.append(
      el("tr", {}, el("td.dim", { l10n: "amail-settings-accounts-none" }))
    );
  }
}

function removeAccount(account) {
  const args = { account, result: false };
  top.openDialog(
    "chrome://messenger/content/removeAccount.xhtml",
    "",
    "chrome,modal,centerscreen,titlebar,resizable=no",
    args
  );
  renderAccounts();
}

// Signatures & templates

function renderSignatures() {
  const container = $("signatureList");
  container.replaceChildren();
  for (const identity of MailServices.accounts.allIdentities) {
    if (identity.email) {
      container.append(signatureBlock(identity));
    }
  }
  renderTemplates();
}

/**
 * The signatures of one address: each with a name and text, plus which one
 * new messages and replies get. Saved as you type.
 *
 * @param {nsIMsgIdentity} identity
 * @returns {HTMLElement}
 */
function signatureBlock(identity) {
  const list = structuredClone(AmailSignatures.list(identity));
  let { newId, replyId } = AmailSignatures.defaults(identity);
  const block = el("div.signature");
  let saveTimer;

  const save = () => {
    clearTimeout(saveTimer);
    AmailSignatures.save(identity, list, newId, replyId);
  };
  const saveSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  };

  const defaultSelect = (l10n, value, onChange) => {
    const select = el("select");
    select.append(el("option", { value: "", l10n: "amail-settings-signature-none" }));
    for (const sig of list) {
      select.append(el("option", { value: sig.id, text: sig.name }));
    }
    select.value = list.some(s => s.id == value) ? value : "";
    select.addEventListener("change", () => {
      onChange(select.value);
      save();
    });
    return el("label.field", {}, el("span", { l10n }), select);
  };

  const draw = () => {
    const heading = el("h3", {}, identity.fullName || identity.email);
    if (identity.fullName) {
      heading.append(" ", el("span.dim", { text: identity.email }));
    }
    block.replaceChildren(heading);
    if (identity.attachSignature && identity.signature && !AmailSignatures.isManaged(identity)) {
      block.append(
        el("p.note", {
          l10n: ["amail-settings-signature-file", { path: identity.signature.path }],
        })
      );
    }
    for (const sig of list) {
      const name = el("input", { type: "text", value: sig.name });
      document.l10n.setAttributes(name, "amail-settings-signature-name");
      name.addEventListener("input", () => {
        sig.name = name.value.trim() || sig.name;
        saveSoon();
      });
      name.addEventListener("change", draw);
      const text = el("textarea", { rows: 4, value: sig.text, spellcheck: false });
      text.setAttribute("aria-label", sig.name);
      text.addEventListener("input", () => {
        sig.text = text.value;
        saveSoon();
      });
      const remove = button(
        "amail-settings-delete",
        () => {
          list.splice(list.indexOf(sig), 1);
          if (newId == sig.id) {
            newId = "";
          }
          if (replyId == sig.id) {
            replyId = "";
          }
          save();
          draw();
        },
        "danger"
      );
      block.append(el("div.signature-item", {}, el("div.signature-name", {}, name, remove), text));
    }
    if (!list.length) {
      block.append(el("p.dim", { l10n: "amail-settings-signatures-none" }));
    }
    block.append(
      el(
        "div.row.signature-defaults",
        {},
        button("amail-settings-signature-add", async () => {
          const id = `sig${Date.now().toString(36)}`;
          const n = list.length + 1;
          const name = await document.l10n.formatValue(
            "amail-settings-signature-default-name",
            { n }
          );
          list.push({ id, name, text: "" });
          if (!newId) {
            newId = id;
          }
          if (!replyId && list.length == 1) {
            replyId = id;
          }
          save();
          draw();
          block.querySelector(".signature-item:last-of-type textarea")?.focus();
        }),
        defaultSelect("amail-settings-signature-for-new", newId, v => (newId = v)),
        defaultSelect("amail-settings-signature-for-replies", replyId, v => (replyId = v))
      )
    );
  };
  draw();
  return block;
}

function renderTemplates() {
  const table = $("templateList");
  table.replaceChildren();
  const seen = new Set();
  for (const identity of MailServices.accounts.allIdentities) {
    const uri = identity.templatesFolderURI;
    if (!uri || seen.has(uri)) {
      continue;
    }
    seen.add(uri);
    const folder = MailServices.folderLookup.getFolderForURL(uri);
    let messages = [];
    try {
      messages = folder ? [...folder.messages] : [];
    } catch (e) {
      // No database yet: the folder has never been opened.
    }
    for (const hdr of messages) {
      table.append(
        el(
          "tr",
          {},
          el(
            "td",
            {},
            hdr.mime2DecodedSubject
              ? el("strong", { text: hdr.mime2DecodedSubject })
              : el("strong", { l10n: "amail-settings-no-subject" }),
            el("br"),
            el("span.dim", { text: identity.email })
          ),
          el(
            "td.end",
            {},
            button(
              "amail-settings-delete",
              () => {
                folder.deleteMessages([hdr], top.msgWindow, true, false, null, false);
                setTimeout(renderTemplates, 300);
              },
              "danger"
            )
          )
        )
      );
    }
  }
  if (!table.rows.length) {
    table.append(
      el("tr", {}, el("td.dim", { l10n: "amail-settings-templates-none" }))
    );
  }
}

// Trusted senders

function renderTrusted() {
  const table = $("trustedList");
  table.replaceChildren();
  const allowed = Services.perms.all.filter(
    perm => perm.type == "image" && perm.capability == Services.perms.ALLOW_ACTION
  );
  const rows = allowed
    .map(perm => {
      const origin = perm.principal.origin;
      const sender = origin.startsWith(EMAIL_ORIGIN);
      return {
        perm,
        sender,
        // Sites by full origin: http and https are separate entries.
        value: sender ? origin.slice(EMAIL_ORIGIN.length) : origin,
      };
    })
    .sort((a, b) => b.sender - a.sender || a.value.localeCompare(b.value));
  const query = $("trustedSearch").value.trim().toLowerCase();
  const shown = query
    ? rows.filter(row => row.value.toLowerCase().includes(query))
    : rows;
  document.l10n.setAttributes(
    $("trustedCount"),
    query ? "amail-settings-trusted-count-filtered" : "amail-settings-trusted-count",
    { count: rows.length, shown: shown.length }
  );
  for (const { perm, sender, value } of shown) {
    table.append(
      el(
        "tr",
        {},
        el("td.dim", {
          l10n: !sender
            ? "amail-settings-trusted-site"
            : value.startsWith("@")
              ? "amail-settings-trusted-domain"
              : "amail-settings-trusted-sender",
        }),
        el("td", {}, el("strong", { text: value })),
        el(
          "td.end",
          {},
          button(
            "amail-settings-remove",
            () => {
              Services.perms.removePermission(perm);
              renderTrusted();
            },
            "danger"
          )
        )
      )
    );
  }
  if (!table.rows.length) {
    table.append(
      el(
        "tr",
        {},
        el("td.dim", {
          l10n: query ? "amail-settings-trusted-no-match" : "amail-settings-trusted-none",
        })
      )
    );
  }
}

function openPermissions() {
  const bundle = Services.strings.createBundle(
    "chrome://messenger/locale/preferences/preferences.properties"
  );
  top.openDialog(
    "chrome://messenger/content/preferences/permissions.xhtml",
    "",
    "chrome,modal,centerscreen,titlebar,resizable",
    {
      blockVisible: true,
      sessionVisible: false,
      allowVisible: true,
      prefilledHost: "",
      permissionType: "image",
      windowTitle: bundle.GetStringFromName("imagepermissionstitle"),
      introText: bundle.GetStringFromName("imagepermissionstext"),
    }
  );
  renderTrusted();
}

// Filters

function editFilter(args) {
  top.openDialog(
    "chrome://messenger/content/FilterEditor.xhtml",
    "FilterEditor",
    "chrome,modal,titlebar,resizable,centerscreen",
    args
  );
  if (args.refresh) {
    args.filterList.saveToDefaultFile();
    renderFilters();
  }
}

function renderFilters() {
  const container = $("filterList");
  container.replaceChildren();
  for (const server of MailServices.accounts.allServers) {
    if (!server.canHaveFilters) {
      continue;
    }
    let filterList;
    try {
      filterList = server.rootFolder.getEditableFilterList(top.msgWindow);
    } catch (e) {
      console.error(e);
      continue;
    }
    const table = el("table.table");
    for (let i = 0; i < filterList.filterCount; i++) {
      const filter = filterList.getFilterAt(i);
      const enabled = el("input", { type: "checkbox", checked: filter.enabled });
      document.l10n.setAttributes(enabled, "amail-settings-filter-enabled");
      enabled.addEventListener("change", () => {
        filter.enabled = enabled.checked;
        filterList.saveToDefaultFile();
      });
      table.append(
        el(
          "tr",
          {},
          el("td.toggle", {}, enabled),
          el("td", {}, el("strong", { text: filter.filterName })),
          el(
            "td.end",
            {},
            button("amail-settings-edit", () => editFilter({ filter, filterList })),
            " ",
            button(
              "amail-settings-delete",
              async () => {
                const question = await document.l10n.formatValue(
                  "amail-settings-filter-delete-confirm",
                  { name: filter.filterName }
                );
                if (!Services.prompt.confirm(top, null, question)) {
                  return;
                }
                filterList.removeFilter(filter);
                filterList.saveToDefaultFile();
                renderFilters();
              },
              "danger"
            )
          )
        )
      );
    }
    if (!filterList.filterCount) {
      table.append(
        el("tr", {}, el("td.dim", { l10n: "amail-settings-filters-none" }))
      );
    }
    container.append(
      el(
        "div.group",
        {},
        el(
          "div.group-head",
          {},
          el("h3", { text: server.prettyName }),
          button("amail-settings-new-filter", () =>
            editFilter({ filterList, filterPosition: filterList.filterCount })
          )
        ),
        table
      )
    );
  }
}

// About

async function renderAbout() {
  document.l10n.setAttributes($("aboutVersion"), "amail-settings-about-version", {
    version: Services.appinfo.version,
  });
  $("aboutDataDir").textContent = PathUtils.profileDir;
}

/**
 * Write <Start menu>\Programs\<brand>.lnk pointing at the running amail.exe.
 * A shortcut of that name that starts another program (the Rust aMail also
 * ships an amail.exe) is only replaced after asking.
 *
 * @param {nsIFile} [folder] - Where to put it; the user's Start menu
 *   Programs folder by default (the debug check passes a temp folder).
 * @returns {Promise<string>} The Fluent id of the status shown.
 */
async function addStartMenuShortcut(folder) {
  const status = $("startMenuStatus");
  const show = (id, args) => {
    document.l10n.setAttributes(status, id, args);
    status.hidden = false;
    return id;
  };
  const shell = Cc["@mozilla.org/mail/shell-service;1"].getService(
    Ci.nsIShellService
  );
  const name = Services.strings
    .createBundle("chrome://branding/locale/brand.properties")
    .GetStringFromName("brandShortName");
  const link = folder?.clone() ?? Services.dirsvc.get("Progs", Ci.nsIFile);
  link.append(`${name}.lnk`);
  const exe = Services.dirsvc.get("XREExeF", Ci.nsIFile).path;

  const existed = link.exists();
  if (existed) {
    const target = shell.getShortcutTarget(link);
    if (target && target.toLowerCase() != exe.toLowerCase()) {
      const [title, question] = await document.l10n.formatValues([
        { id: "amail-settings-start-menu-replace-title" },
        {
          id: "amail-settings-start-menu-replace",
          args: { name, target },
        },
      ]);
      if (!Services.prompt.confirm(top, title, question)) {
        status.hidden = true;
        return "cancelled";
      }
    }
  }
  try {
    shell.createAppShortcut(link, name);
  } catch (e) {
    console.error(e);
    return show("amail-settings-start-menu-error", {
      message: e.message,
    });
  }
  return show(
    existed
      ? "amail-settings-start-menu-updated"
      : "amail-settings-start-menu-added",
    { name }
  );
}
window.amailAddStartMenuShortcut = addStartMenuShortcut;

// Wiring

const tabs = [...document.querySelectorAll("[role=tab]")];
for (const tab of tabs) {
  tab.addEventListener("click", () => showTab(tab.dataset.tab));
}
$("tabs").addEventListener("keydown", event => {
  const index = tabs.indexOf(document.activeElement);
  if (index < 0) {
    return;
  }
  const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
  if (!step) {
    return;
  }
  const rtl = document.dir == "rtl" ? -1 : 1;
  const next = tabs[(index + step * rtl + tabs.length) % tabs.length];
  next.focus();
  showTab(next.dataset.tab);
  event.preventDefault();
});
$("allSettings").addEventListener("click", () => dialog.open("paneGeneral"));
$("junkAccounts").addEventListener("click", () =>
  dialog.openAccounts(
    MailServices.accounts.defaultAccount?.incomingServer,
    "am-junk.xhtml"
  )
);
$("addAccount").addEventListener("click", () => {
  dialog.close();
  top.openAccountHub("MAIL");
});
$("importProfile").addEventListener("click", () => {
  top.amailOpenImport();
  renderAccounts();
});
$("trustedMore").addEventListener("click", openPermissions);
$("trustedSearch").addEventListener("input", () => renderTrusted());
$("filterManager").addEventListener("click", () => {
  top.MsgFilters();
  renderFilters();
});
$("openDataDir").addEventListener("click", () => {
  Services.dirsvc.get("ProfD", Ci.nsIFile).launch();
});
$("aboutDetails").addEventListener("click", () => top.openAboutDialog());
$("startMenuAdd").addEventListener("click", () => addStartMenuShortcut());
$("startMenuBox").hidden = Services.appinfo.OS != "WINNT";
window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));
window.addEventListener("focus", () => {
  const current = location.hash.slice(1);
  if (["accounts", "trusted", "filters"].includes(current)) {
    renderers[current]();
  }
});

bindPrefs();
showTab(location.hash.slice(1));
