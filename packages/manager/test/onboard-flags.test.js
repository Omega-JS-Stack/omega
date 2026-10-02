/**
 * The answers onboarding takes as flags with no terminal: `--company` names the
 * company brand and `--admins` the account list, typed on the command line and
 * read back from the written brand config.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Before the source loads: no real npm install, dev stack or GitHub call
const { folder, readConfig, pluginInstalled, quietly } = require('./lib/onboard-seams.js');
require('@omega.js/devkit/test/temp-home');
const { recordBrand } = require('@omega.js/config');
const { parseArgv } = require('@omega.js/devkit/argv');

const Main = require('../src/cli.js');

pluginInstalled();

/** A company brand on this machine, recorded in the registry so a child's `company` resolves. */
function companyBrand(id) {
  const root = folder(id);
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `{
    brand: { id: '${id}', name: 'Acme Co', url: 'https://acme-co.test' },
    company: { id: 'self' },
  }`);
  recordBrand({ id, root, name: 'Acme Co', url: 'https://acme-co.test' });
}

/** Run `omega <args>` through the manager's CLI in `cwd`, the console captured. */
async function omega(cwd, args) {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await quietly(() => new Main({}).process(parseArgv(args)));
  } finally {
    process.chdir(previous);
  }
}

test('#1031 case 11: --company and --admins with no terminal write that company and those account admins', async () => {
  companyBrand('acme-co');
  const root = folder('acme');

  await omega(root, [
    'onboard', '--id=acme', '--name=Acme', '--url=https://acme.test', '--targets=web', '--contactName=Jane Doe',
    '--company=acme-co', '--admins=a@x.com,b@x.com', '--no-manage', '--no-dev',
  ]);

  const config = readConfig(root);
  assert.deepEqual(config.company, { id: 'acme-co' });
  assert.deepEqual(config.account.admins.map((admin) => admin.email), ['a@x.com', 'b@x.com']);
});
