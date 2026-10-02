/**
 * The onboard wizard's GitHub owner question: every owner the signed-in GitHub
 * CLI can create the brand's repos under (the user and its orgs), listed in
 * the wizard's order, and the pick that lands as `repo.org`.
 *
 * Every call goes through `exec(args)`, which runs `gh <args>`, returns its
 * stdout and throws on a failed command; the default is devkit's `gh`. A
 * missing or signed-out CLI fails the first call, which skips the question.
 */

const chalk = require('chalk').default;
const { gh, getRepo } = require('@omega.js/devkit/github-repo');
const { sourceRepo } = require('@omega.js/config');
const { select } = require('@omega.js/devkit/prompt');

const { sortChoicesForBrand } = require('./config-flow.js');

// The GitHub page that makes a new org; the wizard prints it and asks again
const CREATE_ORG_URL = 'https://github.com/account/organizations/new';

// The choice value of "create a new org", which no GitHub login can spell
const CREATE_ORG = '__CREATE_ORG__';

// The one line a run prints when the question cannot be asked
const OWNER_SKIP_LINE = 'GitHub CLI is not signed in, so the repo owner was not set. Set repo.org in config/omega.json5 later.';

const runGh = (args) => gh(args);

/**
 * The owners the signed-in GitHub CLI can see: the user first, then its orgs.
 *
 * @param {object} [options]
 * @param {Function} [options.exec] - The `gh` runner: `(args) => stdout`
 * @returns {Array<{ login: string, kind: 'user'|'org' }>|null} null when the CLI cannot answer (missing, signed out, or a failed call)
 */
function listOwners({ exec = runGh } = {}) {
  let user;
  let orgs;
  try {
    user = exec(['api', 'user']);
    // --slurp wraps every page in one outer array, so a long org list parses whole
    orgs = exec(['api', 'user/orgs', '--paginate', '--slurp']);
  } catch {
    return null;
  }

  const pages = JSON.parse(orgs);

  return [
    { login: JSON.parse(user).login, kind: 'user' },
    ...pages.flat().map((org) => ({ login: org.login, kind: 'org' })),
  ];
}

/**
 * The owner that already holds the brand's source repo (@omega.js/config's
 * `sourceRepo` under that owner), if any of them does. A probe that fails (a
 * 403 from an org's single sign-on, the network) only means that owner is not
 * the holder: the match is a hint, never a gate.
 *
 * @param {Array<{ login: string }>} owners - From listOwners()
 * @param {string} brandId - The brand id the source repo derives from
 * @param {object} [options]
 * @param {Function} [options.exec] - The `gh` runner: `(args) => stdout`
 * @returns {string|null} The holder's login
 */
function findRepoHolder(owners, brandId, { exec = runGh } = {}) {
  const execFn = (file, args) => exec(args);
  const holds = (owner) => {
    try {
      const repo = sourceRepo({ brand: { id: brandId }, repo: { org: owner.login } });
      return Boolean(getRepo(repo.owner, repo.name, { execFn }));
    } catch {
      return false;
    }
  };
  return owners.find(holds)?.login ?? null;
}

/**
 * The wizard's order: "create a new org" first, then the best match (the
 * holder of the brand's repo, else an owner named like the brand id), then
 * the rest alphabetically.
 *
 * @param {Array<{ login: string, kind: string }>} owners - From listOwners()
 * @param {object} match
 * @param {string} match.brandId - The brand id an owner's name is matched against
 * @param {string|null} [match.repoHolder] - The owner that already holds `<brand id>-omega`
 * @returns {Array<{ login: string|null, kind: 'create'|'user'|'org' }>} The owners in order, behind the `create` entry (no login)
 */
function orderOwners(owners, { brandId, repoHolder = null }) {
  const byLogin = new Map(owners.map((owner) => [owner.login, owner]));
  const { choices } = sortChoicesForBrand(owners, { id: brandId }, {
    getName: (owner) => owner.login,
    getValue: (owner) => owner.login,
    defaultValue: repoHolder,
  });

  return [{ login: null, kind: 'create' }, ...choices.map((choice) => byLogin.get(choice.value))];
}

/**
 * Ask which GitHub owner holds the brand's repos. Picking "create a new org"
 * prints the GitHub page for it and asks again over a fresh list. When the
 * GitHub CLI cannot answer, the origin's owner is the answer; with no origin
 * either, the skip line prints.
 *
 * @param {object} context
 * @param {string} context.brandId - The new brand's id
 * @param {string|null} [context.defaultOwner] - The origin remote's owner, the default answer when listed
 * @param {Function} [context.exec] - The `gh` runner: `(args) => stdout`
 * @returns {Promise<string|null>} The owner's login, or null when there is no answer
 */
async function askOwner({ brandId, defaultOwner = null, exec = runGh }) {
  for (;;) {
    const owners = listOwners({ exec });
    if (!owners && defaultOwner) {
      console.log(`${chalk.dim('•')} GitHub owner: ${chalk.cyan(defaultOwner)} ${chalk.dim('(the origin remote\'s; the GitHub CLI could not list owners)')}`);
      return defaultOwner;
    }
    if (!owners) {
      console.log(`${chalk.yellow('⚠')} ${OWNER_SKIP_LINE}`);
      return null;
    }

    const ordered = orderOwners(owners, { brandId, repoHolder: findRepoHolder(owners, brandId, { exec }) });
    const choices = ordered.map((owner) => (owner.kind === 'create'
      ? { name: '+ Create a new org', value: CREATE_ORG }
      : { name: owner.login, value: owner.login }));
    const listed = choices.some((choice) => choice.value === defaultOwner);
    const picked = await select({
      message: 'GitHub owner for the brand\'s repos:',
      choices,
      // choices[1] is the best match: the cursor never lands on "create"
      default: listed ? defaultOwner : choices[1].value,
    });
    if (picked !== CREATE_ORG) {
      return picked;
    }

    console.log(`  ${chalk.dim('→')} Create the org at ${chalk.cyan(CREATE_ORG_URL)}, then pick it below ${chalk.dim('(pick "Create a new org" again to reload the list)')}`);
  }
}

module.exports = { listOwners, findRepoHolder, orderOwners, askOwner, CREATE_ORG, CREATE_ORG_URL, OWNER_SKIP_LINE };
