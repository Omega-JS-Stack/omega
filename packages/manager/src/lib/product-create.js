/**
 * Create-on-missing for the ITW product services — forms (Slapform contact
 * form), chat (Chatsy agent), email (Replyify agent). When a brand configures no
 * asset id, the OPERATOR service account mints a brand-OWNED asset instead
 * of the brand borrowing another brand's (2b, Ian 2026-07-13: "this shit
 * was supposed to create new accounts for the brand"):
 *
 *   1. Product USER — the brand's own account on the product, minted via
 *      the product project's Identity Toolkit (email = brand contact
 *      email; password through the account service's owner channels:
 *      env pin → owner hook → derived seed). The users/{uid} doc writes
 *      the CANONICAL @omega.js/account shape (the BEM golden master the
 *      products run) with real generated credentials — including
 *      api.privateKey, the user API key the products accept.
 *   2. The ASSET doc — shape-templated from an existing doc (the config's
 *      template id — typically the company's own richest example), with
 *      `owner` pointed at the new user. The service's normal ensures then
 *      converge every managed field (name, settings, knowledge, plan) in
 *      the SAME run, so the mint stays minimal and the convergence logic
 *      stays in one place.
 *
 * Auth tiers (Ian's call): operator SA = full create/manage (this lib) ·
 * user API key = recognized, manage via the product APIs lands when those
 * routes are verified · no credentials = the interactive dashboard
 * paste-back every service already ships.
 *
 * Idempotent by construction: the minted id writes back into omega.json5
 * (comment-preserving), so a rerun takes the normal converge path; an
 * existing product user is reused by email lookup.
 */
const { randomBytes, randomUUID } = require('node:crypto');
const chalk = require('chalk').default;

const { resolveAccount } = require('@omega.js/account');

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Random base62 string (rejection-free modulo is fine here — ids/keys,
 * not crypto material with uniformity proofs).
 * @param {number} size
 * @returns {string}
 */
function randomBase62(size) {
  const bytes = randomBytes(size);
  let out = '';
  for (let i = 0; i < size; i++) {
    out += BASE62[bytes[i] % BASE62.length];
  }
  return out;
}

/** New asset doc id — matches the products' visible 14-char convention. */
function generateAssetId() {
  return randomBase62(14);
}

/**
 * Ensure the brand has its own user on the product: reuse by email, else
 * create the auth user + the canonical users/{uid} doc.
 *
 * @param {object} spec
 * @param {object} spec.db - FirestoreREST on the product project (operator SA)
 * @param {object} spec.authAdmin - auth-admin client on the same SA
 * @param {string} spec.email - the brand's product-account email
 * @param {function} spec.resolvePassword - createPasswordResolver instance
 * @param {function} spec.log - line logger
 * @returns {Promise<{ uid: string, created: boolean }>}
 */
async function ensureProductUser(spec) {
  const { db, authAdmin, email, resolvePassword, log } = spec;

  const existing = await authAdmin.getUserByEmail(email);
  if (existing) {
    log(`${chalk.green('✓')} Product user exists: ${chalk.cyan(email)} ${chalk.dim(`(${existing.uid})`)}`);
    return { uid: existing.uid, created: false };
  }

  const { password, source } = await resolvePassword(email);
  if (!password) {
    throw new Error(`no password available for ${email} (channel: ${source})`);
  }

  const created = await authAdmin.createUser({ email, password });

  // The canonical account shape (the BEM golden master) with REAL generated
  // credentials — a direct write, since the product's own auth-onCreate
  // trigger only fires for its backend, not for admin REST creates.
  const userDoc = resolveAccount({ auth: { uid: created.uid, email } }, {
    generators: {
      uuid: () => randomUUID(),
      randomId: () => randomBase62(8),
      apiKey: () => randomBase62(43),
    },
  });
  await db.setDoc(`users/${created.uid}`, userDoc);

  log(`${chalk.green('✓')} Product user created: ${chalk.cyan(email)} ${chalk.dim(`(${created.uid}, password via ${source})`)}`);
  return { uid: created.uid, created: true };
}

/**
 * Mint a brand-owned product asset from a template doc.
 *
 * @param {object} spec
 * @param {object} spec.db - FirestoreREST on the product project (operator SA)
 * @param {object} spec.authAdmin - auth-admin client on the same SA
 * @param {string} spec.collection - 'forms' | 'chats' | 'agents' (the product's collection)
 * @param {string} spec.templateId - existing doc to shape-template from
 * @param {object} spec.overrides - fields the mint sets outright (beyond owner)
 * @param {string} spec.email - brand product-account email
 * @param {function} spec.resolvePassword - createPasswordResolver instance
 * @param {boolean} spec.dryRun
 * @param {function} spec.log - line logger (indented by the caller)
 * @returns {Promise<{ id: string, ownerUid: string }|null>} null on dry-run
 */
async function createProductAsset(spec) {
  const { db, authAdmin, collection, templateId, overrides = {}, email, resolvePassword, dryRun, log } = spec;

  const template = await db.getDoc(`${collection}/${templateId}`);
  if (!template) {
    throw new Error(`template doc ${collection}/${templateId} not found — check the template id in omega.json5`);
  }

  if (dryRun) {
    log(`${chalk.yellow('[DRY RUN]')} Would create ${chalk.cyan(collection)} doc from template ${chalk.dim(templateId)} + product user ${chalk.cyan(email)}`);
    return null;
  }

  const { uid } = await ensureProductUser({ db, authAdmin, email, resolvePassword, log });

  const id = generateAssetId();
  // BEM docs mirror their doc id in an `id` field — a copied donor id would
  // self-reference the WRONG doc. Donor usage counters copy as-is (their
  // shape is product-specific; the product resets them on its own cycle).
  const doc = { ...template, ...overrides, owner: uid, ...(template.id !== undefined ? { id } : {}) };
  await db.setDoc(`${collection}/${id}`, doc);

  log(`${chalk.green('✓')} Created ${chalk.cyan(`${collection}/${id}`)} from template ${chalk.dim(templateId)} ${chalk.dim(`(fields: ${Object.keys(doc).sort().join(', ')})`)}`);

  return { id, ownerUid: uid };
}

module.exports = { createProductAsset, ensureProductUser, generateAssetId, randomBase62 };
