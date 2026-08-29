/**
 * Compose the .env files that must PHYSICALLY exist per target — everything
 * else resolves through the runtime cascade (D15).
 *
 * Brand-wide values (GH_TOKEN, store/signing credentials, API keys) live
 * ONCE in the brand .env and reach every target at runtime/build through
 * @omega.js/config's env cascade (shell > target .env > brand .env > company
 * .env), so disperse no longer copies them around. What still gets written:
 *
 *   backend  — the FULL curated composition into the target-root .env (the ONE
 *              authored home since the src/dist pillar; `omega build` stages
 *              a copy into dist/.env so the Firebase deploy artifact —
 *              which can't walk up to a brand layer — stays self-contained).
 *              Composed from brand-level process.env (manage.js already
 *              layered shell > brand > company); empty values are never
 *              written, leaving template placeholders.
 *   stream   — each target's own GA4 Measurement Protocol secret, from the
 *              brand .env's per-target GOOGLE_ANALYTICS_SECRET_{TARGET}
 *              (the analytics service writes it there; #434). The target-level
 *              name is target-less because a target only ever has one stream.
 *   certPath — desktop signing file paths (CSC_LINK, APPLE_API_KEY),
 *              target-relative and stamped ONLY when the certs operation
 *              actually placed the file (a path to nothing would break
 *              electron-builder louder than no path at all).
 *   custom   — a custom target (#603) is not an OMEGA package, so it has no
 *              @omega.js/config to walk the brand cascade with. It gets the
 *              brand's SHARED .env composed into its own: the keys the brand
 *              .env declares, valued from the loaded environment (shell wins,
 *              exactly like the cascade) with the file as the fallback.
 *
 * Write semantics honor the frameworks' .env merge convention: keys already
 * in the file are updated in place wherever they live; new keys land in the
 * "Default Values" section (npx omega push-secrets only pushes that section);
 * everything else — comments, blanks, the Custom section — is preserved
 * verbatim. Composing a file also means CLEARING it (#636): a composed key the
 * brand root no longer sets is dropped from the target, so a credential the
 * brand retired stops being served from a file disperse wrote it into.
 * A missing .env is created with the two section markers. Values normalize to
 * double-quoted form with newlines escaped as \n (dotenv expands them back),
 * so multi-line blobs stay line-safe.
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;
const { parse: parseEnv } = require('dotenv');

const { envKeysForTarget } = require('@omega.js/config');

const { streamSecretEnvName } = require('../../../lib/analytics-secret.js');

const CUSTOM_MARKER = '# ========== Custom Values ==========';
const DEFAULT_MARKER = '# ========== Default Values ==========';

// The composition spec every CUSTOM target shares (#603) — no framework, no
// per-target keys, just the brand's shared .env.
const CUSTOM_TARGET_ENV = { file: '.env', composeBrandEnv: true };

// Per-target composition spec. `file` is target-relative — the target-root .env
// for EVERY target now (the backend's staged-tree exception died with the
// src/dist pillar: the stage step copies the target .env into dist/).
// `composeEnv` passes the target's env-schema keys through from brand-level
// process.env (backend ONLY — its .env ships with the deploy artifact; every
// other target reads brand values through the runtime cascade); WHICH keys is
// the env schema's to say (@omega.js/config, #581: every entry whose `targets`
// name this target), so a new key is one schema entry, never an edit here.
// `streamSecret` names the var that receives the target's own analytics stream
// secret; `certPaths` are stamped only when the file exists (see header). web
// has nothing to materialize. Deliberately NOT composed: per-listing store IDs
// (CHROME_EXTENSION_ID, FIREFOX_EXTENSION_ID, EDGE_PRODUCT_ID — user-managed
// per target) and the schema's runtime group (developer tooling credentials,
// config-derived values, the per-target stream secret above). Mobile gets
// certs only — no .env contract yet.
const ENV_MAP = {
  extension: {
    file: '.env',
    streamSecret: 'GOOGLE_ANALYTICS_SECRET',
  },
  backend: {
    file: '.env',
    composeEnv: true,
    streamSecret: 'GOOGLE_ANALYTICS_SECRET',
  },
  desktop: {
    file: '.env',
    certPaths: {
      CSC_LINK: 'config/certs/developer-id-application.p12',
      APPLE_API_KEY: 'config/certs/AuthKey_{env.APPLE_API_KEY_ID}.p8',
    },
    streamSecret: 'GOOGLE_ANALYTICS_SECRET',
  },
};

/** Serialize a value as a single double-quoted .env line. */
function envLine(key, value) {
  const escaped = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
  return `${key}="${escaped}"`;
}

