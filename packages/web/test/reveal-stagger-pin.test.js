/**
 * ONE reveal stagger. The motion engine and head.html's inline first-paint
 * starter both hand a `[data-omega-reveal-stagger]` parent's reveals their
 * `--omega-reveal-delay`, and a drifted copy animates a band at the wrong
 * rhythm. The starter cannot import the module, so the build templates the
 * module's own source into it: these cases hold the rendered starter and the
 * module to one rule, and the head to carrying no hand-written copy.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const { buildWith, miniData, PKG } = require('./lib/build.js');
const { applyStagger } = require('@omega.js/client/modules/reveal-stagger.js');

const HEAD = path.join(PKG, 'core', '_includes', 'core', 'head.html');
const MOTION = path.join(PKG, '..', 'client', 'src', 'modules', 'motion.js');

/**
 * An element carrying just the surface the stagger and the starter touch.
 * @param {object} [queries] - selector → elements, answered by querySelectorAll
 * @returns {object}
 */
function fakeElement(queries = {}) {
  const attributes = new Map();
  const props = {};
  return {
    nodeType: 1,
    props,
    style: { setProperty: (name, value) => { props[name] = value; } },
    getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null),
    setAttribute: (name, value) => attributes.set(name, String(value)),
    hasAttribute: (name) => attributes.has(name),
    matches: () => false,
    closest: () => null,
    querySelectorAll: (selector) => queries[selector] || [],
  };
}

/**
 * A stagger parent with `count` reveal children.
 * @param {string} step - the authored data-omega-reveal-stagger value
 * @param {number} count - how many reveals it holds
 * @returns {{ parent: object, children: object[] }}
 */
function staggerParent(step, count) {
  const children = Array.from({ length: count }, () => fakeElement());
  const parent = fakeElement({ '[data-omega-reveal]': children });
  parent.setAttribute('data-omega-reveal-stagger', step);
  return { parent, children };
}

/**
 * Run the rendered inline starter over one first-paint band holding one
 * stagger parent, the way the parser hands it over, and return the delays.
 * @param {string} starter - the rendered script body
 * @param {string} step - the authored stagger value
 * @returns {string[]} each reveal's --omega-reveal-delay, in document order
 */
function runStarter(starter, step) {
  const { parent, children } = staggerParent(step, 3);
  const band = fakeElement();
  band.querySelectorAll = (selector) => (selector === '[data-omega-reveal-stagger]' ? [parent] : children);
  children.forEach((child) => { child.closest = () => band; });

  const frames = [];
  let onMutate = null;
  vm.runInNewContext(starter, {
    document: { documentElement: {}, addEventListener: () => {} },
    MutationObserver: class {
      constructor(callback) { onMutate = callback; }
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: (callback) => frames.push(callback),
  });

  onMutate([{ addedNodes: [band] }]);
  while (frames.length) frames.shift()();

  assert.ok(children.every((child) => child.getAttribute('data-omega-inview') === 'true'),
    'the starter stamped every reveal it collected');
  return children.map((child) => child.props['--omega-reveal-delay']);
}

test('the rendered starter carries the motion module\'s stagger, and the head no copy of it', async () => {
  const pages = await buildWith(miniData, {}, 'reveal-stagger-pin');
  const home = pages.get('/');
  assert.ok(home, 'the fixture home page builds');

  const head = home.slice(0, home.indexOf('</head>'));
  const starter = [...head.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .find((body) => body.includes('data-omega-first-paint'));
  assert.ok(starter, 'the head renders the inline first-paint starter');

  assert.ok(starter.includes(String(applyStagger)),
    'the starter runs the module\'s applyStagger, templated in from its own source');

  const source = fs.readFileSync(HEAD, 'utf8');
  assert.ok(!source.includes('--omega-reveal-delay'),
    'head.html writes no delay formula of its own: the module is the one home');
  assert.ok(!/\|\|\s*60\b/.test(source), 'head.html writes no default step of its own');

  const motion = fs.readFileSync(MOTION, 'utf8');
  assert.match(motion, /import \{ applyStagger \} from '\.\/reveal-stagger\.js';/,
    'the motion engine imports the same applyStagger');
  assert.ok(!motion.includes('--omega-reveal-delay'), 'and writes no delay formula of its own');

  // Both runtimes write the same delays: 60ms a step by default, the authored
  // step otherwise. Hard-coded on purpose, so a default moved anywhere fails.
  assert.deepStrictEqual(runStarter(starter, ''), ['0ms', '60ms', '120ms'],
    'the rendered starter staggers 60ms a step when the parent names none');
  assert.deepStrictEqual(runStarter(starter, '40'), ['0ms', '40ms', '80ms'],
    'and the authored step when it names one');

  for (const [step, expected] of [['', ['0ms', '60ms', '120ms']], ['40', ['0ms', '40ms', '80ms']]]) {
    const { parent, children } = staggerParent(step, 3);
    applyStagger(parent);
    assert.deepStrictEqual(children.map((child) => child.props['--omega-reveal-delay']), expected,
      `the engine's applyStagger writes the same delays (step "${step}")`);
  }
});
