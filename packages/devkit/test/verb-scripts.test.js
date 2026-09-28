/**
 * The target scripts a framework scaffolds, derived from the one verb table:
 * every fan-out verb the framework owns is `"<verb>": "omega <verb>"`, and
 * the framework's declared projectScripts merge over that set.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { VERBS } = require('../src/verbs.js');
const { verbScripts, projectScripts } = require('../src/verb-scripts.js');

const FRAMEWORKS = ['@omega.js/web', '@omega.js/backend', '@omega.js/desktop', '@omega.js/extension'];

test('verbScripts: every fan-out (`each`) row a framework owns, as its bare `omega <verb>`', () => {
  for (const framework of FRAMEWORKS) {
    const expected = VERBS
      .filter((row) => row.owners.includes(framework) && row.fanout === 'each')
      .map((row) => row.name);
    const scripts = verbScripts(framework);

    assert.deepEqual(Object.keys(scripts), expected, framework);
    for (const [verb, command] of Object.entries(scripts)) assert.equal(command, `omega ${verb}`);
  }
});

test('verbScripts: a brand-wide or root-run verb is never a target script', () => {
  const web = verbScripts('@omega.js/web');
  for (const verb of ['install', 'manage', 'migrate', 'dev', 'help', 'version']) {
    assert.equal(web[verb], undefined, verb);
  }
  assert.deepEqual(['build', 'clean', 'deploy', 'test', 'translate'].map((verb) => web[verb]),
    ['omega build', 'omega clean', 'omega deploy', 'omega test', 'omega translate']);
  assert.equal(verbScripts('@omega.js/extension').package, undefined, 'a verb another framework owns never lands');
});

test('verbScripts: a single-target command (`fanout: none`) is never a target script', () => {
  const desktop = verbScripts('@omega.js/desktop');
  const backend = verbScripts('@omega.js/backend');
  for (const verb of ['runner', 'sign-windows', 'logs', 'launch', 'publish']) assert.equal(desktop[verb], undefined, verb);
  for (const verb of ['cwd', 'logs', 'emulator', 'serve', 'firestore:get']) assert.equal(backend[verb], undefined, verb);
});

test('projectScripts: the framework\'s declared scripts merge over the derived set', () => {
  const scripts = projectScripts({ name: '@omega.js/web', projectScripts: { start: 'omega dev', test: 'node --test' } });

  assert.equal(scripts.start, 'omega dev', 'a declared non-verb script lands');
  assert.equal(scripts.test, 'node --test', 'a declared script wins over the derived one');
  assert.equal(scripts.build, 'omega build', 'the derived set fills the rest');
  assert.deepEqual(projectScripts({ name: '@omega.js/web' }), verbScripts('@omega.js/web'), 'no declarations, the derived set alone');
});
