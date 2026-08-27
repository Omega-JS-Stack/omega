/**
 * Preflight — the REQUIRES registry check run before any service. Collects
 * the enabled services' declared REQUIRED inputs (env var names + Google OAuth
 * scopes, src/config.js REQUIRES; an entry marked `gates: false` is optional
 * and belongs to the mid-run ask, not here), checks what IS knowable up front —
 * process.env presence (names only, values never printed) and the token
 * store's granted-scopes record — and prints ONE consolidated fix
 * walkthrough (cp236's 403-diagnostics tone: what's missing, which service,
 * why, the exact fix, then the rerun verb) instead of N mid-run skips.
 *
 * Verdicts per failing service (Ian's ruling — absorb, never crash):
 *   run   - interactive and the run itself collects the fix (the cp114
 *           setup-contract paste flow / the Google consent flow) — the
 *           service proceeds and asks.
 *   skip  - the fix needs the operator (non-interactive, or an env var no
 *           flow collects) — the service skips with the walkthrough printed
 *           and the cycle continues; the skip carries the machine-readable
 *           missingEnv list the run summary's 🔑 section aggregates.
 *   error - --strict: every preflight failure fails hard instead.
 *
 * The scope leg's boundary: the token store records what the last consent
 * GRANTED — that is what's knowable before a call. The live grant is only
 * proven at call time; the google-auth 403 diagnostics are the backstop.
 */
const fs = require('node:fs');
const chalk = require('chalk').default;

const { REQUIRES } = require('../config.js');
const { canPrompt } = require('./run-gates.js');
const { googleTokenStorePath } = require('./google-auth.js');

/** Shorten a Google scope URL to its trailing name for display. */
function shortScope(scope) {
  return scope.replace('https://www.googleapis.com/auth/', '');
}

/**
 * Read the ONE Google token store's granted-scopes record. Stores from
 * before scope tracking (no `scopes` array) count as granting nothing —
 * the same rule google-auth's getAccessToken applies.
 *
 * @param {string} brandRoot - Brand monorepo root
 * @returns {{ exists: boolean, scopes: string[], accountEmail: string|null, storePath: string }}
 */
function readTokenStore(brandRoot) {
  const storePath = googleTokenStorePath(brandRoot);

  try {
    const stored = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    return {
      exists: true,
      scopes: Array.isArray(stored.scopes) ? stored.scopes : [],
      accountEmail: stored.account_email || null,
      storePath,
    };
  } catch {
    return { exists: false, scopes: [], accountEmail: null, storePath };
  }
}

/**
 * Check one service's declaration against the environment + token store.
 *
 * @param {string} serviceName - Service being checked
 * @param {object} declaration - REQUIRES entry ({ why, when?, env, scopes })
 * @param {object} brandConfig - Merged brand config (gates the when clauses)
 * @param {object} tokenStore - readTokenStore() result
 * @returns {object|null} Finding ({ service, why, missingEnv, missingScopes,
 *   noConsent }) or null when the service's requirements are met (or don't
 *   apply to this brand)
 */
function checkService(serviceName, declaration, brandConfig, tokenStore) {
  if (declaration.when && !declaration.when(brandConfig)) {
    return null;
  }

  // `gates: false` entries are OPTIONAL inputs (#608): the service runs
  // without them, so their absence is not a preflight finding — the operation
  // that needs one asks for it in place, through the shared setup contract.
  const envEntries = (declaration.env || [])
    .filter((entry) => entry.gates !== false)
    .filter((entry) => !entry.when || entry.when(brandConfig));
  const missingEnv = envEntries.filter((entry) => !process.env[entry.name]);

  const requiredScopes = declaration.scopes || [];
  let missingScopes = [];
  let noConsent = false;

  if (requiredScopes.length > 0) {
    if (!tokenStore.exists) {
      noConsent = true;
    } else {
      missingScopes = requiredScopes.filter((scope) => !tokenStore.scopes.includes(scope));
    }
  }

  if (missingEnv.length === 0 && missingScopes.length === 0 && !noConsent) {
    return null;
  }

  return {
    service: serviceName,
    why: declaration.why || null,
    missingEnv,
    missingScopes,
    noConsent,
  };
}

/**
 * Build the machine-readable skip/error reason for a finding — always names
 * the exact vars/scopes (never values) so run records and the 🔑 aggregate
 * say precisely what to add where.
 */
function buildReason(finding) {
  const parts = [];

  if (finding.missingEnv.length > 0) {
    parts.push(`missing ${finding.missingEnv.map((entry) => entry.name).join(', ')} — add to the brand .env, or rerun interactively to paste`);
  }
  parts.push(...consentParts(finding));

  return `preflight: ${parts.join('; ')}`;
}

/** The consent/scope half of a finding's wording — ONE home for both users. */
function consentParts(finding) {
  const parts = [];

  if (finding.noConsent) {
    parts.push('Google consent not granted yet — rerun interactively once to consent');
  }
  if (finding.missingScopes.length > 0) {
    parts.push(`Google token missing scopes ${finding.missingScopes.map(shortScope).join(', ')} — rerun interactively for the one re-consent`);
  }

  return parts;
}

