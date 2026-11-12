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
 * Checks by name. Each receives a function to record results.
 *
 * @type {Record<string, function(function(object): void): Promise<void>>}
 */
const CHECKS = {
  /**
   * Command bar without reply buttons; reading pane shows Reply + Reply All
   * on a message with several recipients.
   */
  async "reply-buttons"(record) {
    const about3Pane = window;
    const top = about3Pane.browsingContext.topChromeWindow;
    const barItems = [
      ...top.document.querySelectorAll("#unifiedToolbarContent li[item-id]"),
    ].map(li => li.getAttribute("item-id"));
    record({ label: "command bar items", barItems });

    const { threadTree } = about3Pane;
    const home = about3Pane.gFolder;
    const isMulti = hdr =>
      `${hdr.recipients},${hdr.ccList}`
        .split(",")
        .filter(a => a.includes("@")).length > 1;
    let found = null;
    for (const account of about3Pane.MailServices.accounts.accounts) {
      for (const folder of account.incomingServer.rootFolder.descendants) {
        if (folder.getTotalMessages(false) == 0 || folder.flags & Ci.nsMsgFolderFlags.Virtual) {
          continue;
        }
        try {
          let n = 0;
          for (const hdr of folder.messages) {
            if (isMulti(hdr)) {
              found = hdr;
              break;
            }
            if (++n > 300) {
              break;
            }
          }
        } catch {}
        if (found) {
          break;
        }
      }
      if (found) {
        break;
      }
    }
    if (!found) {
      record({ label: "no multi-recipient message found" });
      return;
    }
    const hdr = found;
    const wasRead = hdr.isRead;
    if (about3Pane.gFolder != hdr.folder) {
      about3Pane.displayFolder(hdr.folder.URI);
      await wait(2500);
    }
    const index = about3Pane.gDBView.findIndexOfMsgHdr(hdr, true);
    threadTree.selectedIndex = index;
    await wait(1500);
    const rdoc = about3Pane.document.getElementById("messageBrowser")
      .contentDocument;
    const visible = [...rdoc.querySelectorAll("#header-view-toolbar *[id]")]
      .filter(
        b =>
          b.localName == "toolbarbutton" &&
          b.getBoundingClientRect().width > 0
      )
      .map(b => `${b.id}@${Math.round(b.getBoundingClientRect().left)}`);
    record({ label: "multi-recipient message buttons", visible });
    record({
      label: "test message",
      folder: hdr.folder.localizedName,
      recipients: `${hdr.recipients} | cc ${hdr.ccList}`.slice(0, 120),
    });
    threadTree.selectedIndices = [];
    if (!wasRead) {
      hdr.folder.markMessagesRead([hdr], false);
    }
    if (home && about3Pane.gFolder != home) {
      about3Pane.displayFolder(home.URI);
      await wait(1500);
    }
  },
};

export async function runDebugChecks(names) {
  const out = [];
  const record = entry => out.push(entry);
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