/** Count unescaped double quotes — parity tracks open/closed quoting. */
function quoteParity(text) {
  const matches = text.match(/(?<!\\)"/g);
  return (matches ? matches.length : 0) % 2;
}

/**
 * Split .env content into entries: `{ lines, key? }`. A KEY=value line owns
 * its continuation lines when its double quote is left open (multi-line
 * values), so replacing a key can never orphan a value tail.
 */
function parseEntries(content) {
  const lines = content.split('\n');
  const entries = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);

    if (!match) {
      entries.push({ lines: [lines[i]] });
      continue;
    }

    const owned = [lines[i]];
    let open = quoteParity(match[2]);
    while (open && i + 1 < lines.length) {
      i++;
      owned.push(lines[i]);
      open = (open + quoteParity(lines[i])) % 2;
    }

    entries.push({ lines: owned, key: match[1] });
  }

  return entries;
}

/**
 * Apply `updates` to .env content: replace existing keys in place, append
 * missing ones into the Default Values section, and CLEAR every key named in
 * `removals` (#636). Returns the new content plus which keys were written
 * (changed), which were appended, and which were removed.
 */
function updateEnvContent(content, updates, removals) {
  const entries = parseEntries(content);
  const written = [];
  const removed = [];
  const seen = new Set();

  // Every occurrence is replaced — dotenv lets the LAST duplicate win, so
  // updating only the first would leave a stale duplicate in charge
  for (const entry of entries) {
    if (!entry.key || !(entry.key in updates)) continue;

    seen.add(entry.key);
    const line = envLine(entry.key, updates[entry.key]);
    if (entry.lines.length !== 1 || entry.lines[0] !== line) {
      entry.lines = [line];
      if (!written.includes(entry.key)) written.push(entry.key);
    }
  }

  // A `# KEY=` placeholder (the framework templates' convention for keys the
  // cascade usually serves) is the key's documented home — uncomment it in
  // place instead of appending a duplicate line below it.
  for (const key of Object.keys(updates)) {
    if (seen.has(key)) continue;
    const placeholderRe = new RegExp(`^#\\s*${key}=\\s*$`);
    const placeholder = entries.find((candidate) => candidate.lines.length === 1 && placeholderRe.test(candidate.lines[0].trim()));
    if (placeholder) {
      placeholder.lines = [envLine(key, updates[key])];
      placeholder.key = key;
      seen.add(key);
      written.push(key);
    }
  }

  const appended = Object.keys(updates).filter((key) => !seen.has(key));
  if (appended.length > 0) {
    const appendEntries = appended.map((key) => ({ lines: [envLine(key, updates[key])], key }));
    const markerIndex = entries.findIndex((entry) => entry.lines[0].trim() === CUSTOM_MARKER);

    if (markerIndex >= 0) {
      entries.splice(markerIndex, 0, ...appendEntries, { lines: [''] });
    } else {
      entries.push(...appendEntries);
    }
    written.push(...appended);
  }

  // A key the composition no longer has a value for stops being served: every
  // occurrence goes (the same dotenv duplicate rule as above). Only a line
  // CARRYING a value is touched — a `# KEY=` placeholder or an empty `KEY=""`
  // is the key's documented home, which is what a fresh template hands over.
  const clearing = new Set((removals || []).filter((key) => !(key in updates)));
  const kept = entries.filter((entry) => {
    if (!entry.key || !clearing.has(entry.key) || !parseEnv(entry.lines.join('\n'))[entry.key]) {
      return true;
    }
    if (!removed.includes(entry.key)) removed.push(entry.key);
    return false;
  });

  return {
    content: kept.map((entry) => entry.lines.join('\n')).join('\n'),
    written,
    appended,
    removed,
  };
}

/**
 * The brand .env's own key→value map (#603) — what a custom target composes
 * from. A brand with no .env composes nothing.
 *
 * @param {string} brandRoot - Brand-monorepo root.
 * @returns {Object<string, string>} Parsed key → value.
 */
function brandEnvValues(brandRoot) {
  const envPath = join(brandRoot, '.env');
  return jetpack.exists(envPath) ? parseEnv(jetpack.read(envPath) || '') : {};
}

