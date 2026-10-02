/**
 * The GitHub owners the wizard offers for `repo.org`: every owner the signed-in
 * GitHub CLI can see (the user and its orgs), ordered "create a new org" first,
 * then the best match, then the rest alphabetically. The CLI is an injected
 * exec answering canned output; nothing here reaches GitHub.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { listOwners, orderOwners } = require('../src/lib/github-owners.js');
const { createGh } = require('./lib/fake-gh.js');

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
  const owners = listOwners({ exec: createGh({ user: 'jane', orgs: ['zeta', 'acme'] }) });

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
