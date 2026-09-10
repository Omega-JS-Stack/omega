/**
 * features — the features contract, reachable from a page
 * ([#647](https://github.com/Omega-JS-Stack/omega/issues/647)).
 *
 * The derivations live ONCE, in `@omega.js/account` — the same module
 * @omega.js/backend's `consume` gate reads — so the number that refuses a
 * request and the number a usage bar draws can never be two different numbers:
 * the effective limit (a per-user `usage.overrides.<feature>` wins over the
 * plan's), the day's share of a month limit, and what is left of each.
 *
 * This module is the door a frontend goes through. `@omega.js/account` is a
 * private package a consumer's install never resolves by name, and this
 * package's dist carries it vendored — exactly the way `modules/analytics.js`
 * fronts `@omega.js/analytics`.
 *
 * The catalog itself is CONFIG: `omega.config.features`, which the embedding
 * framework's build bridges in beside `omega.config.payment`.
 */
export {
  isCountedFeature,
  isPacedFeature,
  featureMirrors,
  featureOverride,
  featureCounters,
  productFeatureValue,
  daysInMonth,
  dayShare,
  resolveFeature,
  resolveFeatures,
} from '@omega.js/account/features';
