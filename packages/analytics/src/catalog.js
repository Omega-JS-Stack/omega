/**
 * The event catalog — the SSOT for every analytics event OMEGA fires
 * ([#328](https://github.com/Omega-JS-Stack/omega/issues/328) §Architecture,
 * built by [#382](https://github.com/Omega-JS-Stack/omega/issues/382)).
 *
 * ONE entry per canonical event. Callers only ever speak canonical names and
 * canonical params; each adapter translates into its provider's own dialect,
 * because there is no unified cross-provider signature (Ian's constraint).
 *
 * Entry shape:
 *   params     — the canonical param contract, documentation for callers.
 *                Drawn from the EXISTING call sites so a rewired site sends
 *                what it sends today.
 *   placement  — 'client' | 'server' | 'both'. Money and account truth fire
 *                server-side, UI actions client-side, signup both.
 *   providers  — per-provider mapping. A provider ABSENT from this object has
 *                no mapping: the adapter returns null and the facade logs the
 *                dev skip. Each mapping carries:
 *                  name — the provider's NATIVE event name
 *                  kind — 'standard' (the platform defines this event) or
 *                         'custom' (a deliberate custom event; the provider
 *                         fires its custom-event mechanism)
 *                  map  — OPTIONAL (params, context) => payload, only where
 *                         the provider's shape genuinely differs. Default is
 *                         pass-through.
 *                  method — OPTIONAL, browser only: the provider's own PIXEL
 *                         METHOD to call instead of its tracked-event command,
 *                         for the one signal a platform manages itself rather
 *                         than exposing as a trackable name (TikTok's
 *                         `ttq.page()`). The name and kind stay declared for the
 *                         catalog and the fire log; the transport calls the
 *                         method, with no name and no payload.
 *
 * The canonical param vocabulary is GA4-flavoured (flat params plus an `items`
 * array), because that is what the live call sites and the backend's payment
 * webhook already build — so GA4 is pass-through and the maps live where the
 * other two platforms genuinely disagree: their commerce vocabulary
 * (content_ids/content_id, num_items, price) and Search's `search_string`.
 */

