/**
 * verbs: the ONE verb table. Every verb any OMEGA CLI answers to, declared once
 * with where it runs (`scope`), who answers it (`owners`) and how a root runs it
 * (`fanout`, `order`, `dryRun`). The dispatcher, the brand-root fan-outs and the
 * target-script scaffolds (verb-scripts.js) read it; the field contract lives in
 * docs/devkit/index.md. Pure data: the dispatcher that requires it is vendored
 * into every framework dist.
 */

const MANAGER = '@omega.js/manager';
const WEB = '@omega.js/web';
const BACKEND = '@omega.js/backend';
const DESKTOP = '@omega.js/desktop';
const EXTENSION = '@omega.js/extension';
const ALL = [MANAGER, WEB, BACKEND, DESKTOP, EXTENSION];

// The order every 'each' verb walks: backend's API goes live before the
// surfaces that call it. A target type with no rank runs after every ranked one.
const TARGET_ORDER = Object.freeze(['backend', 'web', 'extension', 'desktop', 'mobile']);

const SCOPES = Object.freeze(['root', 'contextless', 'box']);
const FANOUTS = Object.freeze(['each', 'root', 'none']);

const VERBS = Object.freeze([
  // ─── contextless: run with no target at all ───────────────────────────────
  { name: 'onboard', aliases: ['-o', '--onboard', 'create', 'new'], scope: 'contextless', owners: [MANAGER],
    fanout: 'root', order: null, dryRun: false },
  { name: 'help', aliases: ['h', '-h', '--help'], scope: 'contextless', owners: ALL,
    fanout: 'root', order: null, dryRun: false },
  { name: 'version', aliases: ['v', '-v', '--version'], scope: 'contextless', owners: ALL,
    fanout: 'root', order: null, dryRun: false },
  // none: prints ONE target's resolved root
  { name: 'cwd', aliases: [], scope: 'contextless', owners: [BACKEND],
    fanout: 'none', order: null, dryRun: false },
  // none: reads one target's logs; interleaved streams would be unreadable
  { name: 'logs', aliases: ['log', '--logs', 'logs:read', 'logs:tail', 'logs:stream'], scope: 'contextless', owners: [DESKTOP, BACKEND],
    fanout: 'none', order: null, dryRun: false },

  // ─── box: the signing box is a machine, not a project ─────────────────────
  // none: the runner is the box's own service, configured from the runner home
  { name: 'runner', aliases: ['--runner'], scope: 'box', owners: [DESKTOP],
    fanout: 'none', order: null, dryRun: false },
  // none: signs one artifact on the box, from any directory
  { name: 'sign-windows', aliases: ['--sign-windows'], scope: 'box', owners: [DESKTOP],
    fanout: 'none', order: null, dryRun: false },

  // ─── brand-root fan-outs ──────────────────────────────────────────────────
  { name: 'deploy', aliases: ['-d', '--deploy'], scope: 'root', owners: ALL,
    fanout: 'each', order: TARGET_ORDER, dryRun: false },
  { name: 'build', aliases: ['-b', '--build'], scope: 'root', owners: ALL,
    fanout: 'each', order: TARGET_ORDER, dryRun: true },
  { name: 'clean', aliases: ['-c', '--clean', 'clean:npm'], scope: 'root', owners: ALL,
    fanout: 'each', order: TARGET_ORDER, dryRun: true },
  { name: 'update', aliases: ['-u', '--update'], scope: 'root', owners: ALL,
    fanout: 'each', order: TARGET_ORDER, dryRun: false },
  { name: 'test', aliases: ['-t', '--test'], scope: 'root', owners: ALL,
    fanout: 'each', order: TARGET_ORDER, dryRun: false },

  // ─── the manager's own, run once at the brand root ────────────────────────
  // root: the link flip walks every target from the brand root, so it runs once, never per target
  { name: 'install', aliases: ['-i', 'i', '--install'], scope: 'root', owners: [MANAGER],
    fanout: 'root', order: null, dryRun: false },
  // root: the brand root boots every target's dev at once; a target runs its own framework's in place
  { name: 'dev', aliases: ['--dev', 'serve', 'start'], scope: 'root', owners: ALL,
    fanout: 'root', order: null, dryRun: false },
  { name: 'manage', aliases: [], scope: 'root', owners: [MANAGER],
    fanout: 'root', order: null, dryRun: false },
  { name: 'bump', aliases: ['--bump'], scope: 'root', owners: [MANAGER],
    fanout: 'root', order: null, dryRun: false },
  { name: 'company', aliases: [], scope: 'root', owners: [MANAGER],
    fanout: 'root', order: null, dryRun: false },
  { name: 'devlog', aliases: [], scope: 'root', owners: [MANAGER],
    fanout: 'root', order: null, dryRun: false },
  { name: 'pipeline', aliases: [], scope: 'root', owners: [MANAGER],
    fanout: 'root', order: null, dryRun: false },
  // root: converts the brand config, then walks every target's migrate entry in-process
  { name: 'migrate', aliases: ['-m', '--migrate', 'migration'], scope: 'root', owners: [MANAGER],
    fanout: 'root', order: null, dryRun: false },

  // ─── @omega.js/web ────────────────────────────────────────────────────────
  // none: materializes ONE named page or file into one web target
  { name: 'customize', aliases: ['-cz', '--customize'], scope: 'root', owners: [WEB],
    fanout: 'none', order: null, dryRun: false },
  { name: 'translate', aliases: ['--translate', 'translation'], scope: 'root', owners: [WEB],
    fanout: 'each', order: TARGET_ORDER, dryRun: false },
  { name: 'audit', aliases: ['-a', '--audit'], scope: 'root', owners: [WEB],
    fanout: 'each', order: TARGET_ORDER, dryRun: false },
  { name: 'purge', aliases: ['-cf', '--purge', 'cloudflare-purge'], scope: 'root', owners: [WEB],
    fanout: 'each', order: TARGET_ORDER, dryRun: false },

  // ─── @omega.js/desktop ────────────────────────────────────────────────────
  { name: 'package', aliases: [], scope: 'root', owners: [DESKTOP],
    fanout: 'each', order: TARGET_ORDER, dryRun: false },
  { name: 'validate-certs', aliases: ['certs', '--validate-certs'], scope: 'root', owners: [DESKTOP],
    fanout: 'each', order: TARGET_ORDER, dryRun: false },
  // none: a CI leg's step on the tree that leg just built, one runner at a time
  { name: 'publish', aliases: ['-p', '--publish'], scope: 'root', owners: [DESKTOP],
    fanout: 'none', order: null, dryRun: false },
  // none: cuts one signed release of one app
  { name: 'release', aliases: ['-r', '--release'], scope: 'root', owners: [DESKTOP],
    fanout: 'none', order: null, dryRun: false },
  // none: closes the one release the CI run just built
  { name: 'finalize-release', aliases: ['finalize', '--finalize-release'], scope: 'root', owners: [DESKTOP],
    fanout: 'none', order: null, dryRun: false },
  // none: opens one built app on this machine
  { name: 'launch', aliases: ['open', '--launch'], scope: 'root', owners: [DESKTOP],
    fanout: 'none', order: null, dryRun: false },
  // none: drives one running app over its debugging port
  { name: 'cdp', aliases: [], scope: 'root', owners: [DESKTOP],
    fanout: 'none', order: null, dryRun: false },

  // ─── @omega.js/backend ────────────────────────────────────────────────────
  // none: clears the terminal; there is nothing per target to repeat
  { name: 'clear', aliases: [], scope: 'root', owners: [BACKEND],
    fanout: 'none', order: null, dryRun: false },
  // none: a long-running emulator suite for one backend; the multi-target boot is `dev`
  { name: 'serve', aliases: [], scope: 'root', owners: [BACKEND],
    fanout: 'none', order: null, dryRun: false },
  { name: 'indexes', aliases: ['indexes:get', 'firestore:indexes', 'firestore:indexes:get'], scope: 'root', owners: [BACKEND],
    fanout: 'each', order: TARGET_ORDER, dryRun: false },
  // none: a long-running emulator keep-alive for one backend
  { name: 'emulator', aliases: ['emulators'], scope: 'root', owners: [BACKEND],
    fanout: 'none', order: null, dryRun: false },
  // none: a long-running source watcher for one backend
  { name: 'watch', aliases: [], scope: 'root', owners: [BACKEND],
    fanout: 'none', order: null, dryRun: false },
  // none: a long-running webhook forwarder into one local backend
  { name: 'stripe', aliases: ['stripe:listen'], scope: 'root', owners: [BACKEND],
    fanout: 'none', order: null, dryRun: false },
  // none: reads or writes named documents in one project
  { name: 'firestore:get', aliases: ['firestore:set', 'firestore:query', 'firestore:delete'], scope: 'root', owners: [BACKEND],
    fanout: 'none', order: null, dryRun: false },
  // none: reads or writes named users in one project
  { name: 'auth:get', aliases: ['auth:list', 'auth:delete', 'auth:set-claims', 'auth:token'], scope: 'root', owners: [BACKEND],
    fanout: 'none', order: null, dryRun: false },
  // none: one stdio MCP server for one backend
  { name: 'mcp', aliases: [], scope: 'root', owners: [BACKEND],
    fanout: 'none', order: null, dryRun: false },
  // none: a one-time conversion that changes what the live project enforces, run alone
  { name: 'migrate:rules', aliases: ['migrate:firestore-rules'], scope: 'root', owners: [BACKEND],
    fanout: 'none', order: null, dryRun: false },
  // none: a one-time conversion of one older tree, run alone
  { name: 'migrate:markers', aliases: [], scope: 'root', owners: [BACKEND],
    fanout: 'none', order: null, dryRun: false },
]);

/**
 * Every token that selects a verb: its name, then its aliases.
 *
 * @param {object} entry - A VERBS entry.
 * @returns {string[]}
 */
function tokensOf(entry) {
  return [entry.name, ...entry.aliases];
}

/**
 * The verb a token selects, or null. A name wins over an alias: `serve` is a
 * `dev` alias AND the backend's own verb, and the row that NAMES it answers.
 *
 * @param {string} token - The token as typed.
 * @returns {object|null} The VERBS entry.
 */
function findVerb(token) {
  return VERBS.find((entry) => entry.name === token)
    || VERBS.find((entry) => entry.aliases.includes(token))
    || null;
}

module.exports = { VERBS, TARGET_ORDER, SCOPES, FANOUTS, tokensOf, findVerb };
