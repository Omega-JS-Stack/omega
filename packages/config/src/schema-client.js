/**
 * Schema rules for the `client` blob: the @omega.js/client settings bag a web
 * target carries. The bag is OPEN (the client normalizes it against its own
 * defaults); only the keys a brand authors, and consent, are typed.
 */

const CLIENT_RULES = [
  {
    path:        'client',
    type:        'object',
    open:        true,
    required:    false,
    description: "The @omega.js/client runtime settings (auth, firebase, exitPopup, …), merged over the client's own defaults. Open by design: only consent and the keys a brand authors are typed below.",
  },

  // Consent decides whether a visitor is tracked at all: a typo that silently
  // disabled the banner would ship a site with no consent gate and no error.
  {
    path:        'client.consent.enabled',
    type:        'boolean',
    required:    false,
    default:     true,
    description: 'The consent banner + the provider-script gate (default true). false ships NO banner: legal only for a site that loads no analytics/marketing provider at all.',
  },
  {
    path:        'client.consent.config.position',
    type:        'string',
    required:    false,
    enum:        ['bottom-left', 'bottom-right', 'bottom'],
    description: "Where the panel sits. 'bottom' is the centered full-width form.",
  },
  {
    path:        'client.consent.config.content',
    type:        'object',
    required:    false,
    description: "Banner copy: message, panelIntro, accept, customize, acceptAll, acceptNone (a literal `{terms}`/`{cookies}` links the terms/cookie-policy page). Category labels are framework copy: a brand renames the buttons, not the categories.",
  },

  // The keys a BRAND authors: each one reaches the client payload and changes
  // what the site does, so each one is typed.
  {
    path:        'client.auth.config.policy',
    type:        'string',
    required:    false,
    enum:        ['authenticated', 'unauthenticated', 'disabled'],
    description: "Who a page is FOR: 'authenticated' redirects a signed-out visitor to the signin route, 'unauthenticated' redirects a signed-in one away, 'disabled' skips the auth module entirely (a vert iframe). Absent = no policy, which is the site-wide answer: the auth/admin layouts set theirs in page frontmatter, so a brand only sets this to blanket a whole site.",
  },
  {
    path:        'client.exitPopup.enabled',
    type:        'boolean',
    required:    false,
    default:     true,
    description: 'The exit-intent offer popup (default true). false ships no popup at all; its copy, timeout and avatars live under client.exitPopup.config.',
  },
  {
    path:        'client.serviceWorker.enabled',
    type:        'boolean',
    required:    false,
    default:     true,
    description: 'Registers the site service worker (default true): the offline/refresh lane and the push-notification registration ride it. false unregisters any worker the visitor already has.',
  },
];

module.exports = { CLIENT_RULES };
