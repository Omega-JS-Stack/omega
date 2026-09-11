/**
 * Ensure the org's Actions runner groups can actually serve this brand's
 * repo (#872): the one setting that decides whether a dispatched desktop
 * release RUNS or sits queued forever with no error anywhere.
 *
 * A self-hosted Windows signer (the EV USB token runner) is registered to
 * the ORG, and an org runner group refuses public repositories unless
 * "Allow public repositories" is checked on it. A brand repo is public the
 * moment it serves gh-pages, so the two defaults collide silently: GitHub
 * accepts the dispatch and the windows-sign job never starts.
 *
 * Ian's ruling (2026-09-10): this FAILS LOUDLY, never a flip (the checkbox
 * is the owner's, and flipping it needs org-admin rights) and never a quiet
 * warning. The walk stops on the message with the checkbox and the link.
 *
 * Runs only where all three hold: a desktop target, a PUBLIC repo, and the
 * self-hosted Windows signing strategy (the default). A personal-account
 * owner has no runner groups at all, so there is nothing to check.
 */
const chalk = require('chalk').default;
const { brandRepoName, brandRepoOwner } = require('@omega.js/config');

/**
 * The org's runner-group settings page: the one place the checkbox lives.
 *
 * @param {string} org - GitHub org login.
 * @returns {string} Settings URL.
 */
function runnerGroupsUrl(org) {
  return `https://github.com/organizations/${org}/settings/actions/runner-groups`;
}

module.exports = async function ensureRunners(context) {
  const { brand, brandConfig, githubApi: api } = context;

  if (!brand.enabledTargets.includes('desktop')) {
    console.log(`      ${chalk.dim('⊘ No desktop target, no self-hosted runner to reach')}`);
    return { status: 'success', output: { runners: { skipped: 'no desktop target' } } };
  }

  const github = brandConfig.repo?.providers?.github;

  // A private repo is what an org runner group serves by default
  if (github.private !== false) {
    console.log(`      ${chalk.dim('⊘ Private repo, org runners serve it by default')}`);
    return { status: 'success', output: { runners: { skipped: 'repo is private' } } };
  }

  // Absent = self-hosted: the framework default every desktop brand signs with
  const strategy = brandConfig.targets?.desktop?.platforms?.win?.signing?.strategy || 'self-hosted';
  if (strategy !== 'self-hosted') {
    console.log(`      ${chalk.dim(`⊘ Windows signing strategy is ${strategy}, no self-hosted runner`)}`);
    return { status: 'success', output: { runners: { skipped: `Windows signing strategy is ${strategy}` } } };
  }

  const owner = brandRepoOwner(brandConfig);
  const account = api.getUser(owner);

  if (account?.type !== 'Organization') {
    console.log(`      ${chalk.dim(`⊘ ${owner} is a personal account, runner groups are org-only`)}`);
    return { status: 'success', output: { runners: { skipped: 'owner is not an organization' } } };
  }

  const link = runnerGroupsUrl(owner);

  let groups;
  try {
    groups = api.getRunnerGroups(owner);
  } catch (error) {
    // 403/404 = a token without the org-admin scope: not a verdict, so the
    // check is handed back by hand. Anything else broke the read itself, and a
    // read that broke is not "probably fine" (Ian's ruling on this step: loud).
    if (!/\b40[34]\b/.test(error.message)) {
      const message = `Could not read ${owner}'s Actions runner groups: ${error.message}`;
      console.log(`      ${chalk.red('✗')} ${message}`);
      return { status: 'error', error: message };
    }
    console.log(`      ${chalk.yellow('⚠')} Could not read ${owner}'s runner groups${chalk.dim(`: ${error.message}`)}`);
    console.log(`      ${chalk.dim(`Check "Allow public repositories" by hand: ${link}`)}`);
    return {
      status: 'warned',
      reason: `could not read ${owner}'s Actions runner groups`,
      output: { runners: { unreadable: `${error.message} (check it by hand: ${link})` } },
    };
  }

  const allowing = (groups?.runner_groups || []).filter((group) => group.allows_public_repositories === true);

  if (!allowing.length) {
    const message = `${owner} has no Actions runner group that allows public repositories, so a dispatched desktop release would queue forever on the self-hosted Windows signer. Check "Allow public repositories" on the runner group: ${link}`;
    console.log(`      ${chalk.red('✗')} ${message}`);
    return { status: 'error', error: message };
  }

  // "Allow public repositories" is only half the answer: a group can also be
  // scoped to SELECTED repos, and a brand repo the list leaves out queues the
  // same way with the checkbox green (#879). visibility 'all' (or absent, the
  // pre-scoping shape) already answers for every repo. EVERY allowing group
  // gets its turn in API order: one scoped group that leaves the repo out is
  // not a verdict while a later group still serves it.
  const repoName = brandRepoName(brandConfig);
  const fullName = `${owner}/${repoName}`;
  const excluded = [];

  for (const group of allowing) {
    if (group.visibility === 'selected') {
      let scoped;
      try {
        scoped = api.getRunnerGroupRepositories(owner, group.id);
      } catch (error) {
        if (!/\b40[34]\b/.test(error.message)) {
          const message = `Could not read the repositories runner group ${group.name} serves: ${error.message}`;
          console.log(`      ${chalk.red('✗')} ${message}`);
          return { status: 'error', error: message };
        }
        console.log(`      ${chalk.yellow('⚠')} Could not read the repositories runner group ${group.name} serves${chalk.dim(`: ${error.message}`)}`);
        console.log(`      ${chalk.dim(`Check that ${fullName} is on the group by hand: ${link}`)}`);
        return {
          status: 'warned',
          reason: `could not read the repositories runner group ${group.name} serves`,
          output: { runners: { unreadable: `${error.message} (check it by hand: ${link})` } },
        };
      }

      const listed = (scoped?.repositories || []).some((repo) => repo.name === repoName || repo.full_name === fullName);

      // Not this group's repo: remember it for the message and try the next one
      if (!listed) {
        excluded.push(group.name);
        continue;
      }
    }

    console.log(`      ${chalk.green('✓')} Runner group ${chalk.cyan(group.name)} allows public repositories`);
    return { status: 'success', output: { runners: { group: group.name, visibility: group.visibility || 'all' } } };
  }

  // Every allowing group is scoped to a repo list this brand is not on
  const names = excluded.join(', ');
  const scopedMessage = excluded.length > 1
    ? `${owner}'s runner groups ${names} allow public repositories but are scoped to selected repositories that do not include ${fullName}`
    : `${owner}'s runner group ${names} allows public repositories but is scoped to selected repositories that do not include ${fullName}`;
  const message = `${scopedMessage}, so a dispatched desktop release would queue forever on the self-hosted Windows signer. Add the repo to ${excluded.length > 1 ? 'a group' : 'the group'}: ${link}`;
  console.log(`      ${chalk.red('✗')} ${message}`);
  return { status: 'error', error: message };
};
