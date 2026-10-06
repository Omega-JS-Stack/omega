/**
 * Test: services/metadata.js — the document metadata stamp
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
const Metadata = require('../../dist/omega/services/metadata.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// The service only reaches ctx.log().
const ctx = { log: () => {} };

module.exports = defineCases({
  description: 'Metadata.set() document stamping',
  type: 'group',

  tests: [
    // ─── Shape ───

    {
      name: 'stamps-updated-and-tag-on-a-bare-document',
      async run({ expect }) {
        const doc = {};
        const metadata = new Metadata(ctx).set({}, doc);

        expect(typeof metadata.updated.timestamp).toBe('string');
        expect(typeof metadata.updated.timestampUNIX).toBe('number');
        expect(typeof metadata.tag).toBe('string');
        expect(doc.metadata, 'the stamp is written onto the document').toBe(metadata);
      },
    },

    {
      name: 'timestamp-and-timestampUNIX-describe-the-same-instant',
      async run({ expect }) {
        const metadata = new Metadata(ctx).set({}, {});
        const iso = metadata.updated.timestamp;

        expect(iso.endsWith('Z'), 'ISO-8601 in UTC').toBe(true);
        expect(Math.floor(new Date(iso).getTime() / 1000)).toBe(metadata.updated.timestampUNIX);
      },
    },

    // ─── The tag ───

    {
      name: 'a-supplied-tag-is-used-verbatim',
      async run({ expect }) {
        const metadata = new Metadata(ctx).set({ tag: 'evt_abc123' }, {});

        expect(metadata.tag).toBe('evt_abc123');
      },
    },

    {
      name: 'an-absent-tag-becomes-a-fresh-uuid-every-time',
      async run({ expect }) {
        const first = new Metadata(ctx).set({}, {});
        const second = new Metadata(ctx).set({}, {});

        expect(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(first.tag)).toBe(true);
        expect(first.tag === second.tag, 'two stamps never share a tag').toBe(false);
      },
    },

    // ─── Preservation: the birth time must survive a re-stamp ───

    {
      name: 're-stamping-refreshes-updated-and-preserves-created',
      async run({ expect }) {
        const doc = {
          name: 'keep me',
          metadata: {
            created: { timestamp: '2020-01-01T00:00:00.000Z', timestampUNIX: 1577836800 },
            updated: { timestamp: '2020-01-01T00:00:00.000Z', timestampUNIX: 1577836800 },
            tag: 'old-tag',
          },
        };

        const metadata = new Metadata(ctx).set({ tag: 'new-tag' }, doc);

        expect(metadata.created).toEqual({ timestamp: '2020-01-01T00:00:00.000Z', timestampUNIX: 1577836800 });
        expect(metadata.updated.timestamp === '2020-01-01T00:00:00.000Z', 'updated moved').toBe(false);
        expect(metadata.updated.timestampUNIX > 1577836800).toBe(true);
        expect(metadata.tag).toBe('new-tag');
        expect(doc.name, 'non-metadata fields are untouched').toBe('keep me');
      },
    },

    {
      name: 'a-document-with-partial-metadata-is-filled-in',
      async run({ expect }) {
        const doc = { metadata: { created: { timestamp: '2020-01-01T00:00:00.000Z' } } };

        const metadata = new Metadata(ctx).set({}, doc);

        expect(metadata.created.timestamp).toBe('2020-01-01T00:00:00.000Z');
        expect(typeof metadata.updated.timestampUNIX).toBe('number');
      },
    },

    // ─── No document at all ───

    {
      name: 'an-absent-document-stamps-onto-a-fresh-one',
      async run({ expect }) {
        const metadata = new Metadata(ctx).set({});

        expect(typeof metadata.updated.timestamp).toBe('string');
        expect(typeof metadata.tag).toBe('string');
      },
    },
  ],
});