/**
 * The gate's human-pending summary (#228) — what the run summary's ⚑ section
 * prints for this skip, so the item is NAMED with a rerun hint instead of
 * counting as an anonymous "skipped". Consent/scope gaps only: a missing
 * secret already rides the 🔑 section, and double-listing is noise.
 *
 * @param {object} finding - A checkService finding.
 * @returns {string|null} The pending line, or null for env-only gaps.
 */
function buildPending(finding) {
  const parts = consentParts(finding);
  return parts.length > 0 ? parts.join('; ') : null;
}

/**
 * Print the consolidated walkthrough (cp236 tone) — one block per failing
 * service: what's missing, why the service needs it, the exact fix, then
 * the rerun verb. Env VALUES never appear — names, labels, and mint URLs only.
 */
function printWalkthrough(findings, gates, tokenStore, strict) {
  console.log('');
  console.log(`  ${chalk.yellow('⚑ Preflight')} — ${findings.length} service${findings.length === 1 ? ' is' : 's are'} missing requirements${strict ? chalk.red(' (--strict: failing hard)') : ''}:`);

  for (const finding of findings) {
    const gate = gates[finding.service];
    const missingBits = [
      ...finding.missingEnv.map((entry) => entry.name),
      ...(finding.noConsent ? ['Google consent'] : []),
      ...finding.missingScopes.map((scope) => `scope:${shortScope(scope)}`),
    ];

    console.log('');
    console.log(`  ${chalk.yellow('✗')} ${chalk.bold(finding.service)} — missing ${chalk.bold(missingBits.join(', '))}`);
    if (finding.why) {
      console.log(`      ${chalk.dim('needed:')} ${finding.why}`);
    }

    for (const entry of finding.missingEnv) {
      console.log(`      ${chalk.dim('fix:')}    add ${chalk.bold(`${entry.name}=<value>`)} to the brand .env${entry.label ? chalk.dim(` — ${entry.label}`) : ''}`);
      if (entry.url) {
        console.log(`              ${chalk.dim(`→ mint it at ${entry.url}`)}`);
      }
      if (entry.hint) {
        console.log(`              ${chalk.dim(entry.hint)}`);
      }
    }

    if (finding.noConsent) {
      console.log(`      ${chalk.dim('fix:')}    run interactively once — the Google consent flow opens, and every later run works from the cached grant`);
    } else if (finding.missingScopes.length > 0) {
      console.log(`      ${chalk.dim('acting identity:')} ${tokenStore.accountEmail || 'unknown'} ${chalk.dim(`(token store: ${tokenStore.storePath})`)}`);
      console.log(`      ${chalk.dim('fix:')}    rerun interactively — one re-consent upgrades the cached token with the new scopes`);
      console.log(`              ${chalk.dim('→ or delete the token store to consent as a different account')}`);
    }

    if (gate.action === 'run') {
      console.log(`      ${chalk.dim('→ this run is interactive — it will ask, then continue')}`);
    } else {
      console.log(`      ${chalk.dim('then:')}   npm run manage -- --service=${finding.service}   ${chalk.dim('(from the brand root)')}`);
    }
  }
}

/**
 * Run the preflight over the services about to run.
 *
 * @param {object} params
 * @param {string[]} params.services - Services this manage run will walk
 * @param {object} params.brandConfig - Merged brand config
 * @param {string} params.brandRoot - Brand monorepo root
 * @param {object} params.options - Run options ({ strict?, dryRun?, … })
 * @param {object} [deps] - Test seams: { requires } replaces the REQUIRES
 *   registry, { canPrompt } the interactivity gate
 * @returns {{ findings: object[], gates: Object<string, { action: 'run'|'skip'|'error', reason: string, missingEnv: string[], needsInteractive?: string }> }}
 *   gates only contains entries for services with findings — everything
 *   else runs untouched
 */
function runPreflight({ services, brandConfig, brandRoot, options = {} }, deps = {}) {
  const requires = deps.requires || REQUIRES;
  const interactive = (deps.canPrompt || canPrompt)(options);
  const strict = Boolean(options.strict);
  const tokenStore = readTokenStore(brandRoot);

  const findings = [];
  for (const serviceName of services) {
    const declaration = requires[serviceName];
    if (!declaration) {
      continue;
    }

    const finding = checkService(serviceName, declaration, brandConfig, tokenStore);
    if (finding) {
      findings.push(finding);
    }
  }

  const gates = {};
  for (const finding of findings) {
    // Scope gaps always self-heal on a TTY (the consent flow); env gaps only
    // when every missing entry rides the setup-contract paste flow
    const selfHealing = finding.missingEnv.every((entry) => entry.prompted === true);
    const action = strict ? 'error' : (interactive && selfHealing ? 'run' : 'skip');

    const pending = buildPending(finding);

    gates[finding.service] = {
      action,
      reason: buildReason(finding),
      missingEnv: finding.missingEnv.map((entry) => entry.name),
      ...(pending ? { needsInteractive: pending } : {}),
    };
  }

  if (findings.length > 0) {
    printWalkthrough(findings, gates, tokenStore, strict);
  }

  return { findings, gates };
}

module.exports = { runPreflight, checkService, readTokenStore };
