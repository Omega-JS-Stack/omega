/**
 * deploy-precheck — the NETWORK half `omega setup` used to own
 * ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)).
 *
 * Setup's local half now rides every verb (ensure-target.js); what needs the
 * network rides the ONE verb that needs the remote side right —
 * `omega deploy` — as a precheck before the dispatch:
 *
 *   framework freshness  the npm registry's latest vs the installed version
 *   validate-certs       the signing prereqs, soft (a warning, never fatal)
 *   provision-repos      the release/download repos config names (idempotent)
 *   push-secrets         the composed target env → GitHub Actions repo secrets
 *
 * Every step is soft: a precheck reports, the deploy proceeds. `--no-secrets`
 * skips the whole precheck — the same opt-out name on web, desktop and
 * extension (parity; desktop's old `--quick` is gone).
 *
 * The RUNNER is `@omega.js/devkit/deploy-precheck` (one copy for every
 * framework); this file is desktop's STEPS.
 */
const Manager = new (require('../../build.js'));
const { runDeployPrecheck } = require('@omega.js/devkit/deploy-precheck');
const { updateManager } = require('./dependencies.js');

const package = Manager.getPackage('main');

/**
 * Auto-provision the public release/download repos referenced in
 * config.releases / config.downloads. Idempotent: only creates if missing.
 */
async function provisionReleaseRepos({ projectDir, log, warn }) {
  const { discoverRepo, getOctokit, ensureRepo } = require('../../utils/github.js');
  const octokit = getOctokit();
  if (!octokit) return;

  const config = Manager.getConfig() || {};
  let appOwner;
  try {
    const discovered = await discoverRepo(projectDir);
    appOwner = discovered.owner;
  } catch (e) {
    warn(`provision-repos: could not discover app owner (${e.message}). Set package.json repository.url.`);
    return;
  }

  const targets = [];
  if (config.releases?.enabled !== false) {
    targets.push({
      name:        'releases (auto-update feed)',
      owner:       config.releases?.owner || appOwner,
      repo:        config.releases?.repo || 'update-server',
      description: `Public release artifacts + auto-update feed for ${appOwner}'s @omega.js/desktop apps. Managed by @omega.js/desktop.`,
    });
  }
  if (config.downloads?.enabled !== false) {
    targets.push({
      name:        'downloads (fixed-name mirror)',
      owner:       config.downloads?.owner || appOwner,
      repo:        config.downloads?.repo || 'download-server',
      description: `Fixed-name download mirror for ${appOwner}'s @omega.js/desktop apps. Managed by @omega.js/desktop.`,
    });
  }

  for (const t of targets) {
    try {
      const result = await ensureRepo(octokit, t.owner, t.repo, { description: t.description, private: false });
      log(`provision-repos: ✓ ${result.created ? 'created ' : ''}${t.owner}/${t.repo}${result.created ? '' : ' already exists'} — ${t.name}`);
    } catch (e) {
      warn(`provision-repos: ✗ ${t.owner}/${t.repo} (${t.name}) — ${e.message}`);
    }
  }
}

/**
 * The default steps, in order. Named so a test can hand its own recorder in
 * and read back exactly which ones ran.
 */
const STEPS = [
  {
    name: 'framework-freshness',
    run: ({ projectDir, log, warn }) => updateManager({ projectDir, package, log, error: warn }),
  },
  {
    name: 'validate-certs',
    run: async ({ log }) => {
      const validateCerts = require('../validate-certs.js');
      const result = await validateCerts({ strict: false });
      if (result?.ok === false) {
        log('(Run `npx omega validate-certs` after wiring up your signing assets to re-check.)');
      }
    },
  },
  {
    name: 'provision-repos',
    run: async ({ projectDir, log, warn }) => {
      require('@omega.js/config').loadEnv(projectDir);
      if (!process.env.GH_TOKEN) {
        return log('(Skipping repo provisioning: GH_TOKEN not set.)');
      }
      await provisionReleaseRepos({ projectDir, log, warn });
    },
  },
  {
    name: 'push-secrets',
    // No .env check: the target ships none of its own — the keys come from the
    // composed target env (the brand root's .env, #678).
    run: async ({ projectDir, log }) => {
      require('@omega.js/config').loadEnv(projectDir);
      if (!process.env.GH_TOKEN) {
        return log('(Skipping push-secrets: GH_TOKEN not set in the .env cascade. Run `npx omega push-secrets` after filling it in.)');
      }
      await require('../push-secrets.js')({});
    },
  },
];

/**
 * @param {object} input
 * @param {string} input.projectDir - The target root.
 * @param {object} input.options - The parsed CLI options (`secrets: false` = opted out).
 * @param {object} input.logger - `{ log, warn, error }`.
 * @param {Array} [input.steps] - Injectable step list (tests).
 * @returns {Promise<{ skipped: string }|{ ran: string[] }>} The steps that ran, or the opt-out marker.
 */
function deployPrecheck({ projectDir, options, logger, steps }) {
  return runDeployPrecheck({ projectDir, options, logger, steps: steps || STEPS });
}

module.exports = { deployPrecheck, STEPS, provisionReleaseRepos };
