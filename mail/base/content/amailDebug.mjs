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
const CHECKS = {};

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
