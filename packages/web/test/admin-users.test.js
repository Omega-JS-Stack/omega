/**
 * The admin users page's on-demand user read (`core/js/pages/admin/users/`,
 * `fetchFullUser`) over the client's REAL Firestore wrapper
 * ([#950](https://github.com/Omega-JS-Stack/omega/issues/950)).
 *
 * The wrapper's snapshot exposes `exists()` as a FUNCTION, so a property read
 * is always truthy and a missing user used to come back as `{ id }` instead of
 * null. The page and the wrapper go through esbuild together (the harness
 * security-session-devices.test.js established); only the Firebase SDK calls
 * under the wrapper are answered in memory.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_DIR = path.join(__dirname, '..', 'core');
const USERS_PAGE = path.join(CORE_DIR, 'js', 'pages', 'admin', 'users', 'index.js');
const FIRESTORE = require.resolve('@omega.js/client/modules/firestore.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-admin-users-'));
const ENTRY = path.join(BUNDLE_DIR, 'entry.js');
const BUNDLE = path.join(BUNDLE_DIR, 'admin-users.cjs');

let building = null;

function bundleOnce() {
  fs.writeFileSync(ENTRY, [
    `export { fetchFullUser } from ${JSON.stringify(USERS_PAGE)};`,
    `export { default as Firestore } from ${JSON.stringify(FIRESTORE)};`,
    '',
  ].join('\n'));

  building ||= esbuild.build({
    entryPoints: [ENTRY],
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    plugins: [{
      name: 'harness-aliases',
      setup(build) {
        build.onResolve({ filter: /^__main_assets__\// }, (args) => {
          return { path: path.join(CORE_DIR, args.path.slice('__main_assets__/'.length)) };
        });
        build.onResolve({ filter: /^@omega\.js\/web\/runtime$/ }, () => {
          return { path: 'client', namespace: 'omega-client-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-client-stub' }, () => {
          return { contents: 'export default globalThis.__omegaClient;' };
        });
        build.onResolve({ filter: /^@omega\.js\/client\/modules\/form-manager\.js$/ }, () => {
          return { path: 'form-manager', namespace: 'omega-form-manager-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-form-manager-stub' }, () => {
          return { contents: 'export class FormManager {}' };
        });
      },
    }],
  });

  return building;
}

/** The page's fetchFullUser over the real wrapper, whose SDK answers from `docs`. */
async function makeFetch(docs) {
  await bundleOnce();

  globalThis.__omegaClient = {};
  delete require.cache[require.resolve(BUNDLE)];
  const page = require(BUNDLE);

  const firestore = new page.Firestore({});
  firestore._initialized = true;
  firestore._db = {};
  firestore._firestoreMethods = {
    doc: (_db, docPath) => ({ path: docPath }),
    getDoc: async (ref) => ({
      id: ref.path.split('/').pop(),
      exists: () => ref.path in docs,
      data: () => docs[ref.path],
    }),
  };
  globalThis.__omegaClient.firestore = firestore;

  return page.fetchFullUser;
}

test('#950: a missing user resolves to null, not a bare { id }', async () => {
  const fetchFullUser = await makeFetch({ 'users/u1': { auth: { email: 'a@x.test' } } });

  assert.strictEqual(await fetchFullUser('ghost'), null);
  assert.deepStrictEqual(await fetchFullUser('u1'), { id: 'u1', auth: { email: 'a@x.test' } }, 'a present user still reads in full');
});
