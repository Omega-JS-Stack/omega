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
 *
 * The file's OTHER gate is assertFamilyVersions (#794), the lockstep check:
 * same place in the run (before any service, from `runManage` and `omega dev`
 * alike) and the opposite verdict — a mixed @omega.js family is REFUSED, not
 * absorbed, because every service below it would reconcile on top of two
 * copies of the runtime.
 */
const fs = require('node:fs');
const path = require('node:path');
const chalk = require('chalk').default;

const { REQUIRES, TARGET_FRAMEWORKS } = require('../config.js');
const { canPrompt } = require('./run-gates.js');
const { googleTokenStorePath } = require('./google-auth.js');

// The family's ONE version (#794) — the manager's own, read at run time. A
// published brand installs the manager and its frameworks from the same
// release, so the manager's number IS what every target must carry.
const FAMILY_VERSION = require('../../package.json').version;

// The client rides inside every framework (web/backend/desktop/extension all
// depend on it), so a drifted client is the second way one brand ends up
// running two copies of the runtime — checked per target beside the framework.
const CLIENT_PACKAGE = '@omega.js/client';

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

// ─── The lockstep boot check (#794) ─────────────────────────────────────────

/**
 * The nearest installed copy of a package, climbing from a target dir toward
 * the brand root — npm hoists a workspace tree's deps to the root, so the
 * target's own node_modules is the first place to look and never the only
 * one (the same "nearest, climbing" resolution `omega update` reports from).
 *
 * @param {string} fromDir - Where to start looking (a target dir).
 * @param {string} brandRoot - Where to stop climbing.
 * @param {string} packageName - Full package name (`@omega.js/web`).
 * @returns {string|null} The installed package dir, or null when nothing is installed.
 */
function findInstalled(fromDir, brandRoot, packageName) {
  let current = path.resolve(fromDir);
  const stop = path.resolve(brandRoot);

  for (;;) {
    const candidate = path.join(current, 'node_modules', packageName);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;

    const parent = path.dirname(current);
    if (current === stop || parent === current) return null;
    current = parent;
  }
}

/**
 * Is this install a LINK out of node_modules — the local era's `file:` spec,
 * or an npm workspace link? Its version is the monorepo's by construction, so
 * comparing it to a published number says nothing.
 */
function isLinkedInstall(installedDir) {
  try {
    return fs.lstatSync(installedDir).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * The installed version, or the PROBLEM that stopped us reading it. A manifest
 * that exists but cannot be parsed (or carries no version) is never a pass:
 * the whole point of the gate is knowing what is installed, and "unknown"
 * answers that question with silence.
 *
 * @param {string} installedDir - An installed package dir.
 * @returns {{ version: string|null, problem: string|null }}
 */
function readInstalledVersion(installedDir) {
  const manifest = path.join(installedDir, 'package.json');
  let raw;

  try {
    raw = fs.readFileSync(manifest, 'utf8');
  } catch {
    return { version: null, problem: 'cannot be read' };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { version: null, problem: 'is not valid JSON' };
  }

  if (typeof parsed.version !== 'string' || parsed.version === '') {
    return { version: null, problem: 'declares no version' };
  }

  return { version: parsed.version, problem: null };
}

/** An Error the CLI prints as its message alone — a refusal is not a bug (#706). */
function refusal(message) {
  const error = new Error(message);
  error.refusal = true;
  return error;
}

/** The framework spec a target's own manifest declares, or null. */
function declaredSpec(targetPath, packageName) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8'));
    return pkg.dependencies?.[packageName] || pkg.devDependencies?.[packageName] || null;
  } catch {
    return null;
  }
}

