/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * aMail "Search server": runs the search text on the mail servers (IMAP
 * SEARCH: subject, sender or body contains it), so mail whose body was never
 * downloaded is found too. Gmail is searched in All Mail (every label);
 * other IMAP accounts in Inbox, Sent and Archives. The results are a
 * synthetic view for a message list tab, like Thunderbird's global search.
 */

const { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);

const F = Ci.nsMsgFolderFlags;

/** @returns {nsIMsgFolder[]} the folders to search on the servers. */
export function serverSearchFolders() {
  const folders = [];
  for (const account of MailServices.accounts.accounts) {
    const server = account.incomingServer;
    if (server?.type != "imap") {
      continue;
    }
    const root = server.rootFolder;
    const gmail = server.QueryInterface(Ci.nsIImapIncomingServer).isGMailServer;
    const archive = root.getFolderWithFlags(F.Archive);
    if (gmail && archive) {
      folders.push(archive);
      continue;
    }
    for (const flag of [F.Inbox, F.SentMail, F.Archive]) {
      const folder = root.getFolderWithFlags(flag);
      if (folder && !folders.includes(folder)) {
        folders.push(folder);
      }
    }
  }
  return folders;
}

/**
 * @param {string} query - The text to search for.
 */
export function AmailServerSearchView(query) {
  this.query = query;
  this.viewType = "global";
  this.customColumns = [];
  this.hits = [];
  this.session = null;
}

AmailServerSearchView.prototype = {
  defaultSort: [[Ci.nsMsgViewSortType.byDate, Ci.nsMsgViewSortOrder.descending]],

  search(searchListener, completionCallback) {
    this.searchListener = searchListener;
    this.completionCallback = completionCallback;
    searchListener.onNewSearch();

    const folders = serverSearchFolders();
    if (!folders.length || !this.query.trim()) {
      this.abortSearch();
      return;
    }
    const session = (this.session = Cc[
      "@mozilla.org/messenger/searchSession;1"
    ].createInstance(Ci.nsIMsgSearchSession));
    for (const folder of folders) {
      session.addScopeTerm(Ci.nsMsgSearchScope.onlineMail, folder);
    }
    // Subject, sender or body contains the text.
    for (const attrib of [
      Ci.nsMsgSearchAttrib.Subject,
      Ci.nsMsgSearchAttrib.Sender,
      Ci.nsMsgSearchAttrib.Body,
    ]) {
      const term = session.createTerm();
      term.attrib = attrib;
      term.op = Ci.nsMsgSearchOp.Contains;
      const value = term.value;
      value.attrib = attrib;
      value.str = this.query.trim();
      term.value = value;
      term.booleanAnd = false;
      session.appendTerm(term);
    }
    const seen = new Set();
    session.registerListener({
      QueryInterface: ChromeUtils.generateQI(["nsIMsgSearchNotify"]),
      onNewSearch: () => {},
      onSearchHit: (hdr, folder) => {
        // A message can be in more than one searched folder.
        if (seen.has(hdr.messageId)) {
          return;
        }
        seen.add(hdr.messageId);
        this.hits.push(hdr);
        this.searchListener?.onSearchHit(hdr, folder);
      },
      onSearchDone: () => this.abortSearch(),
    });
    const msgWindow = Services.wm.getMostRecentWindow("mail:3pane")?.msgWindow;
    session.search(msgWindow ?? null);
  },

  abortSearch() {
    if (this.searchListener) {
      this.searchListener.onSearchDone(Cr.NS_OK);
    }
    if (this.completionCallback) {
      this.completionCallback();
    }
    this.searchListener = null;
    this.completionCallback = null;
  },

  getMsgHdrForMessageID(messageId) {
    return this.hits.find(hdr => hdr.messageId == messageId) ?? null;
  },

  DEFAULT_COLUMN_STATES: {
    flaggedCol: { visible: true, ordinal: 1 },
    attachmentCol: { visible: true, ordinal: 2 },
    senderCol: { visible: true, ordinal: 3 },
    subjectCol: { visible: true, ordinal: 4 },
    locationCol: { visible: true, ordinal: 5 },
    dateCol: { visible: true, ordinal: 6 },
  },

  // about:3pane only opens a synthetic view that has a column layout.
  getPersistedSetting(setting) {
    return setting == "columns" ? this.DEFAULT_COLUMN_STATES : null;
  },

  setPersistedSetting() {},

  getDefaultSetting(setting) {
    return setting == "columns" ? this.DEFAULT_COLUMN_STATES : null;
  },
};

/**
 * Open the server results for a search text in a new message list tab.
 *
 * @param {Window} win - Any window of the main window.
 * @param {string} query
 */
export async function openServerSearch(win, query) {
  const top = win.browsingContext.topChromeWindow;
  const title = await top.document.l10n.formatValue(
    "amail-server-search-title",
    { query }
  );
  top.document.getElementById("tabmail").openTab("mail3PaneTab", {
    folderPaneVisible: false,
    syntheticView: new AmailServerSearchView(query),
    title,
    background: false,
  });
}
