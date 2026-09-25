// The self-hosted signer's job-started hook
// ([#875](https://github.com/Omega-JS-Stack/omega/issues/875)): the box refuses
// any job that is not a trusted dispatch, before the job's first step runs.
//
// The runner runs this file through `ACTIONS_RUNNER_HOOK_JOB_STARTED`, an
// absolute path in the runner's own `<runner dir>\.env`. A nonzero exit fails
// the job with this script's output and NOTHING of the job runs: no checkout,
// no install, and no signtool call against the EV token. GitHub documents the
// hook at https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/run-scripts
// (the docs name `.sh` and `.ps1`; the runner ALSO handles `.js`, running it
// with its OWN bundled node, per `GetDefaultShellForScript` in
// `src/Runner.Common/HostContext.cs` of actions/runner v2.319.1, the version
// `omega runner install` pins). So this is one plain Node file, no PowerShell,
// and the unit suite runs it on any platform.
//
// The three checks, every one of which must pass:
//   GITHUB_EVENT_NAME  the one trusted dispatch: `workflow_dispatch`
//   GITHUB_REPOSITORY  listed in allowed-repos.txt
//   GITHUB_ACTOR       listed in allowed-actors.txt
// All three are the job's standard environment, exported to the hook by the
// runner's `_contextEnvAllowlist` (`src/Runner.Worker/GitHubContext.cs`:
// `actor`, `event_name`, `repository`).
//
// Node BUILTINS only, on purpose: this file is installed beside the runner, in
// the runner home, where there is no `node_modules` to resolve `fs-jetpack`
// from, and the runner's own node runs it, not the box's.
const fs   = require('fs');
const path = require('path');

// ONE trusted event (#923): every publish path (`omega deploy`, a CMS button, a
// plain HTTP call) dispatches `workflow_dispatch` at the deploy ref, and its
// actor is the deploy token's user, the same account the box owner signs in as.
const DISPATCH_EVENTS = ['workflow_dispatch'];

const REPOS_FILE  = 'allowed-repos.txt';
const ACTORS_FILE = 'allowed-actors.txt';

// One entry per line, `#` comments and blank lines dropped. An unreadable file
// reads as NO entries, which refuses every job: a guard that cannot read its
// allow list allows nothing.
function readList(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return [];
  }
  return raw.split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean);
}

// `owner/name`, or `owner/*` for every repo of one owner, which is the scope a
// runner registration already has, and the line `omega runner install` writes.
// Narrowing it to individual repos is an edit of the file, by hand.
function repoMatches(repository, entry) {
  const listed = entry.toLowerCase();
  const seen   = String(repository || '').toLowerCase();
  if (listed.endsWith('/*')) return seen.startsWith(listed.slice(0, -1));
  return seen === listed;
}

// The verdict, as data: `{ allowed, line }`, one line whatever the answer, so
// the caller below is only an exit code and a `console.log`.
function checkJob(env, lists) {
  const { repos = [], actors = [], reposFile = REPOS_FILE, actorsFile = ACTORS_FILE } = lists || {};
  const event      = env.GITHUB_EVENT_NAME || '';
  const repository = env.GITHUB_REPOSITORY || '';
  const actor      = env.GITHUB_ACTOR || '';

  if (!DISPATCH_EVENTS.includes(event)) {
    return { allowed: false, line: `Refusing this job: GITHUB_EVENT_NAME is "${event}", and this runner serves ${DISPATCH_EVENTS.join(' and ')} only.` };
  }
  if (repos.length === 0) {
    return { allowed: false, line: `Refusing this job: ${reposFile} lists no repository, so this runner allows none. Run \`npx omega runner start\` on the box, or add one \`owner/name\` per line.` };
  }
  if (!repos.some((entry) => repoMatches(repository, entry))) {
    return { allowed: false, line: `Refusing this job: GITHUB_REPOSITORY is "${repository}", which is not listed in ${reposFile}.` };
  }
  if (actors.length === 0) {
    return { allowed: false, line: `Refusing this job: ${actorsFile} lists no actor, so this runner allows none. Run \`npx omega runner install\` on the box, or add one login per line.` };
  }
  if (!actors.some((entry) => entry.toLowerCase() === actor.toLowerCase())) {
    return { allowed: false, line: `Refusing this job: GITHUB_ACTOR is "${actor}", which is not listed in ${actorsFile}.` };
  }

  return { allowed: true, line: `Allowing this job: ${event} on ${repository} by ${actor}.` };
}

// The allow lists sit BESIDE this file, in the runner home the install writes
// them to, so the hook needs no configuration of its own to find them.
function loadLists(dir) {
  const reposFile  = path.join(dir, REPOS_FILE);
  const actorsFile = path.join(dir, ACTORS_FILE);
  return { repos: readList(reposFile), actors: readList(actorsFile), reposFile, actorsFile };
}

if (require.main === module) {
  const verdict = checkJob(process.env, loadLists(__dirname));
  console.log(verdict.line);
  process.exit(verdict.allowed ? 0 : 1);
}

module.exports = { checkJob, loadLists, readList, repoMatches, DISPATCH_EVENTS, REPOS_FILE, ACTORS_FILE };