/**
 * The lockstep gate (#794) — the @omega.js family ships ONE version, so every
 * target's installed framework (and the `@omega.js/client` under it) must be
 * the manager's own version. Run before any service, by `runManage` and by
 * `omega dev` alike: a brand running a backend from one release beside a
 * client from another validates its config with two validators and serves two
 * copies of the runtime, and nothing downstream can tell.
 *
 * What is NOT a mismatch: a target linked with a `file:` spec (the local era —
 * its version is the monorepo's by construction), and a target with nothing
 * installed yet (the install itself is the fix, so it skips with a line).
 *
 * @param {object} params
 * @param {string} params.brandRoot - Brand monorepo root.
 * @param {Array<{ name, dir, path, target }>} params.targets - Discovered target entries.
 * @param {string} [params.version] - The family version (defaults to the manager's own).
 * @returns {{ checked: object[], mismatched: object[], exempt: object[], skipped: object[], unreadable: object[] }}
 * @throws {Error} ONE refusal (`error.refusal`, so the CLI prints the message
 *   alone) naming every mismatched target and the fix — or, first, every
 *   installed manifest that cannot be read.
 */
function assertFamilyVersions({ brandRoot, targets = [], version = FAMILY_VERSION }) {
  const checked = [];
  const mismatched = [];
  const exempt = [];
  const skipped = [];
  const unreadable = [];

  for (const entry of targets) {
    const framework = TARGET_FRAMEWORKS[entry.target];
    // A custom target (#603) maps to no framework — there is nothing to compare
    if (!framework) continue;

    const spec = declaredSpec(entry.path, framework);
    if (spec && /^(file|link):/.test(spec)) {
      exempt.push({ dir: entry.name, framework, reason: spec });
      continue;
    }

    const installedDir = findInstalled(entry.path, brandRoot, framework);
    if (!installedDir) {
      skipped.push({ dir: entry.name, framework });
      continue;
    }
    if (isLinkedInstall(installedDir)) {
      exempt.push({ dir: entry.name, framework, reason: 'linked install' });
      continue;
    }

    // The client is checked wherever npm placed it: nested under the
    // framework when the ranges stopped overlapping (the second-copy case
    // this check exists for), otherwise the hoisted copy the climb finds.
    const nestedClient = path.join(installedDir, 'node_modules', CLIENT_PACKAGE);
    const clientDir = fs.existsSync(path.join(nestedClient, 'package.json'))
      ? nestedClient
      : findInstalled(entry.path, brandRoot, CLIENT_PACKAGE);

    const reads = [{ name: framework, dir: installedDir, ...readInstalledVersion(installedDir) }];
    if (clientDir && !isLinkedInstall(clientDir)) {
      reads.push({ name: CLIENT_PACKAGE, dir: clientDir, ...readInstalledVersion(clientDir) });
    }

    const broken = reads.filter((read) => read.problem);
    if (broken.length > 0) {
      unreadable.push(...broken.map((read) => ({ dir: entry.name, name: read.name, manifest: path.join(read.dir, 'package.json'), problem: read.problem })));
      continue;
    }

    const packages = reads.map((read) => ({ name: read.name, version: read.version }));
    checked.push({ dir: entry.name, packages });

    const drifted = packages.filter((pkg) => pkg.version !== version);
    if (drifted.length > 0) {
      mismatched.push({ dir: entry.name, packages: drifted });
    }
  }

  for (const entry of skipped) {
    console.log(`  ${chalk.dim(`⊘ ${entry.dir}: ${entry.framework} is not installed yet — skipped (npm install, or \`omega update --apply\`, is the fix)`)}`);
  }

  // An install we cannot READ is checked first: it answers "which version is
  // this" with silence, and a gate that shrugs at silence is not a gate.
  if (unreadable.length > 0) {
    const lines = unreadable.map((entry) => `  ${entry.dir}: ${entry.manifest} ${entry.problem}`);
    throw refusal(
      `an installed @omega.js package cannot be read (#794):\n${lines.join('\n')}\n`
      + '  fix: reinstall the brand — `npm install` at the brand root',
    );
  }

  if (mismatched.length > 0) {
    const lines = mismatched.map((entry) => `  ${entry.dir}: ${entry.packages.map((pkg) => `${pkg.name} ${pkg.version}`).join(', ')}`);
    throw refusal(
      `the @omega.js family ships ONE version — this brand is mixed (#794):\n${lines.join('\n')}\n`
      + `  this manager is ${version}\n`
      + '  fix: run `omega update --apply` at the brand root — it moves every target together',
    );
  }

  return { checked, mismatched, exempt, skipped, unreadable };
}

module.exports = { runPreflight, checkService, readTokenStore, assertFamilyVersions };
