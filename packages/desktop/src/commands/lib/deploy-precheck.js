/**
 * deploy-precheck — the NETWORK half `omega setup` used to own
 * ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)).
 *
 * Setup's local half now rides every verb (ensure-target.js); what needs the
 * network rides the ONE verb that needs the remote side right —
 * `omega deploy` — as a precheck before the dispatch:
 *
 *   framework freshness  the npm registry's latest vs the installed version
 *   validate-certs       the signing prereqs, STRICT and fatal (#891)
 *   provision-repos      the public releases repo the config names (idempotent)
 *   push-secrets         the composed target env into GitHub Actions repo
 *                        secrets, fatal (#891)
 *
 * The two SIGNING steps are fatal and everything else is soft: a deploy is how
 * a signed, notarized release ships, so material that is missing or expired
 * stops the run here ([#891](https://github.com/Omega-JS-Stack/omega/issues/891))
 * instead of producing a green run with an app Gatekeeper refuses. `--no-secrets`
 * skips the whole precheck — the same opt-out name on web, desktop and
 * extension (parity; desktop's old `--quick` is gone).
 *
 * The RUNNER is `@omega.js/devkit/deploy-precheck` (one copy for every
 * framework); this file is desktop's STEPS.
 */
const Manager = new (require('../../build.js'));
const { runDeployPrecheck } = require('@omega.js/devkit/deploy-precheck');
const { releasesRepo } = require('@omega.js/config');
const { publishTargetSecrets } = require('@omega.js/devkit/target-secrets');
const { resolveToken } = require('@omega.js/devkit/deploy');
const { updateManager } = require('./dependencies.js');

const package = Manager.getPackage('main');

/**
 * Auto-provision the brand's ONE public releases repo, addressed by
 * @omega.js/config's `releasesRepo` (`<brand.id>-releases` under the brand's
 * org, #883: no repo name is ever typed). Idempotent: only creates if
 * missing. Config-only, never the git remote: a brand nested in another repo
 * would provision under the enclosing repo's owner (#799).
 *
 * PUBLIC, always: a shipped app polls this feed with no token, and so does a
 * download button on the site. It is created with a first commit (`autoInit`),
 * because a release needs a tag and a tag needs a commit.
 *
 * The repo itself is created by `@omega.js/devkit/github-repo`'s ensureRepo,
 * the ONE home every OMEGA repo is created and reconciled from (#883): the
 * manage walk and the web deploy call the same function.
 *
 * @param {object} input
 * @param {Function} input.log - Progress line sink.
 * @param {Function} input.warn - Warning sink.
 * @param {object} [input.config] - Injectable resolved config (tests).
 * @param {boolean} [input.dryRun] - Plan only: ensureRepo builds the plan and
 *   creates nothing (#895).
 * @param {Function} [input.execFn] - Injectable `gh` exec (tests).
 */
async function provisionReleaseRepos({ log, warn, config, execFn, dryRun }) {
  const { ensureRepo } = require('@omega.js/devkit/github-repo');

  const resolved = config || Manager.getConfig() || {};
  if (resolved.releases?.enabled === false) return;

  const releases = releasesRepo(resolved);
  if (!releases) {
    warn('provision-repos: could not address the releases repo. Set repo.org and brand.id in config/omega.json5 (the releases repo is <brand.id>-releases under that org).');
    return;
  }

  const description = `Public release artifacts + auto-update feed for ${releases.owner}'s @omega.js/desktop apps. Managed by @omega.js/desktop.`;

  try {
    const result = await ensureRepo({
      owner: releases.owner,
      name: releases.name,
      private: false,
      description,
      autoInit: true,
    }, { execFn, dryRun });
    log(`provision-repos: ✓ ${result.created ? 'created ' : ''}${releases.slug}${result.created ? '' : ' already exists'}: releases (auto-update feed + the site's download links)`);
  } catch (e) {
    warn(`provision-repos: ✗ ${releases.slug} (releases): ${e.message}`);
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
    // STRICT, and fatal: a deploy is how a signed release ships, so signing
    // material that is missing, expired or unreadable stops it here rather than
    // producing a green run with an unsigned app in it (#891).
    name: 'validate-certs',
    fatal: true,
    run: async () => {
      const validateCerts = require('../validate-certs.js');
      await validateCerts({ strict: true });
    },
  },
  {
    name: 'provision-repos',
    run: async ({ projectDir, log, warn, dryRun }) => {
      require('@omega.js/config').loadEnv(projectDir);
      // The same token chain the dispatch resolves (`GH_TOKEN` →
      // `GITHUB_TOKEN` → `gh auth token`): a machine signed in with `gh` and
      // no variable exported can provision its repos like any other.
      if (!resolveToken()) {
        return log('(Skipping repo provisioning: no GitHub token. Set GH_TOKEN, or sign in with `gh auth login`.)');
      }
      await provisionReleaseRepos({ log, warn, dryRun });
    },
  },
  {
    name: 'push-secrets',
    // No .env check and no PAT: the keys come from the composed target env (the
    // brand root's .env, #678) and the transport is `gh`'s own auth session
    // ([#682](https://github.com/Omega-JS-Stack/omega/issues/682)), the same
    // one-line call web, backend and the extension make. Fatal: the runner
    // signs with what this step sends, so a refused or half publish must stop
    // the deploy instead of handing CI a set it cannot sign with (#891).
    fatal: true,
    run: ({ projectDir, log, warn, dryRun }) => publishTargetSecrets({
      targetDir: projectDir,
      target: 'desktop',
      logger: { log, warn, error: warn },
      dryRun,
    }),
  },
];

/**
 * @param {object} input
 * @param {string} input.projectDir - The target root.
 * @param {object} input.options - The parsed CLI options (`secrets: false` = opted out).
 * @param {object} input.logger - `{ log, warn, error }`.
 * @param {Array} [input.steps] - Injectable step list (tests).
 * @param {boolean} [input.dryRun] - Plan only; handed to every step (#895).
 * @returns {Promise<{ skipped: string }|{ ran: string[] }>} The steps that ran, or the opt-out marker.
 */
function deployPrecheck({ projectDir, options, logger, steps, dryRun }) {
  return runDeployPrecheck({ projectDir, options, logger, steps: steps || STEPS, dryRun });
}

module.exports = { deployPrecheck, STEPS, provisionReleaseRepos };
