/**
 * The per-brand ship list ([#867](https://github.com/Omega-JS-Stack/omega/issues/867)):
 * which of this brand's targets ship something, and what each shipped format
 * needs before it can.
 *
 * It types NO key names. @omega.js/config's format table says what every
 * format requires and devkit's ship-plan narrows that to one brand's
 * declaration, so a brand that drops a store is never asked for its keys and a
 * store added to the table is asked for the moment it exists.
 *
 * Two readers: the REQUIRES registry (src/config.js), whose per-input `when`
 * is this list, and the publishing service itself.
 */

const { FORMATS } = require('@omega.js/config');
const { shipPlan } = require('@omega.js/devkit/ship-plan');

// The target types that ship: web and backend deploy, they do not publish an
// artifact anybody installs, so neither carries a `platforms` declaration.
const SHIP_TARGETS = ['desktop', 'extension'];

/**
 * Every credential ANY format can require, in table order. The registry's
 * static input list (a REQUIRES entry names its keys up front; `when` is what
 * narrows them per brand).
 *
 * @returns {string[]} Key names, deduped.
 */
function shipCredentials() {
  const names = [];

  for (const target of SHIP_TARGETS) {
    for (const formats of Object.values(FORMATS[target])) {
      for (const spec of Object.values(formats)) {
        for (const key of spec.requires) {
          if (!names.includes(key)) names.push(key);
        }
      }
    }
  }

  return names;
}

/**
 * The brand's shipping targets and what each one ships.
 *
 * The declaration is read off the TARGET ENTRY, which is where `platforms`
 * lives (the schema declares it under `targets.<desktop|extension>` and
 * nowhere else, so the entry IS that target's resolved view of it). An entry
 * with no usable `type` answers nothing rather than throwing: this runs inside
 * a registry predicate, against raw configs too.
 *
 * @param {object} brandConfig - The brand's config.
 * @returns {Array<{ name: string, type: string, formats: Array<object> }>} In
 *   config order; `formats` is devkit's shipPlan for that target.
 */
function shipTargets(brandConfig) {
  const targets = (brandConfig && brandConfig.targets) || {};
  const shipping = [];

  for (const [name, entry] of Object.entries(targets)) {
    if (!entry || !SHIP_TARGETS.includes(entry.type)) continue;

    shipping.push({ name, type: entry.type, formats: shipPlan(entry, entry.type) });
  }

  return shipping;
}

/**
 * Every ship credential THIS brand owes, across its targets.
 *
 * @param {object} brandConfig - The brand's config.
 * @returns {string[]} Key names, deduped, in declaration order.
 */
function brandShipKeys(brandConfig) {
  const keys = [];

  for (const target of shipTargets(brandConfig)) {
    for (const entry of target.formats) {
      for (const key of entry.requires) {
        if (!keys.includes(key)) keys.push(key);
      }
    }
  }

  return keys;
}

module.exports = { SHIP_TARGETS, shipCredentials, shipTargets, brandShipKeys };
