/**
 * triggers tests — the ONE click-trigger registry (#16): the `omega-<name>`
 * class rule, delegated dispatch through closest(), replacement-on-re-register,
 * and a click on unregistered markup costing nothing.
 *
 * The registry attaches its listener to `document` on first registration, so
 * the suite captures that handler by swapping `document.addEventListener`
 * BEFORE importing the module — the same seam notifications.test.js uses. The
 * DOM is the hand-rolled minimum the module touches (the shared setup.js
 * convention: Node has no DOM and the package pulls in no jsdom), and the
 * closest() here is a real parent-chain walk, not a stub of a match.
 */
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('assert');

// ─── The minimum DOM the module touches ───

/**
 * One element in a parent chain.
 * @param {string[]} classNames
 * @param {object|null} parentElement
 * @returns {object}
 */
function makeElement(classNames, parentElement = null) {
  const element = {
    classNames,
    parentElement,
    classList: {
      contains: (name) => classNames.includes(name),
    },
  };

  // Real walk up the chain against a `.a,.b` union selector — exactly what the
  // registry asks the browser for.
  element.closest = (selector) => {
    const wanted = selector.split(',').map((part) => part.trim().replace(/^\./, ''));
    let node = element;
    while (node) {
      if (node.classNames.some((name) => wanted.includes(name))) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  };

  return element;
}

/**
 * A click event on `target`, recording the registry's default-suppression.
 * @param {object} target
 * @returns {object}
 */
function makeClick(target) {
  return {
    target,
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
  };
}

describe('triggers', () => {
  let registerTrigger;
  let click;
  let listenerCount;
  let originalAddEventListener;
  let originalWarn;
  let warnings;

  before(async () => {
    originalAddEventListener = global.document.addEventListener;
    listenerCount = 0;
    global.document.addEventListener = (type, handler) => {
      if (type === 'click') {
        listenerCount++;
        click = handler;
      }
    };

    ({ registerTrigger } = await import('../src/modules/triggers.js'));
  });

  after(() => {
    global.document.addEventListener = originalAddEventListener;
  });

  beforeEach(() => {
    warnings = [];
    originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
  });

  it('registers a handler and arms exactly one document listener', () => {
    registerTrigger('demo', () => {});

    assert.strictEqual(typeof click, 'function', 'the delegated click handler is attached');
    assert.strictEqual(listenerCount, 1);

    registerTrigger('other', () => {});
    assert.strictEqual(listenerCount, 1, 'a second registration reuses the ONE listener');

    console.warn = originalWarn;
  });

  it('dispatches to the handler for a click INSIDE the trigger element (closest)', () => {
    const calls = [];
    registerTrigger('signout', (event, element) => calls.push([event, element]));

    const button = makeElement(['btn', 'omega-signout']);
    const icon = makeElement(['fa-solid', 'fa-right-from-bracket'], button);
    const event = makeClick(icon);

    click(event);

    assert.strictEqual(calls.length, 1, 'the handler ran for a click on the child icon');
    assert.strictEqual(calls[0][0], event, 'handler gets the event');
    assert.strictEqual(calls[0][1], button, 'handler gets the TRIGGER element, not the click target');
    assert.strictEqual(event.prevented, true, 'the framework owns the click: default suppressed');
    assert.strictEqual(event.stopped, true, 'the framework owns the click: propagation stopped');

    console.warn = originalWarn;
  });

  it('answers `omega-<name>` only — an unregistered class is ignored', () => {
    let ran = 0;
    registerTrigger('password-toggle', () => { ran++; });

    // The legacy name, and a bare name without the prefix: neither is a trigger.
    for (const classNames of [['uj-password-toggle'], ['password-toggle'], ['btn']]) {
      const event = makeClick(makeElement(classNames));
      click(event);
      assert.strictEqual(event.prevented, false, `${classNames.join('.')} is not a trigger`);
    }

    assert.strictEqual(ran, 0, 'no handler ran');

    const event = makeClick(makeElement(['omega-password-toggle']));
    click(event);
    assert.strictEqual(ran, 1, 'the omega- prefixed class does fire it');

    console.warn = originalWarn;
  });

  it('re-registering a name REPLACES the handler and warns (never stacks)', () => {
    const ran = [];
    registerTrigger('replaceme', () => ran.push('first'));
    assert.deepStrictEqual(warnings, [], 'a fresh name warns about nothing');

    registerTrigger('replaceme', () => ran.push('second'));
    assert.strictEqual(warnings.length, 1, 'the replacement warns');
    assert.match(warnings[0], /Trigger "replaceme" re-registered/);

    click(makeClick(makeElement(['omega-replaceme'])));
    assert.deepStrictEqual(ran, ['second'], 'only the new handler ran');

    console.warn = originalWarn;
  });

  it('rejects a non-function handler', () => {
    assert.throws(() => registerTrigger('bogus', 'nope'), /needs a handler function/);

    console.warn = originalWarn;
  });

  it('a throwing handler is logged, never allowed to break the others', () => {
    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args.join(' '));

    let sibling = 0;
    registerTrigger('boom', () => { throw new Error('handler exploded'); });
    registerTrigger('fine', () => { sibling++; });

    click(makeClick(makeElement(['omega-boom', 'omega-fine'])));

    console.error = originalError;
    console.warn = originalWarn;

    assert.strictEqual(sibling, 1, 'the sibling trigger on the same element still ran');
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /Trigger "boom" failed/);
  });
});
