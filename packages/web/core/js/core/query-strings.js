import omega from '@omega.js/client';

// The utm set and the ad-platform click ids read off the landing URL.
const UTM_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content'
];

const CLICK_ID_PARAMS = [
  'fbclid',
  'gclid',
  'gbraid',
  'wbraid',
  'ttclid',
  'msclkid',
  'twclid'
];

// Query Strings Module
export default function () {
  // Process query strings when DOM is ready
  omega.dom().ready().then(() => {
    processQueryStrings();
  });

  function processQueryStrings() {
    // Get URL parameters
    const urlParams = new URLSearchParams(window.location.search);

    // Get current attribution data
    const attribution = omega.storage().get('attribution', {});

    // Fold a pre-first/last blob into the new shape before anything reads it
    migrateLegacyAttribution(attribution);

    // Process affiliate/referral parameters
    processAffiliateParams(urlParams, attribution);

    // Process this visit's touch (utm tags, click ids, landing context)
    processTouch(urlParams, attribution);

    // Save updated attribution
    omega.storage().set('attribution', attribution);
  }

  function processAffiliateParams(urlParams, attribution) {
    // Check for aff or ref parameter
    const affParam = urlParams.get('aff') || urlParams.get('ref');

    // Quit if no affiliate parameter
    if (!affParam) {
      return;
    }

    // Save affiliate data to attribution object
    attribution.affiliate = {
      code: affParam,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      page: window.location.pathname
    };
  }

  function processTouch(urlParams, attribution) {
    const touch = buildTouch(urlParams);

    // First touch is written ONCE, on the first visit ever seen — an organic or
    // direct landing counts, so every user carries a referrer and a landing url.
    if (!attribution.first) {
      attribution.first = touch;
    }

    // Last touch moves only for a TAGGED visit: an untagged page view later on
    // must never erase the campaign that brought the user in. No expiry — the
    // timestamps carry any read-time lookback window.
    if (isTagged(touch)) {
      attribution.last = { ...touch };
    }
  }

  function buildTouch(urlParams) {
    const tags = collectParams(urlParams, UTM_PARAMS);
    const clickIds = collectParams(urlParams, CLICK_ID_PARAMS);

    return {
      ...(tags ? { tags: tags } : {}),
      ...(clickIds ? { clickIds: clickIds } : {}),
      referrer: document.referrer || null,
      url: window.location.href,
      page: window.location.pathname,
      timestamp: new Date().toISOString()
    };
  }

  // Collect the params that are present; null when the family is absent entirely,
  // so an untagged visit carries no empty `tags`/`clickIds` husk.
  function collectParams(urlParams, names) {
    const collected = {};

    names.forEach(name => {
      const value = urlParams.get(name);
      if (value) {
        collected[name] = value;
      }
    });

    return Object.keys(collected).length > 0 ? collected : null;
  }

  function isTagged(touch) {
    return !!(touch.tags || touch.clickIds);
  }

  // One-time fold of the pre-first/last blob ({ utm, affiliate }) into the
  // structured shape. Idempotent: the legacy key is dropped on the first run,
  // and `affiliate` was always top level, so it carries over untouched.
  function migrateLegacyAttribution(attribution) {
    const legacy = attribution.utm;

    if (!legacy) {
      return;
    }

    delete attribution.utm;

    // A blob that already has a first touch has been migrated — drop the leftover
    // key and leave the newer touches alone.
    if (attribution.first) {
      return;
    }

    const touch = {
      ...(legacy.tags && Object.keys(legacy.tags).length > 0 ? { tags: legacy.tags } : {}),
      referrer: null,
      url: legacy.url || null,
      page: legacy.page || null,
      timestamp: legacy.timestamp || null
    };

    attribution.first = touch;
    attribution.last = { ...touch };
  }
}
