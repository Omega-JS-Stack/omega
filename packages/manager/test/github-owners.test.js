/**
 * The GitHub owners the wizard offers for `repo.owner`: every owner the signed-in
 * GitHub CLI can see (the user and its orgs), ordered "create a new org" first,
 * then the best match, then the rest alphabetically. The CLI is an injected
 * exec answering canned output; nothing here reaches GitHub.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'github-owners',
  tests: [
    {
      name: '#889 listOwners: the signed-in user and every org it can see, each with its kind',
      run: (ctx) => {
        const owners = listOwners({ execFn: createGh({ user: 'jane', orgs: ['zeta', 'acme'] }) });

        const byLogin = [...owners].sort((a, b) => a.login.localeCompare(b.login));
        ctx.expect(byLogin).toEqual([
          { login: 'acme', kind: 'org' },
          { login: 'jane', kind: 'user' },
          { login: 'zeta', kind: 'org' },
        ]);
      },
    },

    {
      name: '#889 case 1: owners zeta, acme, beta and brand id acme read: create a new org, acme, beta, zeta',
      run: (ctx) => {
        const owners = [owner('zeta'), owner('acme'), owner('beta')];

        const ordered = orderOwners(owners, { brandId: 'acme' });

        ctx.expect(labels(ordered, owners)).toEqual(['create', 'acme', 'beta', 'zeta']);
      },
    },

    {
      name: '#889 case 2: the org that already holds <brand id>-omega is the best match, ahead of the alphabetical rest',
      run: (ctx) => {
        const owners = [owner('beta'), owner('zz-holder'), owner('alpha')];

        const ordered = orderOwners(owners, { brandId: 'acme', repoHolder: 'zz-holder' });

        ctx.expect(labels(ordered, owners)).toEqual(['create', 'zz-holder', 'alpha', 'beta']);
      },
    },

    // ─── One runner seam: execFn(file, args) ─────────────────────────────────────

    {
      name: '#1044 askOwner runs every gh call through the injected execFn, the program named first',
      run: async (ctx) => {
        const gh = createGh({ user: 'jane', orgs: ['acme', 'beta'] });
        const files = [];
        const execFn = (file, args, options) => {
          files.push(file);
          return gh(file, args, options);
        };
        const tty = openTtyPrompt();
        ctx.after(() => tty.close());

        const asked = askOwner({ brandId: 'acme', execFn });
        await tty.answer('beta', '\r');

        ctx.expect(await asked, 'Enter takes the best match from the injected runner\'s list').toBe('acme');
        ctx.expect(files.length > 0, 'the owners came through the injected runner').toBeTruthy();
        ctx.expect(files.every((file) => file === 'gh'), JSON.stringify(files)).toBeTruthy();
      },
    },

    {
      name: '#1044 the fake gh takes (file, args) only: called with the words alone, it throws',
      run: (ctx) => {
        const gh = createGh({ user: 'jane' });

        ctx.expect(() => gh(['api', 'user'])).toThrow(/call as \('gh', args\)/);
        ctx.expect(gh.calls, 'the wrong form answers nothing').toEqual([]);
        ctx.expect(JSON.parse(gh('gh', ['api', 'user'])).login).toBe('jane');
      },
    },

    {
      name: '#1044 no file under packages/manager/src names ghExec, claudeExec or runGh',
      run: (ctx) => {
        const src = jetpack.cwd(path.join(MANAGER, 'src'));

        const naming = src.find({ matching: '**/*' }).filter((file) => /\b(ghExec|claudeExec|runGh)\b/.test(src.read(file)));

        ctx.expect(naming).toEqual([]);
      },
    },

    {
      name: '#1044 repo.test.js uses the one fake gh and defines none of its own',
      run: (ctx) => {
        const text = jetpack.read(path.join(MANAGER, 'test', 'repo.test.js'));

        ctx.expect(text).toMatch(/require\('\.\/lib\/fake-gh\.js'\)/);
        ctx.expect(text).not.toMatch(/function\s+fakeGh\s*\(/);
        ctx.expect(text, 'no runner of its own records calls').not.toMatch(/\.calls\s*=\s*\[\]/);
      },
    },
  ],
});
