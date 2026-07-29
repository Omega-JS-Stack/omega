/**
 * Test: helpers/metadata.js — the document metadata stamp
 *
 * Run: npx omega test backend:helpers/metadata
 *
 * Every framework write stamps `metadata.updated` (ISO + UNIX) and a `tag`
 * through this one helper. The contracts that matter downstream:
 *   - `updated` is REFRESHED on every set, `created` is never touched (a
 *     re-stamp must not rewrite a document's birth time).
 *   - `tag` is caller-supplied when given, otherwise a fresh uuid — it is the
 *     idempotency handle events dedupe on.
 *   - timestamp and timestampUNIX describe the SAME instant.
 */
const Metadata = require('../../src/manager/helpers/metadata.js');

// The helper only reaches Manager.ctx.log().
const Manager = { ctx: { log: () => {} } };

module.exports = {
  description: 'Metadata.set() document stamping',
  type: 'group',

  tests: [
    // ─── Shape ───

    {
      name: 'stamps-updated-and-tag-on-a-bare-document',
      async run({ assert }) {
        const doc = {};
        const metadata = new Metadata(Manager, doc).set({});

        assert.equal(typeof metadata.updated.timestamp, 'string');
        assert.equal(typeof metadata.updated.timestampUNIX, 'number');
        assert.equal(typeof metadata.tag, 'string');
        assert.equal(doc.metadata, metadata, 'the stamp is written onto the document');
      },
    },

    {
      name: 'timestamp-and-timestampUNIX-describe-the-same-instant',
      async run({ assert }) {
        const metadata = new Metadata(Manager, {}).set({});
        const iso = metadata.updated.timestamp;

        assert.equal(iso.endsWith('Z'), true, 'ISO-8601 in UTC');
        assert.equal(Math.floor(new Date(iso).getTime() / 1000), metadata.updated.timestampUNIX);
      },
    },

    // ─── The tag ───

    {
      name: 'a-supplied-tag-is-used-verbatim',
      async run({ assert }) {
        const metadata = new Metadata(Manager, {}).set({ tag: 'evt_abc123' });

        assert.equal(metadata.tag, 'evt_abc123');
      },
    },

    {
      name: 'an-absent-tag-becomes-a-fresh-uuid-every-time',
      async run({ assert }) {
        const first = new Metadata(Manager, {}).set({});
        const second = new Metadata(Manager, {}).set({});

        assert.equal(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(first.tag), true);
        assert.equal(first.tag === second.tag, false, 'two stamps never share a tag');
      },
    },

    // ─── Preservation: the birth time must survive a re-stamp ───

    {
      name: 're-stamping-refreshes-updated-and-preserves-created',
      async run({ assert }) {
        const doc = {
          name: 'keep me',
          metadata: {
            created: { timestamp: '2020-01-01T00:00:00.000Z', timestampUNIX: 1577836800 },
            updated: { timestamp: '2020-01-01T00:00:00.000Z', timestampUNIX: 1577836800 },
            tag: 'old-tag',
          },
        };

        const metadata = new Metadata(Manager, doc).set({ tag: 'new-tag' });

        assert.deepEqual(metadata.created, { timestamp: '2020-01-01T00:00:00.000Z', timestampUNIX: 1577836800 });
        assert.equal(metadata.updated.timestamp === '2020-01-01T00:00:00.000Z', false, 'updated moved');
        assert.equal(metadata.updated.timestampUNIX > 1577836800, true);
        assert.equal(metadata.tag, 'new-tag');
        assert.equal(doc.name, 'keep me', 'non-metadata fields are untouched');
      },
    },

    {
      name: 'a-document-with-partial-metadata-is-filled-in',
      async run({ assert }) {
        const doc = { metadata: { created: { timestamp: '2020-01-01T00:00:00.000Z' } } };

        const metadata = new Metadata(Manager, doc).set({});

        assert.equal(metadata.created.timestamp, '2020-01-01T00:00:00.000Z');
        assert.equal(typeof metadata.updated.timestampUNIX, 'number');
      },
    },

    // ─── No document at all ───

    {
      name: 'an-absent-document-stamps-onto-a-fresh-one',
      async run({ assert }) {
        const instance = new Metadata(Manager);
        const metadata = instance.set({});

        assert.equal(typeof metadata.updated.timestamp, 'string');
        assert.equal(instance.document.metadata, metadata);
      },
    },
  ],
};