// Drop keys a caller did not supply — a provider payload carrying
// `content_name: undefined` is noise, not data.
function compact(payload) {
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

// ─── Shared provider shapers ────────────────────────────────────────────────

// Meta's commerce vocabulary: content_ids + num_items instead of GA4's items[].
function metaCommerce(params) {
  const items = Array.isArray(params.items) ? params.items : [];
  const first = items[0];

  return compact({
    content_ids: items.length ? items.map((item) => item.item_id) : undefined,
    content_name: first ? first.item_name : undefined,
    content_type: items.length ? 'product' : undefined,
    currency: params.currency,
    value: params.value,
    num_items: items.length || undefined,
  });
}

// TikTok's commerce vocabulary: a single content_id with its own price/quantity.
function tiktokCommerce(params) {
  const items = Array.isArray(params.items) ? params.items : [];
  const first = items[0] || {};

  return compact({
    content_id: first.item_id,
    content_type: items.length ? 'product' : undefined,
    content_name: first.item_name,
    price: first.price,
    quantity: first.quantity,
    currency: params.currency,
    value: params.value,
  });
}

// A churn moment's ad-platform half: an EXCLUSION-AUDIENCE signal, never money
// ([#415](https://github.com/Omega-JS-Stack/omega/issues/415)). Neither platform
// can subtract revenue, so a cancellation or a refund carrying its amount would
// ADD to the return their ads manager reports — the exact opposite of the truth.
// `value: 0` is the honest number on that side; GA4 keeps the real one, where a
// refund is a standard event the revenue report knows how to net.
function metaAudienceSignal(params) {
  return { ...metaCommerce(params), value: 0 };
}

function tiktokAudienceSignal(params) {
  // TikTok's per-item `price` and `quantity` come off with the value: zeroing
  // one field while the amount rides in another is not a zero-value signal.
  // Meta's shaper carries neither by construction, and this matches it — what
  // is left is who and which plan, which is the whole point of the audience.
  const { price, quantity, ...signal } = tiktokCommerce(params);

  return { ...signal, value: 0 };
}

// Both ad platforms call the query `search_string`; GA4 calls it `search_term`.
function metaSearch(params) {
  return compact({
    search_string: params.search_term,
    content_category: params.content_category,
  });
}

function tiktokSearch(params) {
  return compact({
    search_string: params.search_term,
  });
}

// The recurring-revenue events ride GA4's standard `purchase` under their own
// canonical name, so the flag that tells them apart in GA4 is set here.
function ga4Recurring(params) {
  return { ...params, is_recurring: true };
}

// The canonical commerce param contract, shared by every money event.
const COMMERCE_PARAMS = ['transaction_id', 'value', 'currency', 'items', 'is_trial', 'is_recurring', 'payment_processor', 'payment_frequency'];

// A plan change is the one money event with a BEFORE: `items` is the plan the
// subscriber moved to, and these carry the one they came from, so the direction
// of the switch is readable without a second event
// ([#407](https://github.com/Omega-JS-Stack/omega/issues/407)).
const PLAN_CHANGE_PARAMS = [...COMMERCE_PARAMS, 'previous_item_id', 'previous_item_name', 'previous_value'];

// ─── The catalog ────────────────────────────────────────────────────────────

const CATALOG = {
  // ─── Auth ───

  // The funnel entry, fired when the signup form is submitted. No provider
  // mapping: the signup FUNNEL is ours to read, not an ad platform's.
  sign_up_started: {
    params: ['method'],
    placement: 'client',
    providers: {},
  },

  sign_up: {
    params: ['method', 'user_id'],
    placement: 'both',
    providers: {
      ga4: { name: 'sign_up', kind: 'standard' },
      meta: { name: 'CompleteRegistration', kind: 'standard' },
      tiktok: { name: 'CompleteRegistration', kind: 'standard' },
    },
  },

  login: {
    params: ['method', 'user_id'],
    placement: 'client',
    providers: {
      ga4: { name: 'login', kind: 'standard' },
      // Neither ad platform defines a Login event — today's call sites already
      // fire it as a custom one, and the catalog says so out loud.
      meta: { name: 'Login', kind: 'custom' },
      tiktok: { name: 'Login', kind: 'custom' },
    },
  },

  // Deliberately unmapped everywhere: a logout is not an ad signal, and GA4
  // reads the session end on its own.
  logout: {
    params: [],
    placement: 'client',
    providers: {},
  },

  password_reset: {
    params: ['method', 'status'],
    placement: 'client',
    providers: {
      ga4: { name: 'password_reset', kind: 'custom' },
      meta: { name: 'PasswordReset', kind: 'custom' },
      tiktok: { name: 'SubmitForm', kind: 'standard' },
    },
  },

  // Every platform hears the page view through THIS entry
  // ([#409](https://github.com/Omega-JS-Stack/omega/issues/409)): the web
  // loader's raw `fbq('track', 'PageView')` and `ttq.page()` at pixel init are
  // retired, so a page view walks the same consent gate and the same catalog as
  // every other event. Pass-through: a page's own params are all any of them
  // wants, and each pixel reads the URL itself when a fire carries none.
  page_view: {
    params: ['page_path', 'page_title', 'page_location'],
    placement: 'client',
    providers: {
      ga4: { name: 'page_view', kind: 'standard' },
      meta: { name: 'PageView', kind: 'standard' },
      // TikTok's page view is a pixel METHOD it manages itself (`ttq.page()`),
      // not a name in its trackable set — `ttq.track('Pageview')` appears
      // nowhere in TikTok's documented surface, and sending it would risk a
      // Pageview metric that silently reads zero. So the mapping names the
      // METHOD and the browser transport calls exactly that; the name and the
      // honest `custom` kind stay for the catalog and the fire log.
      tiktok: { name: 'Pageview', kind: 'custom', method: 'page' },
    },
  },

  // The page_view twin for the runtimes that have screens, not pages —
  // desktop's renderers fire it through the main-process singleton.
  screen_view: {
    params: ['screen_name'],
    placement: 'client',
    providers: {
      ga4: { name: 'screen_view', kind: 'standard' },
    },
  },

  // ─── Commerce (client funnel) ───

  view_item: {
    params: ['currency', 'value', 'items'],
    placement: 'client',
    providers: {
      ga4: { name: 'view_item', kind: 'standard' },
      meta: { name: 'ViewContent', kind: 'standard', map: metaCommerce },
      tiktok: { name: 'ViewContent', kind: 'standard', map: tiktokCommerce },
    },
  },

  // The pricing page's monthly/yearly switch — a plan VIEW, not a cart action,
  // so the ad platforms read it as content rather than commerce (no items[]).
  pricing_toggle: {
    params: ['billing_type'],
    placement: 'client',
    providers: {
      ga4: { name: 'pricing_toggle', kind: 'custom' },
      meta: { name: 'ViewContent', kind: 'standard' },
      tiktok: { name: 'ViewContent', kind: 'standard' },
    },
  },

  add_to_cart: {
    params: ['currency', 'value', 'items'],
    placement: 'client',
    providers: {
      ga4: { name: 'add_to_cart', kind: 'standard' },
      meta: { name: 'AddToCart', kind: 'standard', map: metaCommerce },
      tiktok: { name: 'AddToCart', kind: 'standard', map: tiktokCommerce },
    },
  },

  begin_checkout: {
    params: ['currency', 'value', 'items'],
    placement: 'client',
    providers: {
      ga4: { name: 'begin_checkout', kind: 'standard' },
      meta: { name: 'InitiateCheckout', kind: 'standard', map: metaCommerce },
      tiktok: { name: 'InitiateCheckout', kind: 'standard', map: tiktokCommerce },
    },
  },

  add_payment_info: {
    params: ['currency', 'value', 'payment_type', 'items'],
    placement: 'client',
    providers: {
      ga4: { name: 'add_payment_info', kind: 'standard' },
      meta: { name: 'AddPaymentInfo', kind: 'standard', map: metaCommerce },
      tiktok: { name: 'AddPaymentInfo', kind: 'standard', map: tiktokCommerce },
    },
  },

  // ─── Commerce (server truth) ───

  // Server is the truth: the backend's payment webhook owns the revenue, and it
  // owns GA4 outright. The BROWSER half is the retargeting signal the ad
  // platforms need ([#386](https://github.com/Omega-JS-Stack/omega/issues/386)):
  // the confirmation page fires meta + tiktok only, carrying the same dedupe
  // event id the webhook sends, so each platform counts ONE purchase.
  purchase: {
    params: COMMERCE_PARAMS,
    placement: 'both',
    providers: {
      ga4: { name: 'purchase', kind: 'standard' },
      meta: { name: 'Purchase', kind: 'standard', map: metaCommerce },
      tiktok: { name: 'CompletePayment', kind: 'standard', map: tiktokCommerce },
    },
  },

  start_trial: {
    params: COMMERCE_PARAMS,
    placement: 'server',
    providers: {
      // GA4 has no start_trial in its standard set — an explicit custom event.
      ga4: { name: 'start_trial', kind: 'custom' },
      meta: { name: 'StartTrial', kind: 'standard', map: metaCommerce },
      tiktok: { name: 'Subscribe', kind: 'standard', map: tiktokCommerce },
    },
  },

  // The FIRST real charge after a trial — the funnel step the generic renewal
  // branch used to swallow, which made a conversion indistinguishable from a
  // routine renewal ([#407](https://github.com/Omega-JS-Stack/omega/issues/407)).
  //
  // GA4 hears its standard `purchase`, because this is where the money finally
  // moves and revenue belongs in the revenue report; the pair `is_trial: true` +
  // `is_recurring: false` is what marks it inside that stream, so the conversion
  // is still countable on its own. The ad platforms already heard
  // `StartTrial`/`Subscribe` at trial start, and this is that subscription
  // starting to pay — their own standard Subscribe.
  trial_converted: {
    params: COMMERCE_PARAMS,
    placement: 'server',
    providers: {
      ga4: { name: 'purchase', kind: 'standard' },
      meta: { name: 'Subscribe', kind: 'standard', map: metaCommerce },
      tiktok: { name: 'Subscribe', kind: 'standard', map: tiktokCommerce },
    },
  },

  // The other end of the same funnel: a trial that ended without ever paying.
  // GA4-only, and DELIBERATELY out of the exclusion lane the two entries below
  // joined ([#415](https://github.com/Omega-JS-Stack/omega/issues/415)): a
  // lapsed trialist is a win-back audience worth RETARGETING, not somebody to
  // stop showing ads to. An ad platform optimizes toward conversions, so the
  // failure itself buys nothing either.
  trial_lapsed: {
    params: COMMERCE_PARAMS,
    placement: 'server',
    providers: {
      ga4: { name: 'trial_lapsed', kind: 'custom' },
    },
  },

  // GA4's own refund event, fired by the payment webhook's refund transitions.
  // The ad platforms hear a zero-value custom `Refunded` — an audience to stop
  // paying to reach, and the one thing they can do with a churn moment.
  refund: {
    params: ['transaction_id', 'value', 'currency', 'items'],
    placement: 'server',
    providers: {
      ga4: { name: 'refund', kind: 'standard' },
      meta: { name: 'Refunded', kind: 'custom', map: metaAudienceSignal },
      tiktok: { name: 'Refunded', kind: 'custom', map: tiktokAudienceSignal },
    },
  },

  // The cancellation that TOOK EFFECT. Cancellation-REQUESTED stays event-less by
  // design: a schedule changed, nothing ended, no money moved, and the
  // subscription may never cancel at all.
  subscription_cancelled: {
    params: COMMERCE_PARAMS,
    placement: 'server',
    providers: {
      ga4: { name: 'subscription_cancelled', kind: 'custom' },
      meta: { name: 'SubscriptionCancelled', kind: 'custom', map: metaAudienceSignal },
      tiktok: { name: 'SubscriptionCancelled', kind: 'custom', map: tiktokAudienceSignal },
    },
  },

  // The uncancel — a scheduled cancellation withdrawn. The request had no event
  // to be the pair of, which is the point: a retention win is an outcome, and it
  // was completely dark before [#407].
  subscription_uncancelled: {
    params: COMMERCE_PARAMS,
    placement: 'server',
    providers: {
      ga4: { name: 'subscription_uncancelled', kind: 'custom' },
    },
  },

  // An upgrade or downgrade between two paid plans. GA4-only: no money moves at
  // the switch itself, and firing a platform's Subscribe here would count a
  // second subscription for a customer who already has one.
  plan_changed: {
    params: PLAN_CHANGE_PARAMS,
    placement: 'server',
    providers: {
      ga4: { name: 'plan_changed', kind: 'custom' },
    },
  },

  subscription_renewed: {
    params: COMMERCE_PARAMS,
    placement: 'server',
    providers: {
      ga4: { name: 'purchase', kind: 'standard', map: ga4Recurring },
      meta: { name: 'Subscribe', kind: 'standard', map: metaCommerce },
      tiktok: { name: 'Subscribe', kind: 'standard', map: tiktokCommerce },
    },
  },

  payment_recovered: {
    params: COMMERCE_PARAMS,
    placement: 'server',
    providers: {
      ga4: { name: 'purchase', kind: 'standard', map: ga4Recurring },
      meta: { name: 'Subscribe', kind: 'standard', map: metaCommerce },
      tiktok: { name: 'Subscribe', kind: 'standard', map: tiktokCommerce },
    },
  },

  // ─── Engagement ───

  generate_lead: {
    params: ['lead_source', 'subject'],
    placement: 'client',
    providers: {
      ga4: { name: 'generate_lead', kind: 'standard' },
      meta: { name: 'Lead', kind: 'standard' },
      tiktok: { name: 'Contact', kind: 'standard' },
    },
  },

  // The enterprise "talk to us" path off the pricing page.
  contact_enterprise: {
    params: ['from_page'],
    placement: 'client',
    providers: {
      ga4: { name: 'contact_enterprise', kind: 'custom' },
      meta: { name: 'Contact', kind: 'standard' },
      tiktok: { name: 'Contact', kind: 'standard' },
    },
  },

  // The contact form's honeypot catch. GA4 only: a spam signal is ours to
  // read, and feeding it to an ad platform would poison the audience.
  contact_form_spam: {
    params: ['content_type'],
    placement: 'client',
    providers: {
      ga4: { name: 'contact_form_spam', kind: 'custom' },
    },
  },

  // GA4's standard name, replacing the literal `download` today's page sends.
  file_download: {
    params: ['platform', 'download_name', 'download_url'],
    placement: 'client',
    providers: {
      ga4: { name: 'file_download', kind: 'standard' },
      meta: { name: 'Download', kind: 'custom' },
      tiktok: { name: 'Download', kind: 'standard' },
    },
  },

  feedback_submitted: {
    params: ['feedback_rating'],
    placement: 'client',
    providers: {
      ga4: { name: 'feedback_submitted', kind: 'custom' },
      meta: { name: 'SubmitApplication', kind: 'standard' },
      tiktok: { name: 'SubmitForm', kind: 'standard' },
    },
  },

  review_click: {
    params: ['review_url'],
    placement: 'client',
    providers: {
      ga4: { name: 'review_click', kind: 'custom' },
      meta: { name: 'Lead', kind: 'standard' },
      tiktok: { name: 'Contact', kind: 'standard' },
    },
  },

  // The prompt half of the review pair — ours to read, no ad signal in it.
  review_prompt_shown: {
    params: ['review_url'],
    placement: 'client',
    providers: {
      ga4: { name: 'review_prompt_shown', kind: 'custom' },
    },
  },

  search: {
    params: ['search_term', 'content_category'],
    placement: 'client',
    providers: {
      ga4: { name: 'search', kind: 'standard' },
      meta: { name: 'Search', kind: 'standard', map: metaSearch },
      tiktok: { name: 'Search', kind: 'standard', map: tiktokSearch },
    },
  },

  share: {
    params: ['method', 'content_type', 'item_id'],
    placement: 'client',
    providers: {
      ga4: { name: 'share', kind: 'standard' },
      // Neither platform defines Share — today's sites claim it as standard.
      meta: { name: 'Share', kind: 'custom' },
      tiktok: { name: 'Share', kind: 'custom' },
    },
  },

  // The share panel's copy-to-clipboard half.
  copy_link: {
    params: ['content_type', 'item_id'],
    placement: 'client',
    providers: {
      ga4: { name: 'copy_link', kind: 'custom' },
      meta: { name: 'CopyLink', kind: 'custom' },
      tiktok: { name: 'ClickButton', kind: 'standard' },
    },
  },

  newsletter_signup: {
    params: ['method'],
    placement: 'client',
    providers: {
      ga4: { name: 'newsletter_signup', kind: 'custom' },
      meta: { name: 'Lead', kind: 'standard' },
      tiktok: { name: 'Subscribe', kind: 'standard' },
    },
  },

  // The status page's incident-updates opt-in — its own event, keeping its
  // live provider dialect (TikTok reads it as a form submit, not a Subscribe).
  status_subscribe: {
    params: ['method'],
    placement: 'client',
    providers: {
      ga4: { name: 'status_subscribe', kind: 'custom' },
      meta: { name: 'Lead', kind: 'standard' },
      tiktok: { name: 'SubmitForm', kind: 'standard' },
    },
  },

  // ─── Exit popup ───

  exit_popup_show: {
    params: ['event_category', 'event_label', 'page_path'],
    placement: 'client',
    providers: {
      ga4: { name: 'exit_popup_show', kind: 'custom' },
      meta: { name: 'ExitPopupShow', kind: 'custom' },
      tiktok: { name: 'ViewContent', kind: 'standard' },
    },
  },

  exit_popup_click: {
    params: ['event_category', 'event_label', 'destination_url'],
    placement: 'client',
    providers: {
      ga4: { name: 'exit_popup_click', kind: 'custom' },
      meta: { name: 'Lead', kind: 'standard' },
      tiktok: { name: 'ClickButton', kind: 'standard' },
    },
  },

  exit_popup_dismiss: {
    params: ['event_category', 'event_label'],
    placement: 'client',
    providers: {
      ga4: { name: 'exit_popup_dismiss', kind: 'custom' },
      meta: { name: 'ExitPopupDismiss', kind: 'custom' },
      tiktok: { name: 'ViewContent', kind: 'standard' },
    },
  },

  // ─── Cookie consent ───
  // TikTok is deliberately unmapped: consent bookkeeping is not an ad signal.
  // (`cookie_consent_auto_accept` is DROPPED — the new consent system has no
  // auto-accept-on-scroll.)

  cookie_banner_show: {
    params: ['event_category'],
    placement: 'client',
    providers: {
      ga4: { name: 'cookie_banner_show', kind: 'custom' },
      meta: { name: 'CookieBannerShow', kind: 'custom' },
    },
  },

  cookie_consent_accept: {
    params: ['event_category', 'consent_type'],
    placement: 'client',
    providers: {
      ga4: { name: 'cookie_consent_accept', kind: 'custom' },
      meta: { name: 'CookieConsentAccept', kind: 'custom' },
    },
  },

  cookie_consent_deny: {
    params: ['event_category', 'consent_type'],
    placement: 'client',
    providers: {
      ga4: { name: 'cookie_consent_deny', kind: 'custom' },
      meta: { name: 'CookieConsentDeny', kind: 'custom' },
    },
  },

  cookie_policy_reopen: {
    params: ['event_category'],
    placement: 'client',
    providers: {
      ga4: { name: 'cookie_policy_reopen', kind: 'custom' },
      meta: { name: 'CookiePolicyReopen', kind: 'custom' },
    },
  },

  // ─── Account & portal ───
  // Action buckets: one event with an `action`/`section_name` param, never a
  // per-action event sprawl (the inventory ruling).

  account_section_view: {
    params: ['section_name'],
    placement: 'client',
    providers: {
      ga4: { name: 'account_section_view', kind: 'custom' },
    },
  },

  billing_action: {
    params: ['action'],
    placement: 'client',
    providers: {
      ga4: { name: 'billing_action', kind: 'custom' },
    },
  },

  refund_action: {
    params: ['action'],
    placement: 'client',
    providers: {
      ga4: { name: 'refund_action', kind: 'custom' },
    },
  },

  data_request: {
    params: ['action'],
    placement: 'client',
    providers: {
      ga4: { name: 'data_request', kind: 'custom' },
    },
  },

  email_subscribe: {
    params: ['content_type'],
    placement: 'client',
    providers: {
      ga4: { name: 'email_subscribe', kind: 'custom' },
      meta: { name: 'EmailSubscribe', kind: 'custom' },
    },
  },

  email_unsubscribe: {
    params: ['content_type'],
    placement: 'client',
    providers: {
      ga4: { name: 'email_unsubscribe', kind: 'custom' },
      meta: { name: 'EmailUnsubscribe', kind: 'custom' },
    },
  },

  // ─── Notifications ───

  notification_permission_requested: {
    params: [],
    placement: 'client',
    providers: {
      ga4: { name: 'notification_permission_requested', kind: 'custom' },
    },
  },

  notification_permission_granted: {
    params: [],
    placement: 'client',
    providers: {
      ga4: { name: 'notification_permission_granted', kind: 'custom' },
    },
  },

  notification_permission_denied: {
    params: [],
    placement: 'client',
    providers: {
      ga4: { name: 'notification_permission_denied', kind: 'custom' },
    },
  },

  notification_subscribe: {
    params: [],
    placement: 'server',
    providers: {
      ga4: { name: 'notification_subscribe', kind: 'custom' },
    },
  },

  notification_unsubscribe: {
    params: [],
    placement: 'server',
    providers: {
      ga4: { name: 'notification_unsubscribe', kind: 'custom' },
    },
  },

  // ─── Surfaces ───

  vert_click: {
    params: ['vert_id', 'vert_lane', 'vert_campaign', 'vert_slot', 'vert_source'],
    placement: 'client',
    providers: {
      ga4: { name: 'vert_click', kind: 'custom' },
    },
  },

  extension_install: {
    params: ['browser', 'install_url'],
    placement: 'client',
    providers: {
      ga4: { name: 'extension_install', kind: 'custom' },
      meta: { name: 'ExtensionInstall', kind: 'custom' },
      tiktok: { name: 'Download', kind: 'standard' },
    },
  },

  app_launch: {
    params: [],
    placement: 'client',
    providers: {
      ga4: { name: 'app_launch', kind: 'custom' },
    },
  },

  // The 404 page's own event, carrying the path that missed. GA4 only: a broken
  // link is ours to fix, never an ad signal.
  page_not_found: {
    params: ['path'],
    placement: 'client',
    providers: {
      ga4: { name: 'page_not_found', kind: 'custom' },
    },
  },

  user_delete: {
    params: [],
    placement: 'server',
    providers: {
      ga4: { name: 'user_delete', kind: 'custom' },
    },
  },
};

// The placements an entry may declare.
const PLACEMENTS = ['client', 'server', 'both'];

// The provider kinds a mapping may declare.
const KINDS = ['standard', 'custom'];

/**
 * The catalog entry for a canonical event name, or null when it has none.
 * @param {string} name - The canonical event name.
 * @returns {object|null}
 */
function entryFor(name) {
  return Object.prototype.hasOwnProperty.call(CATALOG, name) ? CATALOG[name] : null;
}

module.exports = {
  CATALOG,
  PLACEMENTS,
  KINDS,
  entryFor,
  compact,
};
