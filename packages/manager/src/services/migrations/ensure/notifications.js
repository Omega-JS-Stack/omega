/**
 * Notifications collection migration — converges push-subscription docs to
 * the canonical @omegajs/backend + @omegajs/client shape.
 *
 * Fixes:
 * - Renames `uid` field to `owner` and deletes `uid`
 * - Flattens `owner.uid` (object) to `owner` (string)
 * - Moves legacy created/updated → metadata.created/metadata.updated
 * - Moves `url` to `context.client.url` and builds the full context structure
 * - Adds empty `attribution` when missing
 * - Trims whitespace on all string values
 *
 * Validates:
 * - All fields match the expected schema
 */
const { runMigration, FieldValue } = require('../lib/migration-runner.js');
const { createMetadataFix } = require('../lib/ensure-metadata.js');
const { validateDocument } = require('../lib/schema-validator.js');
const { createSanitizeFix } = require('../lib/sanitize-strings.js');

/**
 * Default context structure from @omegajs/client's getContext()
 */
const DEFAULT_CONTEXT = {
  client: {
    language: null,
    mobile: null,
    device: null,
    platform: null,
    browser: null,
    vendor: null,
    runtime: null,
    userAgent: null,
    url: null,
  },
};

/**
 * Notifications collection schema
 * Based on @omegajs/client's notifications _saveSubscription()
 */
const schema = {
  token: { type: 'string', required: true },
  owner: { type: 'string', required: true, nullable: true },
  tags: { type: 'array', required: true, itemType: 'string' },
  attribution: { type: 'object', required: true },
  metadata: {
    type: 'object',
    required: true,
    properties: {
      created: {
        type: 'object',
        required: true,
        properties: {
          timestamp: { type: 'string', required: true },
          timestampUNIX: { type: 'number', required: true },
        },
      },
      updated: {
        type: 'object',
        required: true,
        properties: {
          timestamp: { type: 'string', required: true },
          timestampUNIX: { type: 'number', required: true },
        },
      },
    },
  },
  context: {
    type: 'object',
    required: true,
    properties: {
      client: {
        type: 'object',
        required: true,
        properties: {
          language: { type: 'string', required: true, nullable: true },
          mobile: { type: 'boolean', required: true, nullable: true },
          device: { type: 'string', required: true, nullable: true },
          platform: { type: 'string', required: true, nullable: true },
          browser: { type: 'string', required: true, nullable: true },
          vendor: { type: 'string', required: true, nullable: true },
          runtime: { type: 'string', required: true, nullable: true },
          userAgent: { type: 'string', required: true, nullable: true },
          url: { type: 'string', required: true, nullable: true },
        },
      },
    },
  },
};

/**
 * Notifications collection migration handler.
 *
 * @param {Object} context - Handler context
 * @returns {Object} Migration results
 */
module.exports = async function ensureNotifications(context) {
  return runMigration(context, {
    collection: 'notifications',

    fixes: [
      // Fix: uid → owner (rename + delete uid)
      (data) => {
        if (data.uid === undefined) {
          return null;
        }
        const updates = { uid: FieldValue.delete() };
        if (data.owner === undefined) {
          updates.owner = data.uid;
        }
        return updates;
      },

      // Fix: owner.uid (object) → owner (string)
      (data) => {
        if (typeof data.owner !== 'object' || data.owner?.uid === undefined) {
          return null;
        }
        return { owner: data.owner.uid };
      },

      // Fix: Move created/updated → metadata.created/metadata.updated
      // Falls back to the document's server createTime/updateTime if missing
      createMetadataFix({
        legacyCreatedFields: ['created'],
        legacyUpdatedFields: ['updated'],
      }),

      // Fix: build full context structure with all fields
      (data) => {
        const existing = data.context || {};
        const existingClient = existing.client || {};

        // Merge existing values over defaults
        const mergedClient = { ...DEFAULT_CONTEXT.client, ...existingClient };

        // If old url field exists, use it as context.client.url
        if (data.url && !existingClient.url) {
          mergedClient.url = data.url;
        }

        const merged = { client: mergedClient };

        // Check if anything changed
        const isComplete = data.context
          && JSON.stringify(data.context) === JSON.stringify(merged)
          && !data.url;

        if (isComplete) {
          return null;
        }

        const updates = { context: merged };
        if (data.url) {
          updates.url = FieldValue.delete();
        }
        return updates;
      },

      // Fix: add empty attribution when missing
      (data) => {
        if (data.attribution !== undefined) {
          return null;
        }
        return { attribution: {} };
      },

      // Fix: trim whitespace on all string values
      createSanitizeFix(),
    ],

    // Validate against schema
    validate: (data) => {
      return validateDocument(data, schema);
    },
  });
};
