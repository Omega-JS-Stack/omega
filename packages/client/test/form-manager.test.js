/**
 * FormManager module tests (C4 cp107 — the ONE shared implementation).
 *
 * The module moved here from packages/web/core/js/libs (it always built on
 * client primitives); web/desktop/extension all import
 * `@omega.js/client/modules/form-manager.js` now. Real import under the
 * test DOM shim plus source-shape pins that keep the move honest.
 */
const { describe, it, before } = require('node:test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { assert } = require('./helpers.js');

const SRC_PATH = path.join(__dirname, '..', 'src', 'modules', 'form-manager.js');
const DIST_PATH = path.join(__dirname, '..', 'dist', 'modules', 'form-manager.js');
const SOURCE = fs.readFileSync(SRC_PATH, 'utf8');

describe('FormManager Module', () => {
  let FormManager;

  before(async () => {
    ({ FormManager } = await import(pathToFileURL(DIST_PATH)));
  });

  it('imports under the client runtime and exports the FormManager class', () => {
    assert(typeof FormManager === 'function');
    assert(FormManager.name === 'FormManager');
  });

  it('constructor fails loud when the form is missing', () => {
    try {
      new FormManager('#definitely-not-a-form');
      assert.fail('Should have thrown');
    } catch (e) {
      assert(e.message.includes('Form not found'));
    }
  });

  it('lives on client primitives only — relative imports, no self-name or web-alias refs', () => {
    assert(SOURCE.includes("from './dom.js'"), 'dom module imported relatively');
    assert(SOURCE.includes("from '../index.js'"), 'manager singleton imported relatively');
    assert(!SOURCE.includes('@omega.js/client'), 'no self-name imports (pre-publish safe)');
    assert(!SOURCE.includes('__main_assets__'), 'no web-only alias refs survived the move');
  });

  it('keeps the web-era surface: honeypot guard + unsaved-changes unload guard', () => {
    assert(SOURCE.includes('HONEYPOT_SELECTOR'));
    assert(SOURCE.includes('warnOnUnsavedChanges'));
  });

  it('ships in dist for consumers (exports map ./modules/*)', () => {
    assert(fs.existsSync(DIST_PATH), 'dist/modules/form-manager.js exists after prepare');
  });
});

describe('FormManager gates (#637)', () => {
  let FormManager;

  before(async () => {
    ({ FormManager } = await import(pathToFileURL(DIST_PATH)));
  });

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

  it('holds ready() until every gate resolves, with the submit control disabled meanwhile', () => {
    const $form = makeForm();
    const formManager = new FormManager($form, { autoReady: false });

    formManager.addGate('eligibility');
    formManager.addGate('recaptcha');
    formManager.ready();

    assert(formManager.state === 'initializing', 'a gated ready() leaves the form initializing');
    assert($form.$submit.disabled === true, 'and the submit control cannot be pressed');

    formManager.resolveGate('eligibility');
    assert(formManager.state === 'initializing', 'one answer is not both answers');
    assert($form.$submit.disabled === true);

    formManager.resolveGate('recaptcha');
    assert(formManager.state === 'ready', 'the last gate is what arms the form');
    assert($form.$submit.disabled === false, 'and the submit control arms with it');
  });

  it('resolving a gate before ready() is called still leaves the caller in charge of arming', () => {
    const $form = makeForm();
    const formManager = new FormManager($form, { autoReady: false });

    formManager.addGate('eligibility');
    formManager.resolveGate('eligibility');

    assert(formManager.state === 'initializing', 'no ready() was ever asked for');

    formManager.ready();
    assert(formManager.state === 'ready', 'and an ungated ready() arms at once');
  });

  it('resolving a gate nobody opened fails loud', () => {
    const $form = makeForm();
    const formManager = new FormManager($form, { autoReady: false });

    formManager.addGate('eligibility');

    try {
      formManager.resolveGate('recaptcha');
      assert.fail('Should have thrown');
    } catch (e) {
      assert(e.message.includes('resolveGate'), 'the error names the call that was wrong');
      assert(e.message.includes('recaptcha'), 'and the gate it could not find');
    }

    // A typo must not have armed the form behind the gate that IS open
    assert(formManager.state === 'initializing');

    formManager.resolveGate('eligibility');

    try {
      formManager.resolveGate('eligibility');
      assert.fail('Should have thrown');
    } catch (e) {
      assert(e.message.includes('resolveGate'), 'a second resolve of the same gate is the same mistake');
    }
  });

  it('a gate added after the form armed fails loud', () => {
    const $form = makeForm();
    const formManager = new FormManager($form, { autoReady: false });

    formManager.ready();

    try {
      formManager.addGate('too-late');
      assert.fail('Should have thrown');
    } catch (e) {
      assert(e.message.includes('addGate') && e.message.includes('ready'), 'the error names the call that was wrong and the state it found');
    }
  });
});

describe('FormManager teardown (wave-4 F10)', () => {
  it('ships a destroy() that leaves the shared registry, and the beforeunload handler skips disconnected forms', () => {
    assert(SOURCE.includes('destroy()'), 'destroy() method exists');
    assert(SOURCE.includes('_instances.delete(this)'), 'destroy leaves the shared instance Set');
    assert(SOURCE.includes('isConnected'), 'shared beforeunload handler skips forms no longer in the DOM');
  });
});
