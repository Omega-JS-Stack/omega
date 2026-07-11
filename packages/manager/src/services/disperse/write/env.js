/**
 * Compose the .env files that must PHYSICALLY exist per app — everything
 * else resolves through the runtime cascade (D15).
 *
 * Brand-wide values (GH_TOKEN, store/signing credentials, API keys) live
 * ONCE in the brand .env and reach every app at runtime/build through
 * @omega.js/config's env cascade (shell > app .env > brand .env > company
 * .env), so disperse no longer copies them around. What still gets written:
 *
 *   backend  — the FULL curated composition into functions/.env: that file
 *              rides the Firebase deploy artifact and the cloud can't walk
 *              up to a brand layer. Composed from brand-level process.env
 *              (manage.js already layered shell > brand > company); empty
 *              values are never written, leaving template placeholders.
 *   stream   — each app's own GA4 Measurement Protocol secret from
 *              analytics state (streams.{target}.apiSecret) — per-app
 *              derived data that exists nowhere else.
 *   certPath — desktop signing file paths (CSC_LINK, APPLE_API_KEY),
 *              app-relative and stamped ONLY when the certs operation
 *              actually placed the file (a path to nothing would break
 *              electron-builder louder than no path at all).
 *
 * Write semantics honor the frameworks' .env merge convention: keys already
 * in the file are updated in place wherever they live; new keys land in the
 * "Default Values" section (npx omega push-secrets only pushes that section);
 * everything else — comments, blanks, the Custom section — is preserved
 * verbatim. A missing .env is created with the two section markers. Values
 * normalize to double-quoted form with newlines escaped as \n (dotenv
 * expands them back), so multi-line blobs stay line-safe.
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

const CUSTOM_MARKER = '# ========== Custom Values ==========';
const DEFAULT_MARKER = '# ========== Default Values ==========';

// Per-target composition spec. `file` is app-relative; `env` names pass
// through from brand-level process.env (backend ONLY — its .env ships with
// the deploy artifact; every other target reads brand values through the
// runtime cascade); `streamSecret` names the var that receives the app's
// own analytics stream secret; `certPaths` are stamped only when the file
// exists (see header). web has nothing to materialize. Deliberately NOT
// composed: per-listing store IDs (CHROME_EXTENSION_ID,
// FIREFOX_EXTENSION_ID, EDGE_PRODUCT_ID — user-managed per app) and
// developer tooling credentials (CLAUDE_CODE_OAUTH_TOKEN). Mobile gets
// certs only — no .env contract yet.
const ENV_MAP = {
  extension: {
    file: '.env',
    streamSecret: 'GOOGLE_ANALYTICS_SECRET',
  },
  backend: {
    file: 'functions/.env',
    env: [
      'GH_TOKEN',
      'OMEGA_ADMIN_KEY', 'OMEGA_WEBHOOK_KEY', 'OMEGA_NAMESPACE',
      'OMEGA_OPENAI_API_KEY', 'OMEGA_ANTHROPIC_API_KEY',
      'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
      'STRIPE_SECRET_KEY', 'PAYPAL_CLIENT_SECRET', 'CHARGEBEE_API_KEY', 'COINBASE_API_KEY',
      'META_ACCESS_TOKEN', 'TIKTOK_ACCESS_TOKEN',
      'CLOUDFLARE_TOKEN', 'RECAPTCHA_SECRET_KEY',
      'SENDGRID_API_KEY', 'BEEHIIV_API_KEY', 'NEVERBOUNCE_API_KEY', 'ZEROBOUNCE_API_KEY',
      'UNSUBSCRIBE_HMAC_KEY', 'APOLLO_API_KEY',
    ],
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
 * missing ones into the Default Values section. Returns the new content
 * plus which keys were written (changed) and which were appended.
 */
function updateEnvContent(content, updates) {
  const entries = parseEntries(content);
  const written = [];
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

  return {
    content: entries.map((entry) => entry.lines.join('\n')).join('\n'),
    written,
    appended,
  };
}

/** Fresh .env for an app the framework's `mgr setup` hasn't templated yet. */
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
  const { targetApps, brandState, options = {} } = context;

  const envApps = targetApps.filter((app) => ENV_MAP[app.target]);
  if (envApps.length === 0) {
    console.log(`      ${chalk.dim('⊘ no apps with a composed .env')}`);
    return { output: { env: { reason: 'no apps with a composed .env' } } };
  }

  const files = {};
  let updated = 0;
  let currentCount = 0;

  for (const app of envApps) {
    const spec = ENV_MAP[app.target];
    const envRel = `${app.dir}/${spec.file}`;
    const envPath = join(app.path, spec.file);

    // ─── Resolve this app's values ────────────────────────────────────────
    const updates = {};

    for (const name of spec.env || []) {
      const value = process.env[name];
      if (value) updates[name] = value;
    }

    if (spec.streamSecret) {
      const secret = brandState?.analytics?.streams?.[app.target]?.apiSecret;
      if (secret) updates[spec.streamSecret] = secret;
    }

    for (const [name, template] of Object.entries(spec.certPaths || {})) {
      const resolved = template.replace(/\{env\.([^}]+)\}/g, (match, key) => process.env[key] || '');
      if (!resolved.includes('{') && jetpack.exists(join(app.path, resolved))) {
        updates[name] = resolved;
      }
    }

    if (Object.keys(updates).length === 0) {
      console.log(`      ${chalk.dim(`⊘ ${envRel} — no values to compose`)}`);
      currentCount++;
      continue;
    }

    // ─── Apply ────────────────────────────────────────────────────────────
    const existing = jetpack.exists(envPath) ? jetpack.read(envPath) : null;
    const result = existing === null
      ? { content: freshEnvContent(updates), written: Object.keys(updates), appended: Object.keys(updates) }
      : updateEnvContent(existing, updates);

    if (result.written.length === 0) {
      console.log(`      ${chalk.dim(`✓ ${envRel} (current)`)}`);
      currentCount++;
      continue;
    }

    if (options.dryRun) {
      console.log(`      ${chalk.cyan('[DRY RUN]')} Would write ${chalk.cyan(envRel)} ${chalk.dim(`(${result.written.join(', ')})`)}`);
      files[envRel] = { planned: result.written };
      continue;
    }

    jetpack.write(envPath, result.content);
    console.log(`      ${chalk.green('✓')} ${chalk.cyan(envRel)} ${chalk.dim(`(${result.written.length} keys: ${result.written.join(', ')})`)}`);
    files[envRel] = { written: result.written };
    updated++;
  }

  return {
    output: { env: { updated, current: currentCount, files } },
  };
};

module.exports.ENV_MAP = ENV_MAP;
module.exports.updateEnvContent = updateEnvContent;
