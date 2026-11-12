/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * "Today at 10.18" for message list dates. The list shows only the time for
 * today's messages (mail.ui.display.dateformat.today), and a date on every
 * other day, so a time-only cell is today's.
 */

const TIME_ONLY = /^\d{1,2}[.:]\d{2}(?:\s?[AaPp]\.?[Mm]\.?)?$/;
let template = null;

document.l10n
  .formatValue("amail-date-today", { time: "\u0001" })
  .then(text => {
    if (text?.includes("\u0001")) {
      template = text;
      window.threadTree?.invalidate();
    }
  });

/**
 * @param {string} text - The date cell text from the view.
 * @returns {string} The text with "Today at" added to a time-only date.
 */
export function todayLabel(text) {
  if (!template || !TIME_ONLY.test(text.trim())) {
    return text;
  }
  return template.replace("\u0001", text.trim());
}
