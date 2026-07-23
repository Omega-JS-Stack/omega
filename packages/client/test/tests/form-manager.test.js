/**
 * FormManager module tests (C4 cp107 — the ONE shared implementation).
 *
 * The module moved here from packages/web/core/js/libs (it always built on
 * client primitives); web/desktop/extension all import
 * `@omega.js/client/modules/form-manager.js` now. Real import under the
 * test DOM shim plus source-shape pins that keep the move honest.
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { assert } = require('../helpers.js');

const SRC_PATH = path.join(__dirname, '..', '..', 'src', 'modules', 'form-manager.js');
const DIST_PATH = path.join(__dirname, '..', '..', 'dist', 'modules', 'form-manager.js');
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

describe('FormManager teardown (wave-4 F10)', () => {
  it('ships a destroy() that leaves the shared registry, and the beforeunload handler skips disconnected forms', () => {
    assert(SOURCE.includes('destroy()'), 'destroy() method exists');
    assert(SOURCE.includes('_instances.delete(this)'), 'destroy leaves the shared instance Set');
    assert(SOURCE.includes('isConnected'), 'shared beforeunload handler skips forms no longer in the DOM');
  });
});
