/**
 * FormManager module tests (C4 cp107 — the ONE shared implementation).
 *
 * The module moved here from packages/web/core/js/libs (it always built on
 * client primitives); web/desktop/extension all import
 * `@omega.js/client/modules/form-manager.js` now. Real import under the
 * test DOM shim plus source-shape pins that keep the move honest.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { getOmega, createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

const SRC_PATH = path.join(__dirname, '..', 'src', 'modules', 'form-manager.js');
const DIST_PATH = path.join(__dirname, '..', 'dist', 'modules', 'form-manager.js');
const SOURCE = fs.readFileSync(SRC_PATH, 'utf8');

module.exports = defineCases({
  type: 'group',
  description: 'form-manager',
  setup: createOmega,
  cleanup: disposeOmega,
  tests: [
    ...(() => {
      const cases = [];
      let FormManager;

      let beforeHookRun;
      const beforeHook = (ctx) => (beforeHookRun ||= Promise.resolve().then(() => (async () => {
        ({ FormManager } = await import(pathToFileURL(DIST_PATH)));
      })()));

      cases.push({
        name: 'FormManager Module > imports under the client runtime and exports the FormManager class',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          ctx.expect(typeof FormManager === 'function').toBeTruthy();
          ctx.expect(FormManager.name === 'FormManager').toBeTruthy();
        },
      });

      cases.push({
        name: 'FormManager Module > constructor fails loud when the form is missing',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          try {
            new FormManager(getOmega(), '#definitely-not-a-form');
            ctx.expect.fail('Should have thrown');
          } catch (e) {
            ctx.expect(e.message.includes('Form not found')).toBeTruthy();
          }
        },
      });

      cases.push({
        name: 'FormManager Module > lives on client primitives only — relative imports, no self-name or web-alias refs',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          ctx.expect(SOURCE.includes("from './dom.js'"), 'dom module imported relatively').toBeTruthy();
          ctx.expect(!SOURCE.includes("from '../index.js'"), 'no instance imported: the form receives omega when built').toBeTruthy();
          ctx.expect(!SOURCE.includes('@omega.js/client'), 'no self-name imports (pre-publish safe)').toBeTruthy();
          ctx.expect(!SOURCE.includes('__main_assets__'), 'no web-only alias refs survived the move').toBeTruthy();
        },
      });

      cases.push({
        name: 'FormManager Module > keeps the web-era surface: honeypot guard + unsaved-changes unload guard',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          ctx.expect(SOURCE.includes('HONEYPOT_SELECTOR')).toBeTruthy();
          ctx.expect(SOURCE.includes('warnOnUnsavedChanges')).toBeTruthy();
        },
      });

      cases.push({
        name: 'FormManager Module > ships in dist for consumers (exports map ./modules/*)',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          ctx.expect(fs.existsSync(DIST_PATH), 'dist/modules/form-manager.js exists after prepare').toBeTruthy();
        },
      });
      return cases;
    })(),

    ...(() => {
      const cases = [];
      let FormManager;

      let beforeHook2Run;
      const beforeHook2 = (ctx) => (beforeHook2Run ||= Promise.resolve().then(() => (async () => {
        ({ FormManager } = await import(pathToFileURL(DIST_PATH)));
      })()));

      // The client suite's DOM shim has no parser, so the form is hand-built: the
      // only surface FormManager touches on it is attributes, listeners and the two
      // querySelector forms. A submit button is what a gate actually guards.
      function makeForm() {
        const attributes = {};
        const $submit = {
          type: 'submit',
          name: '',
          disabled: false,
          matches: () => false,
          addEventListener: () => {},
        };

        const $form = {
          $submit,
          isConnected: true,
          setAttribute: (name, value) => { attributes[name] = String(value); },
          getAttribute: (name) => attributes[name] ?? null,
          addEventListener: () => {},
          querySelector: () => null,
          querySelectorAll: (selector) => (selector.includes('button') ? [$submit] : []),
        };

        return $form;
      }

      cases.push({
        name: 'FormManager gates (#637) > holds ready() until every gate resolves, with the submit control disabled meanwhile',
        run: async (ctx) => {
          await beforeHook2(ctx);
          await beforeEachHook();
          const $form = makeForm();
          const formManager = new FormManager(getOmega(), $form, { autoReady: false });

          formManager.addGate('eligibility');
          formManager.addGate('recaptcha');
          formManager.ready();

          ctx.expect(formManager.state === 'initializing', 'a gated ready() leaves the form initializing').toBeTruthy();
          ctx.expect($form.$submit.disabled === true, 'and the submit control cannot be pressed').toBeTruthy();

          formManager.resolveGate('eligibility');
          ctx.expect(formManager.state === 'initializing', 'one answer is not both answers').toBeTruthy();
          ctx.expect($form.$submit.disabled === true).toBeTruthy();

          formManager.resolveGate('recaptcha');
          ctx.expect(formManager.state === 'ready', 'the last gate is what arms the form').toBeTruthy();
          ctx.expect($form.$submit.disabled === false, 'and the submit control arms with it').toBeTruthy();
        },
      });

      cases.push({
        name: 'FormManager gates (#637) > resolving a gate before ready() is called still leaves the caller in charge of arming',
        run: async (ctx) => {
          await beforeHook2(ctx);
          await beforeEachHook();
          const $form = makeForm();
          const formManager = new FormManager(getOmega(), $form, { autoReady: false });

          formManager.addGate('eligibility');
          formManager.resolveGate('eligibility');

          ctx.expect(formManager.state === 'initializing', 'no ready() was ever asked for').toBeTruthy();

          formManager.ready();
          ctx.expect(formManager.state === 'ready', 'and an ungated ready() arms at once').toBeTruthy();
        },
      });

      cases.push({
        name: 'FormManager gates (#637) > resolving a gate nobody opened fails loud',
        run: async (ctx) => {
          await beforeHook2(ctx);
          await beforeEachHook();
          const $form = makeForm();
          const formManager = new FormManager(getOmega(), $form, { autoReady: false });

          formManager.addGate('eligibility');

          try {
            formManager.resolveGate('recaptcha');
            ctx.expect.fail('Should have thrown');
          } catch (e) {
            ctx.expect(e.message.includes('resolveGate'), 'the error names the call that was wrong').toBeTruthy();
            ctx.expect(e.message.includes('recaptcha'), 'and the gate it could not find').toBeTruthy();
          }

          // A typo must not have armed the form behind the gate that IS open
          ctx.expect(formManager.state === 'initializing').toBeTruthy();

          formManager.resolveGate('eligibility');

          try {
            formManager.resolveGate('eligibility');
            ctx.expect.fail('Should have thrown');
          } catch (e) {
            ctx.expect(e.message.includes('resolveGate'), 'a second resolve of the same gate is the same mistake').toBeTruthy();
          }
        },
      });

      cases.push({
        name: 'FormManager gates (#637) > a gate added after the form armed fails loud',
        run: async (ctx) => {
          await beforeHook2(ctx);
          await beforeEachHook();
          const $form = makeForm();
          const formManager = new FormManager(getOmega(), $form, { autoReady: false });

          formManager.ready();

          try {
            formManager.addGate('too-late');
            ctx.expect.fail('Should have thrown');
          } catch (e) {
            ctx.expect(e.message.includes('addGate') && e.message.includes('ready'), 'the error names the call that was wrong and the state it found').toBeTruthy();
          }
        },
      });
      return cases;
    })(),

    {
      name: 'FormManager teardown (wave-4 F10) > ships a destroy() that leaves the shared registry, and the beforeunload handler skips disconnected forms',
      run: async (ctx) => {
        await beforeEachHook();
        ctx.expect(SOURCE.includes('destroy()'), 'destroy() method exists').toBeTruthy();
        ctx.expect(SOURCE.includes('_instances.delete(this)'), 'destroy leaves the shared instance Set').toBeTruthy();
        ctx.expect(SOURCE.includes('isConnected'), 'shared beforeunload handler skips forms no longer in the DOM').toBeTruthy();
      },
    },
  ],
});
