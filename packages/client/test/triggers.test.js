/**
 * triggers tests — the ONE click-trigger registry (#16): the `omega-<name>`
 * class rule, delegated dispatch through closest(), replacement-on-re-register,
 * and a click on unregistered markup costing nothing.
 *
 * The registry (`omega.triggers`, a Triggers instance) attaches its listener
 * to `document` on first registration, so the suite captures that handler by
 * swapping `document.addEventListener` BEFORE the first register() call, the
 * same seam notifications.test.js uses. The
 * DOM is the hand-rolled minimum the module touches (the shared setup.js
 * convention: Node has no DOM and the package pulls in no jsdom), and the
 * closest() here is a real parent-chain walk, not a stub of a match.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

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

module.exports = defineCases({
  type: 'group',
  description: 'triggers',
  tests: [
    ...(() => {
      const cases = [];
      let triggers;
      let click;
      let listenerCount;
      let originalAddEventListener;
      let originalWarn;
      let warnings;

      let beforeHookRun;
      const beforeHook = (ctx) => (beforeHookRun ||= Promise.resolve().then(() => (async () => {
        originalAddEventListener = global.document.addEventListener;
        listenerCount = 0;
        global.document.addEventListener = (type, handler) => {
          if (type === 'click') {
            listenerCount++;
            click = handler;
          }
        };

        const Triggers = (await import('../src/modules/triggers.js')).default;
        triggers = new Triggers();
      })()));

      const afterHook = () => {
        global.document.addEventListener = originalAddEventListener;
      };

      const beforeEachHook = () => {
        warnings = [];
        originalWarn = console.warn;
        console.warn = (...args) => warnings.push(args.join(' '));
      };

      cases.push({
        name: 'triggers > registers a handler and arms exactly one document listener',
        run: async (ctx) => {
          await beforeHook(ctx);
          beforeEachHook();
          triggers.register('demo', () => {});

          ctx.expect(typeof click, 'the delegated click handler is attached').toBe('function');
          ctx.expect(listenerCount).toBe(1);

          triggers.register('other', () => {});
          ctx.expect(listenerCount, 'a second registration reuses the ONE listener').toBe(1);

          console.warn = originalWarn;
        },
      });

      cases.push({
        name: 'triggers > dispatches to the handler for a click INSIDE the trigger element (closest)',
        run: async (ctx) => {
          await beforeHook(ctx);
          beforeEachHook();
          const calls = [];
          triggers.register('signout', (event, element) => calls.push([event, element]));

          const button = makeElement(['btn', 'omega-signout']);
          const icon = makeElement(['fa-solid', 'fa-right-from-bracket'], button);
          const event = makeClick(icon);

          click(event);

          ctx.expect(calls.length, 'the handler ran for a click on the child icon').toBe(1);
          ctx.expect(calls[0][0], 'handler gets the event').toBe(event);
          ctx.expect(calls[0][1], 'handler gets the TRIGGER element, not the click target').toBe(button);
          ctx.expect(event.prevented, 'the framework owns the click: default suppressed').toBe(true);
          ctx.expect(event.stopped, 'the framework owns the click: propagation stopped').toBe(true);

          console.warn = originalWarn;
        },
      });

      cases.push({
        name: 'triggers > answers `omega-<name>` only — an unregistered class is ignored',
        run: async (ctx) => {
          await beforeHook(ctx);
          beforeEachHook();
          let ran = 0;
          triggers.register('password-toggle', () => { ran++; });

          // The legacy name, and a bare name without the prefix: neither is a trigger.
          for (const classNames of [['uj-password-toggle'], ['password-toggle'], ['btn']]) {
            const event = makeClick(makeElement(classNames));
            click(event);
            ctx.expect(event.prevented, `${classNames.join('.')} is not a trigger`).toBe(false);
          }

          ctx.expect(ran, 'no handler ran').toBe(0);

          const event = makeClick(makeElement(['omega-password-toggle']));
          click(event);
          ctx.expect(ran, 'the omega- prefixed class does fire it').toBe(1);

          console.warn = originalWarn;
        },
      });

      cases.push({
        name: 'triggers > re-registering a name REPLACES the handler and warns (never stacks)',
        run: async (ctx) => {
          await beforeHook(ctx);
          beforeEachHook();
          const ran = [];
          triggers.register('replaceme', () => ran.push('first'));
          ctx.expect(warnings, 'a fresh name warns about nothing').toEqual([]);

          triggers.register('replaceme', () => ran.push('second'));
          ctx.expect(warnings.length, 'the replacement warns').toBe(1);
          ctx.expect(warnings[0]).toMatch(/Trigger "replaceme" re-registered/);

          click(makeClick(makeElement(['omega-replaceme'])));
          ctx.expect(ran, 'only the new handler ran').toEqual(['second']);

          console.warn = originalWarn;
        },
      });

      cases.push({
        name: 'triggers > rejects a non-function handler',
        run: async (ctx) => {
          await beforeHook(ctx);
          beforeEachHook();
          ctx.expect(() => triggers.register('bogus', 'nope')).toThrow(/needs a handler function/);

          console.warn = originalWarn;
        },
      });

      cases.push({
        name: 'triggers > a throwing handler is logged, never allowed to break the others',
        run: async (ctx) => {
          ctx.after(afterHook);
          await beforeHook(ctx);
          beforeEachHook();
          const errors = [];
          const originalError = console.error;
          console.error = (...args) => errors.push(args.join(' '));

          let sibling = 0;
          triggers.register('boom', () => { throw new Error('handler exploded'); });
          triggers.register('fine', () => { sibling++; });

          click(makeClick(makeElement(['omega-boom', 'omega-fine'])));

          console.error = originalError;
          console.warn = originalWarn;

          ctx.expect(sibling, 'the sibling trigger on the same element still ran').toBe(1);
          ctx.expect(errors.length).toBe(1);
          ctx.expect(errors[0]).toMatch(/Trigger "boom" failed/);
        },
      });
      return cases;
    })(),
  ],
});
