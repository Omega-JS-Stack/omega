/**
 * The comparison matrix reads a catalog value the way the plan cards do
 * (#562).
 *
 * `payment.products[].features[].value: "Included"` — the legacy catalog value,
 * verbatim — rendered two ways from ONE catalog: the plan cards printed the
 * label beside their check, and the matrix fell through to the bare
 * `omega_commaify` branch (only `_cell == true` drew an icon), so a row mixed
 * the word "Included" with `circle-xmark` icons for the negative cells. Legacy
 * UJM drew a green check for the same data, and no single catalog value
 * satisfied both surfaces — setting `true` blanks the card labels.
 *
 * Ruling (manager, 2026-08-25): the matrix treats a truthy non-`true` cell as a
 * YES with a label — the check icon plus the value — which is exactly the shape
 * the cards already render. `true` stays icon-only, falsy stays the x icon. No
 * schema change.
 */
const assert = require('node:assert');
const { test, before } = require('node:test');

const { buildWith: sharedBuildWith, miniData } = require('./lib/build.js');

const buildWith = (siteData) => sharedBuildWith(siteData, {}, 'pricing-matrix-test');

// One catalog carrying every cell shape: a labelled string ("Included", the
// reported one), a number, an inherited string, a bare `true`, and a feature
// the lowest tier genuinely lacks.
const CATALOG = {
  products: [
    {
      id: 'basic',
      name: 'Basic',
      type: 'subscription',
      features: [
        { id: 'exports', name: 'Exports', value: 'Included' },
        { id: 'seats', name: 'Seats', value: 1000 },
      ],
    },
    {
      id: 'premium',
      name: 'Premium',
      type: 'subscription',
      prices: { monthly: 9.99 },
      features: [
        { id: 'exports', name: 'Exports', value: 'Included' },
        { id: 'seats', name: 'Seats', value: 'Unlimited' },
        { id: 'support', name: 'Priority support', value: true },
      ],
    },
  ],
};

/**
 * One matrix row's markup, by the feature name in its row header.
 * @param {string} html - the rendered /pricing page
 * @param {string} name - the feature name
 * @returns {string} everything from that row's `<tr>` to its `</tr>`
 */
function row(html, name) {
  const at = html.indexOf(name, html.indexOf('<caption>Compare features</caption>'));
  assert.ok(at > -1, `${name} has a row in the matrix`);
  const start = html.lastIndexOf('<tr', at);
  return html.slice(start, html.indexOf('</tr>', at));
}

let page;
before(async () => {
  page = await buildWith({ ...miniData, payment: CATALOG }).then((pages) => pages.get('/pricing'));
});

test('#562: a string cell is a YES with a label — check icon plus the value', () => {
  const exports = row(page, 'Exports');

  assert.strictEqual((exports.match(/omega-compare__yes/g) || []).length, 2, 'both plans draw the check');
  assert.strictEqual((exports.match(/omega-compare__no/g) || []).length, 0, 'and neither draws the x');
  assert.strictEqual((exports.match(/<span class="omega-compare__label">Included<\/span>/g) || []).length, 2,
    'the catalog word rides the check as its label, the way the plan cards render it');
});

test('#562: a number cell keeps its formatting, and an inherited string keeps its word', () => {
  const seats = row(page, 'Seats');

  assert.ok(seats.includes('<span class="omega-compare__label">1,000</span>'), 'omega_commaify still formats the number');
  assert.ok(seats.includes('<span class="omega-compare__label">Unlimited</span>'), 'and Unlimited is a label like any other value');
  assert.strictEqual((seats.match(/omega-compare__yes/g) || []).length, 2, 'both cells are a yes');
});

test('#562: `true` stays icon-only and a missing feature stays the x icon', () => {
  const support = row(page, 'Priority support');

  assert.strictEqual((support.match(/omega-compare__yes/g) || []).length, 1, 'premium declares it');
  assert.strictEqual((support.match(/omega-compare__no/g) || []).length, 1, 'basic genuinely lacks it');
  assert.ok(!support.includes('omega-compare__label'), 'a bare true carries no label — the icon says it');
});

test('#562: the two surfaces now agree on one catalog value', () => {
  // The whole point: the cards print "Included" beside their check and so does
  // the matrix, off the same `value` — no second key, no schema change.
  assert.ok(page.includes('omega-price-card__features'), 'the plan cards rendered');
  assert.ok((page.match(/Included/g) || []).length >= 4, 'the word lands on both surfaces, per plan');
});
