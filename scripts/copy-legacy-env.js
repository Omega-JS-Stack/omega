/**
 * copy-legacy-env — copy selected secrets from the legacy omega-manager
 * .env into a brand's .env, without ever displaying a value.
 *
 *   node scripts/copy-legacy-env.js                 # core keys → playground
 *   node scripts/copy-legacy-env.js --dry-run       # show the plan only
 *   node scripts/copy-legacy-env.js --include=signing,stores
 *   node scripts/copy-legacy-env.js --only=CLOUDFLARE_TOKEN
 *   node scripts/copy-legacy-env.js --brand=brands/other-brand --force
 *
 * Ian runs this himself (credential moves are human-run by policy); the
 * script never prints secret values — only key names and what happened.
 *
 * Key groups (see KEY_GROUPS): `core` is the default — the services the
 * playground exercises next (cloudflare, domain, marketing fields,
 * recaptcha). `signing` (Apple/Windows desktop signing) and `stores`
 * (browser-store publish creds) are opt-in via --include because releases
 * and store publishes are still gated. Payment keys are NEVER copied —
 * live-mode payment stays gated by standing policy.
 *
 * Idempotent: a key the destination already sets to a non-empty value is
 * left alone (--force replaces it in place). Every copied value is rewritten
 * in the one KEY="value" form, on the key's own line or its `# KEY=""`
 * placeholder, appended when the destination has neither.
 */

// Libraries
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { envLine, assertEnvReadsBack } = require('@omega.js/config');
const { setEnvLines } = require('@omega.js/devkit/env-lines');

// Defaults
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_SOURCE = '/Users/ian/Developer/Repositories/ITW-Creative-Works/omega-manager/.env';
const DEFAULT_BRAND = 'brands/playground-omega';

// One authoritative list per group — key names only, never values.
const KEY_GROUPS = {
  core: [
    'CLOUDFLARE_TOKEN',
    'NAMECHEAP_API_KEY',
    'NAMECHEAP_USERNAME',
    'SENDGRID_API_KEY',
    'BEEHIIV_API_KEY',
    // The reCAPTCHA SITE key is config now, not a .env line (#893): only the
    // secret half can be copied between .env files
    'RECAPTCHA_SECRET_KEY',
  ],
  signing: [
    'APPLE_API_ISSUER',
    'APPLE_API_KEY',
    'APPLE_API_KEY_ID',
    'APPLE_KEYCHAIN_PASSWORD',
    'APPLE_TEAM_ID',
    'CSC_LINK',
    'CSC_KEY_PASSWORD',
    'WIN_CSC_KEY_PASSWORD',
    'WIN_EV_TOKEN_PATH',
    'SIGNTOOL_PATH',
  ],
  stores: [
    'CHROME_CLIENT_ID',
    'CHROME_CLIENT_SECRET',
    'CHROME_REFRESH_TOKEN',
    'EDGE_API_KEY',
    'EDGE_CLIENT_ID',
    'FIREFOX_API_KEY',
    'FIREFOX_API_SECRET',
    'SNAPCRAFT_STORE_CREDENTIALS',
  ],
};

/**
 * Resolve the key list for this run: --only wins, otherwise core plus any
 * --include groups.
 *
 * @param {object} args - Parsed CLI args ({ only, include }).
 * @returns {string[]} Key names to copy.
 */
function selectKeys(args) {
  if (args.only) {
    return args.only.split(',').map((k) => k.trim()).filter(Boolean);
  }

  const keys = [...KEY_GROUPS.core];
  for (const group of (args.include || '').split(',').map((g) => g.trim()).filter(Boolean)) {
    if (!KEY_GROUPS[group]) {
      throw new Error(`Unknown group '${group}' — available: ${Object.keys(KEY_GROUPS).join(', ')}`);
    }
    keys.push(...KEY_GROUPS[group]);
  }
  return keys;
}

/**
 * Compute the copy plan and the new destination content.
 *
 * @param {string} sourceContent - Source .env content.
 * @param {string} destContent - Destination .env content ('' when absent).
 * @param {string[]} keys - Keys to copy.
 * @param {object} options - { force }.
 * @returns {{ content: string, actions: Array<{ key: string, action: 'copied'|'replaced'|'kept'|'missing' }>, changed: boolean }}
 */
function planCopy(sourceContent, destContent, keys, options = {}) {
  const source = dotenv.parse(sourceContent);
  const dest = dotenv.parse(destContent);
  const actions = [];
  const copied = {};

  // An empty value never claims a key, the rule composeTargetEnv applies
  for (const key of keys) {
    if (!source[key]) {
      actions.push({ key, action: 'missing' });
      continue;
    }
    if (dest[key] && !options.force) {
      actions.push({ key, action: 'kept' });
      continue;
    }
    copied[key] = source[key];
    actions.push({ key, action: dest[key] ? 'replaced' : 'copied' });
  }

  if (Object.keys(copied).length === 0) {
    return { content: destContent, actions, changed: false };
  }

  const lineFor = Object.fromEntries(Object.entries(copied).map(([key, value]) => [key, envLine(key, value)]));
  const content = setEnvLines(destContent, lineFor);
  assertEnvReadsBack(content, copied);

  return { content, actions, changed: content !== destContent };
}

/**
 * Parse process argv into { brand, source, include, only, force, dryRun }.
 *
 * @param {string[]} argv - process.argv.slice(2).
 * @returns {object} Parsed args.
 */
function parseArgs(argv) {
  const args = { brand: DEFAULT_BRAND, source: DEFAULT_SOURCE };
  for (const arg of argv) {
    if (arg === '--force') args.force = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--brand=')) args.brand = arg.slice('--brand='.length);
    else if (arg.startsWith('--source=')) args.source = arg.slice('--source='.length);
    else if (arg.startsWith('--include=')) args.include = arg.slice('--include='.length);
    else if (arg.startsWith('--only=')) args.only = arg.slice('--only='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

const ACTION_LABELS = {
  copied: '✓ copied',
  replaced: '↻ replaced',
  kept: '• kept (already set — use --force to replace)',
  missing: '– not in source',
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  const destPath = path.resolve(REPO_ROOT, args.brand, '.env');

  if (!fs.existsSync(args.source)) {
    console.error(`Source .env not found: ${args.source}`);
    process.exit(1);
  }

  const sourceContent = fs.readFileSync(args.source, 'utf8');
  const destContent = fs.existsSync(destPath) ? fs.readFileSync(destPath, 'utf8') : '';
  const keys = selectKeys(args);
  const plan = planCopy(sourceContent, destContent, keys, { force: args.force });

  console.log(`${args.dryRun ? '[dry-run] ' : ''}${args.source}\n  → ${destPath}\n`);
  for (const { key, action } of plan.actions) {
    console.log(`  ${ACTION_LABELS[action]}  ${key}`);
  }

  const counts = plan.actions.reduce((acc, a) => ((acc[a.action] = (acc[a.action] || 0) + 1), acc), {});
  console.log(`\n${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);

  if (args.dryRun || !plan.changed) {
    console.log(args.dryRun ? 'Dry run — nothing written.' : 'Nothing to write.');
    return;
  }

  fs.writeFileSync(destPath, plan.content, { mode: 0o600 });
  console.log(`Written. Values were never displayed — verify in your editor if needed.`);
}

module.exports = { KEY_GROUPS, selectKeys, planCopy, parseArgs };

if (require.main === module) {
  main();
}
