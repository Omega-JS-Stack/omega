/**
 * Ensure the org's Actions runner groups can actually serve this brand's
 * repo (#872): the one setting that decides whether a dispatched desktop
 * release RUNS or sits queued forever with no error anywhere.
 *
 * A self-hosted Windows signer (the EV USB token runner) is registered to
 * the ORG, and an org runner group refuses public repositories unless
 * "Allow public repositories" is checked on it. A brand that publishes its
 * source hits both defaults at once, silently: GitHub accepts the dispatch
 * and the windows-sign job never starts.
 *
 * Ian's ruling (2026-09-10): this FAILS LOUDLY, never a flip (the checkbox
 * is the owner's, and flipping it needs org-admin rights) and never a quiet
 * warning. The walk stops on the message with the checkbox and the link.
 *
 * Runs only where all three hold: a desktop target, a PUBLIC source repo (the
 * brand root's package.json says which, #883), and the self-hosted Windows
 * signing strategy (the default). A personal-account owner has no runner
 * groups at all, so there is nothing to check.
 *
 * The same three conditions gate the second check
 * ([#875](https://github.com/Omega-JS-Stack/omega/issues/875)): the brand's own
 * composed workflows, warned on for a `push` or `pull_request` trigger in any
 * file that puts a job on a self-hosted runner. The org group decides whether a
 * dispatch REACHES the box; this decides what else could.
 */
const path = require('path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const { hasTargetOfType, targetsOfType } = require('@omega.js/config');

/**
 * The triggers that must never reach a self-hosted runner
 * ([#875](https://github.com/Omega-JS-Stack/omega/issues/875)): a workflow with
 * a job on the box that holds the EV token fires on a DISPATCH and nothing
 * else. A push trigger queues jobs on a box that may be off, and on a public
 * repo it hands anyone who can open a PR a shell on hardware in the house.
 */
const STRAY_TRIGGERS = ['push', 'pull_request'];

/**
 * The org's runner-group settings page: the one place the checkbox lives.
 *
 * @param {string} org - GitHub org login.
 * @returns {string} Settings URL.
 */
function runnerGroupsUrl(org) {
  return `https://github.com/organizations/${org}/settings/actions/runner-groups`;
}

/**
 * Does this workflow put a job on a self-hosted runner?
 *
 * Read off the TEXT, not a YAML tree: the manager declares no YAML parser, and
 * the shape a `runs-on:` takes is the one thing this question does not care
 * about: a plain string, a label list, a `group:`/`labels:` map, or desktop's
 * own `${{ ... fromJSON('["self-hosted","windows","ev-token"]') ... }}` all say
 * the same word. So each `runs-on:` value is taken with the indented block that
 * may follow it and searched for the label.
 *
 * @param {string} content - The workflow file.
 * @returns {boolean} Whether any job targets a self-hosted runner.
 */
function targetsSelfHosted(content) {
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const match = /^(\s*)runs-on:(.*)$/.exec(lines[i]);
    if (!match) continue;

    let value = match[2];
    const indent = match[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      if (next.trim() === '') continue;
      if (next.search(/\S/) <= indent) break;
      value += ` ${next}`;
    }

    if (value.includes('self-hosted')) return true;
  }

  return false;
}

// The `on:` key, in either spelling a workflow writes it (`on:` or `"on":`).
const ON_KEY = /^(?:on|'on'|"on"):/;

/**
 * The triggers a workflow declares, whichever of the three shapes it uses:
 * `on: push`, `on: [push, pull_request]`, or the block map.
 *
 * @param {string} content - The workflow file.
 * @returns {string[]} The trigger names.
 */
function workflowTriggers(content) {
  const lines = content.split(/\r?\n/);
  // YAML 1.1 reads a bare `on` as the boolean true, so a real workflow may
  // spell the key quoted.
  const start = lines.findIndex((line) => ON_KEY.test(line));
  if (start === -1) return [];

  const inline = lines[start].replace(ON_KEY, '').trim();
  if (inline !== '') {
    return inline.replace(/^\[|\]$/g, '').split(',').map((name) => name.trim()).filter(Boolean);
  }

  const triggers = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    if (/^\S/.test(line)) break;                                  // the next top-level key ends the block
    // Whatever rides the key: a trailing comment, a flow-style map
    // (`push: { branches: [main] }`), or nothing at all. Every line at this
    // indent inside the block IS a trigger, so the value is not read.
    const name = /^\s{2}(?:-\s*)?([A-Za-z_]+)\s*:?\s*(?:\S.*)?$/.exec(line);
    if (name) triggers.push(name[1]);
  }

  return triggers;
}

