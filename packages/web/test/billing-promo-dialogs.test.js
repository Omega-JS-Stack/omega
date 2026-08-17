/**
 * The cancel flow's two dialogs, in the EXIT POPUP's treatment
 * ([#323](https://github.com/Omega-JS-Stack/omega/issues/323)), and the billing
 * card's applied-discount indicator
 * ([#325](https://github.com/Omega-JS-Stack/omega/issues/325)).
 *
 * Ian's QA (2026-08-17): the save offer worked and read like a form letter —
 * a title bar, two paragraphs of reassurance, two equally weighted buttons. A
 * pitch that wordy is a pitch nobody reads. Both it and the trial warning it is
 * mutually exclusive with (#267's surface) now open the way the exit popup
 * does: centered, one mark, one headline, one line, one obvious way forward and
 * a quiet way out.
 *
 * The same QA found the other half: accepting the offer applied a real discount
 * and the card said nothing about it at all. The indicator is the card's answer
 * — what comes off, and which bills it comes off, in words.
 *
 * What this suite pins is the SURFACE: the built markup (the treatment, the
 * bindings, the copy rules) and the mark's css, which lives in the CORE
 * component sheet so every theme inherits it. The behavior behind these
 * dialogs is billing-winback-offer.test.js and billing-cancel-trial-warning.test.js.
 */
const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');
const sass = require('sass');

const { layeredFileImporter, sectionsImporter } = require('../src/assets.js');
const { buildWith, miniData, PKG } = require('./lib/build.js');

const COMPONENTS_SHEET = path.join(PKG, 'core', 'css', 'components', '_index.scss');
const THEMING = path.join(__dirname, 'fixtures', 'theming');

let building = null;

// ONE build for the whole file — every assertion below reads the same page.
function accountPage() {
  building ||= buildWith(miniData, {}, 'billing-promo-dialogs-test').then((pages) => {
    const page = pages.get('/dashboard/account');
    assert.ok(page, 'account page built');
    return page;
  });

  return building;
}

// A dialog's markup, sliced by the ids the JS reaches for.
function dialogAt(page, id, endsBefore) {
  const from = page.indexOf(`id="${id}"`);
  assert.ok(from > 0, `${id} is on the page`);

  const to = page.indexOf(`id="${endsBefore}"`);
  assert.ok(to > from, `${id} sits before ${endsBefore}`);

  return page.slice(from, to);
}

test('#323: the save offer opens like the exit popup, not like a form letter', async () => {
  const page = await accountPage();
  const modal = dialogAt(page, 'cancel-winback-modal', 'cancel-trial-warning-modal');

  assert.match(modal, /modal-dialog modal-dialog-centered/, 'centered on screen');
  assert.ok(!modal.includes('modal-header'), 'no title bar — the dialog leads with its mark');
  assert.ok(!modal.includes('modal-footer'), 'and no footer rail of equal buttons');

  assert.match(modal, /class="omega-dialog-mark"/, 'the accent mark carries the icon');
  assert.match(modal, /data-icon="gift"/, 'and the icon is the offer it makes, inlined at build');
  assert.match(modal, /text-center/, 'the whole block is centered');

  // The headline is the OFFER, in the brand's own number — bound from the same
  // state the gate reads, never spelled out here.
  assert.match(
    modal,
    /<h5[^>]*id="cancel-winback-title"[^>]*data-omega-bind="@text billing\.winbackOffer\.headline"/,
    'the headline is the bound offer line',
  );
  assert.ok(!/\d+% off/.test(modal), 'no discount number is hardcoded in the markup');

  // One way forward, one quiet way out — the exit popup's own button pairing.
  assert.match(modal, /id="cancel-winback-accept-btn"[\s\S]*?class="button-text"/, 'the accept button keeps the label the JS swaps while applying');
  assert.match(modal, /btn btn-adaptive btn-lg/, 'the accept is the loud button');
  assert.match(modal, /id="cancel-winback-decline-btn"/, 'the decline is still there');
  assert.match(modal.slice(modal.indexOf('id="cancel-winback-decline-btn"') - 200), /btn btn-link/, 'and it is the quiet one');
});