/** Fresh .env for a target the framework's `mgr setup` hasn't templated yet. */
function freshEnvContent(updates) {
  return [
    DEFAULT_MARKER,
    '# Composed by the disperse service — `npx omega setup` expands this to the full template.',
    '',
    ...Object.entries(updates).map(([key, value]) => envLine(key, value)),
    '',
    CUSTOM_MARKER,
    '# Anything below this line is yours.',
    '',
  ].join('\n');
}

module.exports = async (context) => {
  const { mappedTargets, brandRoot, options = {} } = context;

  const envTargets = mappedTargets.filter((entry) => entry.custom || ENV_MAP[entry.target]);
  if (envTargets.length === 0) {
    console.log(`      ${chalk.dim('⊘ no targets with a composed .env')}`);
    return { output: { env: { reason: 'no targets with a composed .env' } } };
  }

  // Read the brand .env ONCE — the key list a custom target composes from
  const brandEnv = brandEnvValues(brandRoot);

  const files = {};
  let updated = 0;
  let currentCount = 0;

  for (const entry of envTargets) {
    const spec = entry.custom ? CUSTOM_TARGET_ENV : ENV_MAP[entry.target];
    const envRel = `${entry.dir}/${spec.file}`;
    const envPath = join(entry.path, spec.file);

    // ─── Resolve this target's values ─────────────────────────────────────
    const updates = {};

    for (const name of spec.composeEnv ? envKeysForTarget(entry.target) : []) {
      const value = process.env[name];
      if (value) updates[name] = value;
    }

    // Custom targets take the brand .env's OWN keys — the shell layer wins
    // (the cascade's order) and the file is the fallback, so a standalone
    // manage run and a booted one compose the same file
    for (const name of spec.composeBrandEnv ? Object.keys(brandEnv) : []) {
      const value = process.env[name] ?? brandEnv[name];
      if (value) updates[name] = value;
    }

    if (spec.streamSecret) {
      const secret = process.env[streamSecretEnvName(entry.target)];
      if (secret) updates[spec.streamSecret] = secret;
    }

    for (const [name, template] of Object.entries(spec.certPaths || {})) {
      const resolved = template.replace(/\{env\.([^}]+)\}/g, (match, key) => process.env[key] || '');
      if (!resolved.includes('{') && jetpack.exists(join(entry.path, resolved))) {
        updates[name] = resolved;
      }
    }

    // ─── Apply ────────────────────────────────────────────────────────────
    const existing = jetpack.exists(envPath) ? jetpack.read(envPath) : null;

    // Composed keys the brand root no longer sets (#636). Only an EXISTING
    // file can carry a stale value, and only the composed set is disperse's to
    // clear — a key it never writes is the target's own business.
    const clears = existing !== null && spec.composeEnv
      ? envKeysForTarget(entry.target).filter((name) => !process.env[name])
      : [];

    if (Object.keys(updates).length === 0 && clears.length === 0) {
      console.log(`      ${chalk.dim(`⊘ ${envRel} — no values to compose`)}`);
      currentCount++;
      continue;
    }

    const result = existing === null
      ? { content: freshEnvContent(updates), written: Object.keys(updates), appended: Object.keys(updates), removed: [] }
      : updateEnvContent(existing, updates, clears);

    if (result.written.length === 0 && result.removed.length === 0) {
      console.log(`      ${chalk.dim(`✓ ${envRel} (current)`)}`);
      currentCount++;
      continue;
    }

    // Key NAMES only, never values (the .env is all secrets)
    const summary = [
      result.written.length > 0 ? `${result.written.length} keys: ${result.written.join(', ')}` : null,
      result.removed.length > 0 ? `cleared: ${result.removed.join(', ')}` : null,
    ].filter(Boolean).join(' · ');

    if (options.dryRun) {
      console.log(`      ${chalk.cyan('[DRY RUN]')} Would write ${chalk.cyan(envRel)} ${chalk.dim(`(${summary})`)}`);
      files[envRel] = { planned: result.written, cleared: result.removed };
      continue;
    }

    jetpack.write(envPath, result.content);
    console.log(`      ${chalk.green('✓')} ${chalk.cyan(envRel)} ${chalk.dim(`(${summary})`)}`);
    files[envRel] = { written: result.written, cleared: result.removed };
    updated++;
  }

  return {
    output: { env: { updated, current: currentCount, files } },
  };
};

module.exports.ENV_MAP = ENV_MAP;
module.exports.updateEnvContent = updateEnvContent;
module.exports.envLine = envLine;
