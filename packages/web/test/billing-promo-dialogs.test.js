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
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const expect = require('@omega.js/devkit/test/expect');
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
    expect(page, 'account page built').toBeTruthy();
    return page;
  });

  return building;
}

// A dialog's markup, sliced by the ids the JS reaches for.
function dialogAt(page, id, endsBefore) {
  const from = page.indexOf(`id="${id}"`);
  expect(from > 0, `${id} is on the page`).toBeTruthy();

  const to = page.indexOf(`id="${endsBefore}"`);
  expect(to > from, `${id} sits before ${endsBefore}`).toBeTruthy();

  return page.slice(from, to);
}

module.exports = defineCases({
  type: 'group',
  description: 'billing-promo-dialogs',
  tests: [
    {
      name: '#323: the save offer opens like the exit popup, not like a form letter',
      run: async (ctx) => {
        const page = await accountPage();
        const modal = dialogAt(page, 'cancel-winback-modal', 'cancel-trial-warning-modal');

        ctx.expect(modal, 'centered on screen').toMatch(/modal-dialog modal-dialog-centered/);
        ctx.expect(!modal.includes('modal-header'), 'no title bar — the dialog leads with its mark').toBeTruthy();
        ctx.expect(!modal.includes('modal-footer'), 'and no footer rail of equal buttons').toBeTruthy();

        ctx.expect(modal, 'the accent mark carries the icon').toMatch(/class="omega-dialog-mark"/);
        ctx.expect(modal, 'and the icon is the offer it makes, inlined at build').toMatch(/data-omega-fa="solid\/gift"><svg/);
        ctx.expect(modal, 'the whole block is centered').toMatch(/text-center/);

        // The headline is the OFFER, in the brand's own number — bound from the same
        // state the gate reads, never spelled out here.
        ctx.expect(modal, 'the headline is the bound offer line').toMatch(/<h5[^>]*id="cancel-winback-title"[^>]*data-omega-bind="@text billing\.winbackOffer\.headline"/);
        ctx.expect(!/\d+% off/.test(modal), 'no discount number is hardcoded in the markup').toBeTruthy();

        // One way forward, one quiet way out — the exit popup's own button pairing.
        ctx.expect(modal, 'the accept button keeps the label the JS swaps while applying').toMatch(/id="cancel-winback-accept-btn"[\s\S]*?class="button-text"/);
        ctx.expect(modal, 'the accept is the loud button').toMatch(/btn btn-adaptive btn-lg/);
        ctx.expect(modal, 'the decline is still there').toMatch(/id="cancel-winback-decline-btn"/);
        ctx.expect(modal.slice(modal.indexOf('id="cancel-winback-decline-btn"') - 200), 'and it is the quiet one').toMatch(/btn btn-link/);
      },
    },

    {
      name: '#323: the trial warning wears the same treatment',
      run: async (ctx) => {
        const page = await accountPage();
        const modal = dialogAt(page, 'cancel-trial-warning-modal', 'cancel-retention-modal');

        ctx.expect(modal, 'centered on screen').toMatch(/modal-dialog modal-dialog-centered/);
        ctx.expect(!modal.includes('modal-header'), 'no title bar').toBeTruthy();
        ctx.expect(!modal.includes('modal-footer'), 'no footer rail').toBeTruthy();

        ctx.expect(modal, 'the mark warns rather than offers').toMatch(/class="omega-dialog-mark omega-dialog-mark--danger"/);

        // The headline asks; the line under it states the consequence by the bound date.
        const headline = modal.match(/<h5[^>]*id="cancel-trial-warning-title"[^>]*>([\s\S]*?)<\/h5>/);
        ctx.expect(headline, 'the dialog has a headline').toBeTruthy();
        ctx.expect(modal, 'the consequence is stated in the dialog').toMatch(/immediately/i);

        ctx.expect(modal.includes('data-omega-bind="@text billing.cancelWarning.trialEndDate"'), 'the date the trial would otherwise run to is still bound from state').toBeTruthy();
        ctx.expect(modal, 'keeping the trial is the loud button').toMatch(/id="cancel-trial-keep-btn"/);
        ctx.expect(modal.slice(0, modal.indexOf('id="cancel-trial-continue-btn"')), 'and it comes first').toMatch(/btn btn-adaptive btn-lg/);
        ctx.expect(modal.slice(modal.indexOf('id="cancel-trial-continue-btn"') - 200), 'cancelling anyway is the quiet one').toMatch(/btn btn-link/);
      },
    },

    {
      name: '#341: the retention warning is the third of the family, not a fourth treatment',
      run: async (ctx) => {
        const page = await accountPage();
        const modal = dialogAt(page, 'cancel-retention-modal', 'change-plan-modal');

        ctx.expect(modal, 'centered on screen').toMatch(/modal-dialog modal-dialog-centered/);
        ctx.expect(!modal.includes('modal-header'), 'no title bar').toBeTruthy();
        ctx.expect(!modal.includes('modal-footer'), 'no footer rail').toBeTruthy();

        ctx.expect(modal, 'the mark warns, exactly as the trial warning\'s does').toMatch(/class="omega-dialog-mark omega-dialog-mark--danger"/);

        // What leaving MIGHT cost, and never a promise the brand has not made: the
        // copy says data may be removed, never that it will be.
        const headline = modal.match(/<h5[^>]*id="cancel-retention-title"[^>]*>([\s\S]*?)<\/h5>/);
        ctx.expect(headline, 'the dialog has a headline').toBeTruthy();
        ctx.expect(headline[1], 'which names the choice being made').toMatch(/cancel/i);
        ctx.expect(modal, 'and the body states the consequence as a possibility').toMatch(/may be removed/);
        ctx.expect(!/will be (?:removed|deleted)/i.test(modal), 'no promise of deletion the retention policy has not made').toBeTruthy();

        ctx.expect(modal, 'keeping the account is the loud button').toMatch(/id="cancel-retention-keep-btn"/);
        ctx.expect(modal.slice(0, modal.indexOf('id="cancel-retention-continue-btn"')), 'and it comes first').toMatch(/btn btn-adaptive btn-lg/);
        ctx.expect(modal.slice(modal.indexOf('id="cancel-retention-continue-btn"') - 200), 'cancelling anyway is the quiet one').toMatch(/btn btn-link/);
      },
    },

    {
      name: '#323: both dialogs hold the copy rules',
      run: async (ctx) => {
        const page = await accountPage();
        const dialogs = {
          'the save offer': dialogAt(page, 'cancel-winback-modal', 'cancel-trial-warning-modal'),
          'the trial warning': dialogAt(page, 'cancel-trial-warning-modal', 'cancel-retention-modal'),
          'the retention warning': dialogAt(page, 'cancel-retention-modal', 'change-plan-modal'),
        };

        for (const [what, modal] of Object.entries(dialogs)) {
          // The rule is about COPY — the authoring comments the template carries are
          // never rendered, so they are stripped before the read.
          ctx.expect(!modal.replace(/<!--[\s\S]*?-->/g, '').includes('—'), `${what}: no em dashes in product copy`).toBeTruthy();
        }

        // A brand name is NEVER written into framework copy: the offer's supporting
        // line reads the config, so every brand's dialog says its own name.
        ctx.expect(dialogs['the save offer'], 'the offer names the brand from config').toMatch(/Give MiniCo another shot/);
        ctx.expect(dialogs['the retention warning'], 'and so does the fallback warning').toMatch(/MiniCo/);
      },
    },

    {
      name: '#325: the card carries the applied-discount indicator, bound and hidden by default',
      run: async (ctx) => {
        const page = await accountPage();
        const at = page.indexOf('id="billing-discount"');
        ctx.expect(at > 0, 'the indicator is on the card').toBeTruthy();

        const indicator = page.slice(at, page.indexOf('</div>', page.indexOf('billing.discount.when')));

        ctx.expect(page.slice(at - 200, at + 400), 'it shows only when there is a discount').toMatch(/data-omega-bind="@show billing\.discount\.show"/);
        ctx.expect(page.slice(at, at + 400), 'and a page whose JS never runs shows nothing at all').toMatch(/hidden/);

        // Real TEXT, both halves — a saving announced by a colored pill alone is not
        // announced at all.
        ctx.expect(indicator, 'what comes off').toMatch(/data-omega-bind="@text billing\.discount\.label"/);
        ctx.expect(indicator, 'and which bills it comes off').toMatch(/data-omega-bind="@text billing\.discount\.when"/);
        ctx.expect(!/\d+% off/.test(indicator), 'no discount number is hardcoded in the markup').toBeTruthy();
      },
    },

    {
      name: '#323: the dialog mark is CORE vocabulary, painted only through tokens',
      run: (ctx) => {
        const warnings = [];
        const css = sass.compile(COMPONENTS_SHEET, {
          logger: { warn: (message) => warnings.push(message), debug: () => {} },
        }).css;

        ctx.expect(warnings, 'new core css never warns — the #16 bar').toEqual([]);

        const mark = css.match(/\.omega-dialog-mark \{[^}]*\}/);
        ctx.expect(mark, 'the structural rule lives in the shared sheet, so every skin inherits it').toBeTruthy();
        ctx.expect(mark[0], 'a disc').toMatch(/border-radius: 50%/);
        ctx.expect(mark[0], 'ink from the token contract').toMatch(/color: var\(--omega-accent\)/);
        ctx.expect(mark[0], 'and the accent tint behind it').toMatch(/background: var\(--omega-accent-subtle\)/);

        const danger = css.match(/\.omega-dialog-mark--danger \{[^}]*\}/);
        ctx.expect(danger, 'the warning variant rides along').toBeTruthy();
        ctx.expect(danger[0], 'in the ONE danger hue').toMatch(/var\(--omega-danger\)/);
      },
    },

    {
      name: '#323: a theme that inherits neither classy lane still gets the mark',
      run: (ctx) => {
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
        ctx.expect(definitions.length, 'exactly ONE structural definition in the bundle').toBe(1);
      },
    },
  ],
});