test('#323: the trial warning wears the same treatment', async () => {
  const page = await accountPage();
  const modal = dialogAt(page, 'cancel-trial-warning-modal', 'change-plan-modal');

  assert.match(modal, /modal-dialog modal-dialog-centered/, 'centered on screen');
  assert.ok(!modal.includes('modal-header'), 'no title bar');
  assert.ok(!modal.includes('modal-footer'), 'no footer rail');

  assert.match(modal, /class="omega-dialog-mark omega-dialog-mark--danger"/, 'the mark warns rather than offers');

  // The consequence IS the headline now: one line, and the date line under it.
  const headline = modal.match(/<h5[^>]*id="cancel-trial-warning-title"[^>]*>([\s\S]*?)<\/h5>/);
  assert.ok(headline, 'the dialog has a headline');
  assert.match(headline[1], /immediately/i, 'which states the consequence');

  assert.ok(
    modal.includes('data-omega-bind="@text billing.cancelWarning.trialEndDate"'),
    'the date the trial would otherwise run to is still bound from state',
  );
  assert.match(modal, /id="cancel-trial-keep-btn"/, 'keeping the trial is the loud button');
  assert.match(modal.slice(0, modal.indexOf('id="cancel-trial-continue-btn"')), /btn btn-adaptive btn-lg/, 'and it comes first');
  assert.match(modal.slice(modal.indexOf('id="cancel-trial-continue-btn"') - 200), /btn btn-link/, 'cancelling anyway is the quiet one');
});

test('#323: both dialogs hold the copy rules', async () => {
  const page = await accountPage();
  const dialogs = {
    'the save offer': dialogAt(page, 'cancel-winback-modal', 'cancel-trial-warning-modal'),
    'the trial warning': dialogAt(page, 'cancel-trial-warning-modal', 'change-plan-modal'),
  };

  for (const [what, modal] of Object.entries(dialogs)) {
    // The rule is about COPY — the authoring comments the template carries are
    // never rendered, so they are stripped before the read.
    assert.ok(!modal.replace(/<!--[\s\S]*?-->/g, '').includes('—'), `${what}: no em dashes in product copy`);
  }

  // A brand name is NEVER written into framework copy: the offer's supporting
  // line reads the config, so every brand's dialog says its own name.
  assert.match(dialogs['the save offer'], /Give MiniCo another shot/, 'the offer names the brand from config');
});

test('#325: the card carries the applied-discount indicator, bound and hidden by default', async () => {
  const page = await accountPage();
  const at = page.indexOf('id="billing-discount"');
  assert.ok(at > 0, 'the indicator is on the card');

  const indicator = page.slice(at, page.indexOf('</div>', page.indexOf('billing.discount.when')));

  assert.match(page.slice(at - 200, at + 400), /data-omega-bind="@show billing\.discount\.show"/, 'it shows only when there is a discount');
  assert.match(page.slice(at, at + 400), /hidden/, 'and a page whose JS never runs shows nothing at all');

  // Real TEXT, both halves — a saving announced by a colored pill alone is not
  // announced at all.
  assert.match(indicator, /data-omega-bind="@text billing\.discount\.label"/, 'what comes off');
  assert.match(indicator, /data-omega-bind="@text billing\.discount\.when"/, 'and which bills it comes off');
  assert.ok(!/\d+% off/.test(indicator), 'no discount number is hardcoded in the markup');
});

test('#323: the dialog mark is CORE vocabulary, painted only through tokens', () => {
  const warnings = [];
  const css = sass.compile(COMPONENTS_SHEET, {
    logger: { warn: (message) => warnings.push(message), debug: () => {} },
  }).css;

  assert.deepEqual(warnings, [], 'new core css never warns — the #16 bar');

  const mark = css.match(/\.omega-dialog-mark \{[^}]*\}/);
  assert.ok(mark, 'the structural rule lives in the shared sheet, so every skin inherits it');
  assert.match(mark[0], /border-radius: 50%/, 'a disc');
  assert.match(mark[0], /color: var\(--omega-accent\)/, 'ink from the token contract');
  assert.match(mark[0], /background: var\(--omega-accent-subtle\)/, 'and the accent tint behind it');

  const danger = css.match(/\.omega-dialog-mark--danger \{[^}]*\}/);
  assert.ok(danger, 'the warning variant rides along');
  assert.match(danger[0], /var\(--omega-danger\)/, 'in the ONE danger hue');
});

test('#323: a theme that inherits neither classy lane still gets the mark', () => {
  // Same proof the chip takes (#242): the floorless fixture is a full sibling
  // theme with its own Bootstrap and none of classy's floor partials. Both
  // dialogs are BASE-layer markup, so the mark has to reach that theme too.
  const themeRoot = path.join(THEMING, 'floorless-theme');
  const layers = [themeRoot, path.join(PKG, 'themes', 'base'), path.join(PKG, 'core')];
  const css = sass.compile(path.join(PKG, 'core', 'css', 'main.scss'), {
    importers: [layeredFileImporter(layers), sectionsImporter([])],
    loadPaths: layers,
    quietDeps: true,
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
    logger: { warn: () => {}, debug: () => {} },
  }).css;

  const definitions = [...css.matchAll(/(?:^|\n)\.omega-dialog-mark \{[^}]*\}/g)];
  assert.strictEqual(definitions.length, 1, 'exactly ONE structural definition in the bundle');
});