/**
 * The brand's composed workflows that would put a stray trigger on the box
 * ([#875](https://github.com/Omega-JS-Stack/omega/issues/875)). GitHub runs
 * workflows from the repo root only, so the brand ROOT's `.github/workflows/`
 * is the whole surface.
 *
 * @param {string} brandRoot - The brand root.
 * @returns {Array<{file: string, trigger: string}>} One entry per stray trigger.
 */
function strayTriggers(brandRoot) {
  const dir = path.join(brandRoot, '.github', 'workflows');
  const found = [];

  for (const name of jetpack.list(dir) || []) {
    if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;

    const content = jetpack.read(path.join(dir, name));
    if (!content || !targetsSelfHosted(content)) continue;

    for (const trigger of workflowTriggers(content)) {
      if (STRAY_TRIGGERS.includes(trigger)) found.push({ file: name, trigger });
    }
  }

  return found;
}

module.exports = async function ensureRunners(context) {
  const { brand, brandConfig, brandVisibility: visibility } = context;

  if (!hasTargetOfType(brand.config, 'desktop')) {
    console.log(`      ${chalk.dim('⊘ No desktop target, no self-hosted runner to reach')}`);
    return { status: 'success', output: { runners: { skipped: 'no desktop target' } } };
  }

  // A private repo is what an org runner group serves by default
  if (visibility !== 'public') {
    console.log(`      ${chalk.dim('⊘ Private repo, org runners serve it by default')}`);
    return { status: 'success', output: { runners: { skipped: 'repo is private' } } };
  }

  // The desktop target's OWN entry, whatever it is named (#886): its
  // settings never live under a key spelled for the type.
  // Absent = self-hosted: the framework default every desktop brand signs with
  const desktop = targetsOfType(brandConfig, 'desktop')[0];
  const strategy = desktop?.platforms?.windows?.signing?.strategy || 'self-hosted';
  if (strategy !== 'self-hosted') {
    console.log(`      ${chalk.dim(`⊘ Windows signing strategy is ${strategy}, no self-hosted runner`)}`);
    return { status: 'success', output: { runners: { skipped: `Windows signing strategy is ${strategy}` } } };
  }

  // The brand's own workflows, before the org's settings: the runner group says
  // whether a dispatch REACHES the box, and this says what else could
  // ([#875](https://github.com/Omega-JS-Stack/omega/issues/875)). One line per
  // stray trigger, naming the file and the trigger, and the step warns rather
  // than fails: the file is the brand's to fix, and every legitimate deploy
  // still runs.
  const stray = strayTriggers(context.brandRoot);
  for (const { file, trigger } of stray) {
    console.log(`      ${chalk.yellow('⚠')} ${file} fires on ${trigger} and puts a job on a self-hosted runner: a self-hosted-runner workflow fires only on dispatch`);
  }

  const result = await checkRunnerGroups(context);

  // A stray trigger never downgrades a louder verdict, and never overwrites the
  // group answer either: it rides along in the same output.
  if (stray.length === 0 || result.status === 'error') return result;

  return {
    status: 'warned',
    reason: `${stray.length} workflow trigger(s) on a self-hosted runner that is not a dispatch: ${stray.map(({ file, trigger }) => `${file} (${trigger})`).join(', ')}`,
    output: { runners: { ...(result.output?.runners || {}), strayTriggers: stray } },
  };
};

/**
 * The org runner-group half (#872, #879), from the owner read down.
 *
 * @param {object} context - The ensure context.
 * @returns {Promise<object>} The operation result.
 */
async function checkRunnerGroups(context) {
  const { githubApi: api, sourceRepoInfo: source } = context;
  const owner = source.owner;
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
  const repoName = source.name;
  const fullName = source.slug;
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
}

module.exports.strayTriggers = strayTriggers;
module.exports.targetsSelfHosted = targetsSelfHosted;
module.exports.workflowTriggers = workflowTriggers;
