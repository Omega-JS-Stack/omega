/**
 * A stand-in for the `gh` CLI, answering from a canned account, so no test ever
 * reaches GitHub. Two doors, like fake-claude: `createGh(account)`, an injected
 * exec, and `activate()`, a `gh` executable first on PATH that logs every call.
 *
 * The account is `{ user, orgs, repos, failing, noSlurp }`; null is signed out.
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

  if (!account) {
    return args[0] === 'auth'
      ? fail(1, 'You are not logged into any GitHub hosts. To log in, run: gh auth login')
      : fail(4, 'To get started with GitHub CLI, please run:  gh auth login');
  }
  const state = { orgs: [], repos: [], failing: [], ...account };
  if (args[0] === 'auth') return ok(`Logged in to github.com account ${state.user}`);
  if (args.includes('--slurp') && state.noSlurp) return fail(1, 'unknown flag: --slurp');

  const repoOf = (slug) => {
    if (state.failing.includes(slug)) return fail(1, 'gh: Server Error (HTTP 502)');
    if (state.repos.includes(slug)) return ok({ name: slug.split('/')[1], full_name: slug, owner: { login: slug.split('/')[0] } });
    return fail(1, 'gh: Not Found (HTTP 404)');
  };
  if (args[0] === 'repo' && args[1] === 'view') return repoOf(args[2]);

  const endpoint = (args.find((arg) => /^\/?(user|repos)\b/.test(arg)) || '').replace(/^\//, '').split('?')[0];
  if (endpoint === 'user') return ok({ login: state.user, type: 'User' });
  if (endpoint === 'user/orgs') {
    const page = state.orgs.map((login) => ({ login }));
    return ok(args.includes('--slurp') ? [page] : page);
  }
  if (endpoint.startsWith('repos/')) return repoOf(endpoint.slice('repos/'.length));
  return fail(1, `fake gh: no answer for gh ${args.join(' ')}`);
}

/**
 * The injected door: an exec in either call form, `(file, args, options)` or
 * `(args, options)`, returning stdout and throwing on a non-zero exit with the
 * error execFileSync throws. Every call's words land on `exec.calls`.
 * @param {object|null} account - See answer().
 * @returns {function}
 */
function createGh(account) {
  const exec = (first, second) => {
    const args = (Array.isArray(first) ? first : second).map(String);
    exec.calls.push(args);
    const result = answer(account, args);
    if (result.status !== 0) {
      throw Object.assign(new Error(`Command failed: gh ${args.join(' ')}\n${result.stderr}`), result);
    }
    return result.stdout;
  };
  exec.calls = [];
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
