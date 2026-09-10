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
 *   provision-repos      the public releases repo the config names (idempotent)
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
const { releasesRepo } = require('@omega.js/config');
const { updateManager } = require('./dependencies.js');
const { publishEnvSecrets } = require('../push-secrets.js');

const package = Manager.getPackage('main');

/**
 * Auto-provision the brand's ONE public releases repo, addressed by
 * @omega.js/config's `releasesRepo` (`<brand.id>-releases` under the brand repo
 * owner unless the config names another). Idempotent: only creates if missing.
 * Config-only, never the git remote: a brand nested in another repo would
 * provision under the enclosing repo's owner (#799).
 *
 * @param {object} input
 * @param {Function} input.log - Progress line sink.
 * @param {Function} input.warn - Warning sink.
 * @param {object} [input.octokit] - Injectable client (tests); defaults to the GH_TOKEN one.
 * @param {object} [input.config] - Injectable resolved config (tests).
 */
async function provisionReleaseRepos({ log, warn, octokit, config }) {
  const { getOctokit, ensureRepo } = require('../../utils/github.js');
  const client = octokit || getOctokit();
  if (!client) return;

  const resolved = config || Manager.getConfig() || {};
  if (resolved.releases?.enabled === false) return;

  const { owner, name, repo } = releasesRepo(resolved);
  if (!repo) {
    warn('provision-repos: could not address the releases repo. Set repo.providers.github.org (or targets.desktop.releases.owner) and brand.id in config/omega.json5.');
    return;
  }

  const description = `Public release artifacts + auto-update feed for ${owner}'s @omega.js/desktop apps. Managed by @omega.js/desktop.`;

  try {
    const result = await ensureRepo(client, owner, name, { description, private: false });
    log(`provision-repos: ✓ ${result.created ? 'created ' : ''}${repo}${result.created ? '' : ' already exists'} — releases (auto-update feed + the site's download links)`);
  } catch (e) {
    warn(`provision-repos: ✗ ${repo} (releases) — ${e.message}`);
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
      await provisionReleaseRepos({ log, warn });
    },
  },
  {
    name: 'push-secrets',
    // No .env check and no PAT: the keys come from the composed target env (the
    // brand root's .env, #678) and the transport is `gh`'s own auth session
    // ([#682](https://github.com/Omega-JS-Stack/omega/issues/682)) — the same
    // one-line call web and the extension make.
    run: ({ projectDir, log, warn }) => publishEnvSecrets({ targetDir: projectDir, logger: { log, warn, error: warn } }),
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
