/**
 * The GitHub owners the wizard offers for `repo.owner`: every owner the signed-in
 * GitHub CLI can see (the user and its orgs), ordered "create a new org" first,
 * then the best match, then the rest alphabetically. The CLI is an injected
 * exec answering canned output; nothing here reaches GitHub.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const jetpack = require('fs-jetpack');

const { listOwners, orderOwners, askOwner } = require('../src/lib/github-owners.js');
const { createGh, activate } = require('./lib/fake-gh.js');
const { openTtyPrompt } = require('./lib/interactive.js');

// A runner the code does not read falls through to the `gh` on PATH: the fake, signed out.
activate();

const MANAGER = path.join(__dirname, '..');

const owner = (login, kind = 'org') => ({ login, kind });

/** Each entry (a login, an owner, or a `{ name, value }` choice) by its login; one naming no given owner reads `create`. */
function labels(ordered, owners) {
  const logins = owners.map((entry) => entry.login);
  return ordered.map((entry) => {
    const login = typeof entry === 'string' ? entry : (entry.login ?? entry.value);
    return logins.includes(login) ? login : 'create';
  });
}

test('#889 listOwners: the signed-in user and every org it can see, each with its kind', () => {
  const owners = listOwners({ execFn: createGh({ user: 'jane', orgs: ['zeta', 'acme'] }) });

  const byLogin = [...owners].sort((a, b) => a.login.localeCompare(b.login));
  assert.deepEqual(byLogin, [
    { login: 'acme', kind: 'org' },
    { login: 'jane', kind: 'user' },
    { login: 'zeta', kind: 'org' },
  ]);
});

test('#889 case 1: owners zeta, acme, beta and brand id acme read: create a new org, acme, beta, zeta', () => {
  const owners = [owner('zeta'), owner('acme'), owner('beta')];

  const ordered = orderOwners(owners, { brandId: 'acme' });

  assert.deepEqual(labels(ordered, owners), ['create', 'acme', 'beta', 'zeta']);
});

test('#889 case 2: the org that already holds <brand id>-omega is the best match, ahead of the alphabetical rest', () => {
  const owners = [owner('beta'), owner('zz-holder'), owner('alpha')];

  const ordered = orderOwners(owners, { brandId: 'acme', repoHolder: 'zz-holder' });

  assert.deepEqual(labels(ordered, owners), ['create', 'zz-holder', 'alpha', 'beta']);
});

// ─── One runner seam: execFn(file, args) ─────────────────────────────────────

test('#1044 askOwner runs every gh call through the injected execFn, the program named first', async (t) => {
  const gh = createGh({ user: 'jane', orgs: ['acme', 'beta'] });
  const files = [];
  const execFn = (file, args, options) => {
    files.push(file);
    return gh(file, args, options);
  };
  const tty = openTtyPrompt();
  t.after(() => tty.close());

  const asked = askOwner({ brandId: 'acme', execFn });
  await tty.answer('beta', '\r');

  assert.equal(await asked, 'acme', 'Enter takes the best match from the injected runner\'s list');
  assert.ok(files.length > 0, 'the owners came through the injected runner');
  assert.ok(files.every((file) => file === 'gh'), JSON.stringify(files));
});

test('#1044 the fake gh takes (file, args) only: called with the words alone, it throws', () => {
  const gh = createGh({ user: 'jane' });

  assert.throws(() => gh(['api', 'user']), /call as \('gh', args\)/);
  assert.deepEqual(gh.calls, [], 'the wrong form answers nothing');
  assert.equal(JSON.parse(gh('gh', ['api', 'user'])).login, 'jane');
});

test('#1044 no file under packages/manager/src names ghExec, claudeExec or runGh', () => {
  const src = jetpack.cwd(path.join(MANAGER, 'src'));

  const naming = src.find({ matching: '**/*' }).filter((file) => /\b(ghExec|claudeExec|runGh)\b/.test(src.read(file)));

  assert.deepEqual(naming, []);
});

test('#1044 repo.test.js uses the one fake gh and defines none of its own', () => {
  const text = jetpack.read(path.join(MANAGER, 'test', 'repo.test.js'));

  assert.match(text, /require\('\.\/lib\/fake-gh\.js'\)/);
  assert.doesNotMatch(text, /function\s+fakeGh\s*\(/);
  assert.doesNotMatch(text, /\.calls\s*=\s*\[\]/, 'no runner of its own records calls');
});
