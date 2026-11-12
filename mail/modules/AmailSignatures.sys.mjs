/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * aMail named signatures: each identity has a list of signatures and one
 * default for new messages and one for replies and forwards. They are kept
 * in identity attributes; the default is also written to Thunderbird's own
 * signature settings, so its compose code inserts it as usual. The compose
 * window then swaps it for the reply default where that differs.
 */

const LIST = "amail_signatures";
const NEW_DEFAULT = "amail_sig_new";
const REPLY_DEFAULT = "amail_sig_reply";

/**
 * @typedef {object} Signature
 * @property {string} id
 * @property {string} name
 * @property {string} text - HTML, or plain text (line breaks kept).
 */

function escapeHTML(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export const AmailSignatures = {
  /**
   * The signature as HTML. Text without tags is plain text: its line breaks
   * are kept.
   *
   * @param {string} text
   * @returns {string}
   */
  toHTML(text) {
    if (/<[a-z][^>]*>/i.test(text)) {
      return text;
    }
    return escapeHTML(text).replace(/\r?\n/g, "<br>");
  },

  /**
   * @param {nsIMsgIdentity} identity
   * @returns {boolean} true once the signatures were edited in aMail.
   */
  isManaged(identity) {
    return !!identity.getUnicharAttribute(LIST);
  },

  /**
   * @param {nsIMsgIdentity} identity
   * @returns {Signature[]}
   */
  list(identity) {
    const raw = identity.getUnicharAttribute(LIST);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {
        console.error(e);
      }
    }
    // Not edited in aMail yet: Thunderbird's signature, if it has one.
    if (identity.attachSignature || !identity.htmlSigText.trim()) {
      return [];
    }
    return [{ id: "sig1", name: "Signature", text: identity.htmlSigText }];
  },

  /**
   * @param {nsIMsgIdentity} identity
   * @returns {{newId: string, replyId: string}} Empty for no signature.
   */
  defaults(identity) {
    if (this.isManaged(identity)) {
      return {
        newId: identity.getCharAttribute(NEW_DEFAULT),
        replyId: identity.getCharAttribute(REPLY_DEFAULT),
      };
    }
    const first = this.list(identity)[0]?.id ?? "";
    return {
      newId: first,
      replyId: identity.sigOnReply || identity.sigOnForward ? first : "",
    };
  },

  /**
   * @param {nsIMsgIdentity} identity
   * @param {string} id
   * @returns {?Signature}
   */
  get(identity, id) {
    return this.list(identity).find(s => s.id == id) ?? null;
  },

  /**
   * Save the signatures of an identity and pass the default on to
   * Thunderbird's signature settings.
   *
   * @param {nsIMsgIdentity} identity
   * @param {Signature[]} list
   * @param {string} newId
   * @param {string} replyId
   */
  save(identity, list, newId, replyId) {
    identity.setUnicharAttribute(LIST, JSON.stringify(list));
    identity.setCharAttribute(NEW_DEFAULT, newId);
    identity.setCharAttribute(REPLY_DEFAULT, replyId);
    const inserted =
      list.find(s => s.id == newId) ?? list.find(s => s.id == replyId);
    identity.attachSignature = false;
    identity.htmlSigFormat = true;
    identity.htmlSigText = inserted ? this.toHTML(inserted.text) : "";
    identity.sigOnReply = !!replyId;
    identity.sigOnForward = !!replyId;
  },
};
