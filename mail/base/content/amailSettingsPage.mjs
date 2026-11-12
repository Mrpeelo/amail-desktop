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
const { AddonManager } = ChromeUtils.importESModule(
  "resource://gre/modules/AddonManager.sys.mjs"
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
}

async function renderGeneral() {
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
  const list = $("signatureList");
  list.replaceChildren();
  for (const identity of MailServices.accounts.allIdentities) {
    if (!identity.email) {
      continue;
    }
    const heading = el("h3", {}, identity.fullName || identity.email);
    if (identity.fullName) {
      heading.append(" ", el("span.dim", { text: identity.email }));
    }
    const text = el("textarea", {
      rows: 4,
      value: identity.htmlSigText,
      spellcheck: false,
    });
    text.setAttribute("aria-label", identity.email);
    let saveTimer;
    text.addEventListener("input", () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => (identity.htmlSigText = text.value), 300);
    });
    text.addEventListener("change", () => {
      clearTimeout(saveTimer);
      identity.htmlSigText = text.value;
    });

    const html = el("input", { type: "checkbox", checked: identity.htmlSigFormat });
    html.addEventListener("change", () => (identity.htmlSigFormat = html.checked));
    const replies = el("input", {
      type: "checkbox",
      checked: identity.sigOnReply && identity.sigOnForward,
    });
    replies.addEventListener("change", () => {
      identity.sigOnReply = replies.checked;
      identity.sigOnForward = replies.checked;
    });

    const item = el("div.signature", {}, heading);
    if (identity.attachSignature && identity.signature) {
      item.append(
        el("p.note", {
          l10n: ["amail-settings-signature-file", { path: identity.signature.path }],
        })
      );
    }
    item.append(
      text,
      el(
        "div.inline",
        {},
        el("label.check", {}, html, el("span", { l10n: "amail-settings-signature-html" })),
        el("label.check", {}, replies, el("span", { l10n: "amail-settings-signature-replies" }))
      )
    );
    list.append(item);
  }
  renderTemplates();
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
        value: sender ? origin.slice(EMAIL_ORIGIN.length) : perm.principal.host || origin,
      };
    })
    .sort((a, b) => b.sender - a.sender || a.value.localeCompare(b.value));
  for (const { perm, sender, value } of rows) {
    table.append(
      el(
        "tr",
        {},
        el("td.dim", {
          l10n: sender ? "amail-settings-trusted-sender" : "amail-settings-trusted-site",
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
      el("tr", {}, el("td.dim", { l10n: "amail-settings-trusted-none" }))
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
$("filterManager").addEventListener("click", () => {
  top.MsgFilters();
  renderFilters();
});
$("openDataDir").addEventListener("click", () => {
  Services.dirsvc.get("ProfD", Ci.nsIFile).launch();
});
$("aboutDetails").addEventListener("click", () => top.openAboutDialog());
window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));
window.addEventListener("focus", () => {
  const current = location.hash.slice(1);
  if (["accounts", "trusted", "filters"].includes(current)) {
    renderers[current]();
  }
});

bindPrefs();
showTab(location.hash.slice(1));
