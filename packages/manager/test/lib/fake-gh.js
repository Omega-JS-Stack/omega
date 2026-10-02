/**
 * A stand-in for the `gh` CLI, answering from a canned account, so no test ever
 * reaches GitHub. Two doors, like fake-claude: `createGh(account)`, an injected
 * exec, and `activate()`, a `gh` executable first on PATH that logs every call.
 *
 * The account is `{ user, orgs, plan, repos, pages, branches, failing, noSlurp }`;
 * null is signed out. `repos` and `pages` map a slug to its json, `branches` a
 * slug to its branch names, and `plan` is every org's plan (default free).
 * `--slurp` answers the page array the real CLI prints (`[[...page 1]]`), a repo
 * in `failing` answers a server error, and `noSlurp` is an old CLI without the flag.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STATE_ENV = 'OMEGA_TEST_FAKE_GH';
const LOG_ENV = 'OMEGA_TEST_FAKE_GH_LOG';

/**
 * One `gh` call against `account`.
 * @param {object|null} account - The signed-in account, null when signed out.
 * @param {string[]} args - The words after `gh`.
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function answer(account, args) {
  const ok = (body) => ({ status: 0, stdout: `${typeof body === 'string' ? body : JSON.stringify(body)}\n`, stderr: '' });
  const fail = (status, message) => ({ status, stdout: '', stderr: `${message}\n` });

  const notFound = () => fail(1, 'gh: Not Found (HTTP 404)');

  if (args[0] === '--version') return ok('gh version 2.100.0 (fake)');
  if (!account) return fail(4, 'To get started with GitHub CLI, please run:  gh auth login');
  const state = { orgs: [], plan: 'free', repos: {}, pages: {}, branches: {}, failing: [], ...account };
  if (args.includes('--slurp') && state.noSlurp) return fail(1, 'unknown flag: --slurp');

  const repoOf = (slug) => {
    if (state.failing.includes(slug)) return fail(1, 'gh: Server Error (HTTP 502)');
    if (state.repos[slug]) return ok({ name: slug.split('/')[1], full_name: slug, owner: { login: slug.split('/')[0] }, ...state.repos[slug] });
    return notFound();
  };
  if (args[0] === 'repo' && args[1] === 'view') return repoOf(args[2]);
  if (args[0] === 'repo' && args[1] === 'create') return ok('');

  // Every write the fake accepts; a read answers from the account
  if (args.includes('-X') && args[args.indexOf('-X') + 1] !== 'GET') return ok({});
  const endpoint = (args.find((arg) => /^\/?(user|repos|orgs)\b/.test(arg)) || '').replace(/^\//, '').split('?')[0];
  if (endpoint === 'user') return ok({ login: state.user, type: 'User' });
  if (endpoint === 'user/orgs') {
    const page = state.orgs.map((login) => ({ login }));
    return ok(args.includes('--slurp') ? [page] : page);
  }
  const org = /^orgs\/([^/]+)$/.exec(endpoint);
  if (org) return state.orgs.includes(org[1]) ? ok({ login: org[1], plan: { name: state.plan } }) : notFound();
  const branch = /^repos\/([^/]+\/[^/]+)\/branches\/(.+)$/.exec(endpoint);
  if (branch) return (state.branches[branch[1]] || []).includes(branch[2]) ? ok({ name: branch[2] }) : notFound();
  const pages = /^repos\/([^/]+\/[^/]+)\/pages$/.exec(endpoint);
  if (pages) return state.pages[pages[1]] ? ok(state.pages[pages[1]]) : notFound();
  const repo = /^repos\/([^/]+\/[^/]+)$/.exec(endpoint);
  if (repo) return repoOf(repo[1]);
  return fail(1, `fake gh: no answer for gh ${args.join(' ')}`);
}

/**
 * The injected door: an exec called `(file, args, options)` with `file` 'gh',
 * returning stdout and throwing on a non-zero exit with the error execFileSync
 * throws. Any other call form throws. Every call's words after `gh` land on
 * `exec.calls`, and `exec.mutations()` keeps the ones that write.
 * @param {object|null} account - See answer().
 * @returns {function}
 */
function createGh(account) {
  const exec = (file, args) => {
    if (file !== 'gh' || !Array.isArray(args)) {
      throw new Error(`fake gh: call as ('gh', args), got (${JSON.stringify(file)}, ${JSON.stringify(args)})`);
    }
    const words = args.map(String);
    exec.calls.push(words);
    const result = answer(account, words);
    if (result.status !== 0) {
      throw Object.assign(new Error(`Command failed: gh ${words.join(' ')}\n${result.stderr}`), result);
    }
    return result.stdout;
  };
  exec.calls = [];
  exec.mutations = () => exec.calls.filter((args) => (
    (args[0] === 'repo' && args[1] === 'create')
    || (args[0] === 'secret' && args[1] === 'set')
    || (args.includes('-X') && args[args.indexOf('-X') + 1] !== 'GET')
  ));
  return exec;
}

/**
 * The PATH door: a `gh` first on this process' PATH (and every child's), signed
 * out until `useGh` signs it in. Its folder is removed when the process exits.
 * @returns {{ useGh: function, withoutGh: function, ghCalls: function }}
 */
function activate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-fake-gh-'));
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/sh\nexec "${process.execPath}" "${__filename}" "$@"\n`, { mode: 0o755 });
  process.env.PATH = [dir, process.env.PATH].join(path.delimiter);
  process.env[LOG_ENV] = path.join(dir, 'calls.log');
  delete process.env[STATE_ENV];

  return {
    /** Sign the PATH gh in as `account` (null signs it out). Returns the undo. */
    useGh(account) {
      if (account) process.env[STATE_ENV] = JSON.stringify(account);
      else delete process.env[STATE_ENV];
      return () => { delete process.env[STATE_ENV]; };
    },
    /** Take every `gh`, this one and any real one, off PATH. Returns the undo. */
    withoutGh() {
      const previous = process.env.PATH;
      process.env.PATH = previous.split(path.delimiter).filter((entry) => !fs.existsSync(path.join(entry, 'gh'))).join(path.delimiter);
      return () => { process.env.PATH = previous; };
    },
    /** Every call the PATH gh has answered, as the words after `gh`. */
    ghCalls() {
      const log = process.env[LOG_ENV];
      return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
    },
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (process.env[LOG_ENV]) fs.appendFileSync(process.env[LOG_ENV], `${JSON.stringify(args)}\n`);
  const result = answer(process.env[STATE_ENV] ? JSON.parse(process.env[STATE_ENV]) : null, args);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.status;
}

module.exports = { answer, createGh, activate };
