/**
 * Metadata: the request service that stamps a document's `metadata` block.
 *
 * Every framework write stamps `metadata.updated` (ISO + UNIX, the same
 * instant) and a `tag` through this one service; `created` is never touched,
 * so a re-stamp cannot rewrite a document's birth time. The tag is the
 * caller's when given, else a fresh uuid: it is the idempotency handle events
 * dedupe on. Reached as `ctx.metadata({ tag }, document)`.
 */
const moment = require('moment');
const uuidv4 = require('uuid').v4;

/**
 * The document stamp, bound to one request context.
 */
class Metadata {
  /**
   * @param {object} ctx - the request Context (its log line names the stamp).
   */
  constructor(ctx) {
    this.ctx = ctx;
  }

  /**
   * Stamp a document and return its metadata block.
   * @param {object} [metadata] - { tag }: the tag to stamp, else a fresh uuid.
   * @param {object} [document] - the document the block is written onto (a fresh object when omitted).
   * @returns {object} the document's `metadata` block.
   */
  set(metadata = {}, document = {}) {
    const now = moment();

    document.metadata = document.metadata || {};

    document.metadata.updated = document.metadata.updated || {};
    document.metadata.updated.timestamp = now.toISOString();
    document.metadata.updated.timestampUNIX = now.unix();
    document.metadata.tag = metadata.tag || uuidv4();

    this.ctx.log(`Metadata: #${document.metadata.tag}`);

    return document.metadata;
  }
}

module.exports = Metadata;
