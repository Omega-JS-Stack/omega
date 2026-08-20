/**
 * The consent banner — the thing that actually gates the trackers
 * ([#383](https://github.com/Omega-JS-Stack/omega/issues/383),
 * [#391](https://github.com/Omega-JS-Stack/omega/issues/391)).
 *
 * The old banner gated NOTHING: foot.html had already loaded every pixel by the
 * time it animated in, and scrolling the page auto-accepted on the visitor's
 * behalf. Both are gone. The scripts now wait on the record this banner writes
 * (core/js/core/analytics-loader.js), and the only ways to consent are the
 * controls below.
 *
 * The UX (Ian, against an iubenda-style reference): ONE big Accept granting both
 * optional categories, and a small Customize beside it that opens the panel —
 * a dense legal intro, then a row of pill switches (Necessary locked on, then
 * Analytics and Marketing), then Accept all / Accept none bottom-right.
 *
 * Two things about that panel are deliberate (#391). Every switch APPLIES AND
 * SAVES the moment it is flipped, and the panel stays open — there is no Save to
 * forget to press, and no state on screen that is not already the answer of
 * record. And refusal stays exactly one click (Accept none, sitting beside
 * Accept all at the same size), which is the EU equal-ease rule.
 *
 * The banner only ever asks a visitor it has to. In an opt-in region it is a
 * GATE (nothing loads until it is answered). In an opt-out region everything is
 * granted already, so a first visit gets NO banner at all — just the small
 * Cookies Settings tab, which reopens the full panel for anyone who wants to turn things
 * off. Once answered, either region collapses to that same tab.
 *
 * Its own four events ride the catalog like every other fire (#328), and the
 * transport under it is guarded (#306): a blocked or not-yet-loaded provider is
 * a silent no-op, which is exactly what makes a `cookie_banner_show` in an
 * opt-in region safe — nothing has loaded to receive it.
 */
import omega from '@omega.js/client';

import { event } from '__main_assets__/js/libs/analytics.js';
import { siteUrl } from '__main_assets__/js/libs/path-prefix.js';
import { getTrackingConsent, hasTrackingDecision, setTrackingConsent, clearTrackingDecision } from '__main_assets__/js/libs/tracking-consent.js';

// The panel's placement, config `position` → modifier class.
const POSITIONS = {
  'bottom-left': 'omega-consent--bottom-left',
  'bottom-right': 'omega-consent--bottom-right',
  'bottom': 'omega-consent--bottom',
};

// The optional categories, in the order the panel lists them.
const CATEGORIES = [
  { key: 'analytics', label: 'Analytics', description: 'How the site is used, so we can improve it.' },
  { key: 'marketing', label: 'Marketing', description: 'Measuring and personalizing our ads.' },
];

// How long the show/hide transition in _consent.scss runs.
const ANIMATION_MS = 300;

export default function () {
  const config = omega.config.consent.config;

  omega.dom().ready().then(() => {
    // Two visitors get the tab instead of the banner: one who has answered, and
    // (#391) one in an opt-out region who has not. The second grants both
    // categories by DEFAULT, so there is no gate to hold and nothing worth
    // interrupting a first visit for — the tab is the whole surface, and it
    // still reopens the full panel for anyone who wants to turn things off.
    // The region comes off the one seam that owns it (libs/tracking-consent.js,
    // which reads libs/consent-region.js); nothing here detects anything.
    if (hasTrackingDecision() || getTrackingConsent().region === 'opt-out') {
      createTab(config);
      return;
    }

    createBanner(config);
    // Counted here and not inside createBanner, so it says what it says: the
    // banner was SHOWN to a visitor who had to answer it. A reopen from the tab
    // is its own event and is not a second impression.
    trackBannerShown();
  });
}

/**
 * The banner itself: the message with its cookie icon, Accept, Customize, and
 * the options panel Customize reveals.
 * @param {object} config - the resolved `client.consent.config` blob
 */
function createBanner(config) {
  const banner = document.createElement('div');
  banner.className = 'omega-consent';
  banner.classList.add(POSITIONS[config.position] || POSITIONS['bottom-left']);
  banner.setAttribute('role', 'dialog');
  // Non-modal on purpose: it never traps focus or blocks the page behind it.
  banner.setAttribute('aria-modal', 'false');
  banner.setAttribute('aria-label', 'Cookie consent');

  // No icon on the open banner (Ian 2026-08-20): the glyph lives on the tab,
  // where it IS the recognition; here it only shoved the message over.
  const message = document.createElement('p');
  message.className = 'omega-consent__message';
  message.innerHTML = renderMessage(config.content.message);

  // ── The options panel — built up front, revealed by Customize ────────────
  const options = document.createElement('div');
  options.className = 'omega-consent__options';
  options.id = 'omega-consent-options';
  options.hidden = true;

  // The legal register lives here rather than on the banner face: the message
  // is the one-line ask, this is the disclosure it stands on.
  const intro = document.createElement('p');
  intro.className = 'omega-consent__intro';
  intro.innerHTML = renderMessage(config.content.panelIntro);

  const current = getTrackingConsent();
  const boxes = {};

  const toggles = document.createElement('div');
  toggles.className = 'omega-consent__toggles';

  toggles.appendChild(toggle({
    id: 'omega-consent-necessary',
    label: 'Necessary',
    description: 'Sign-in, security and preferences. Always on.',
    checked: true,
    locked: true,
  }).row);

  CATEGORIES.forEach((category) => {
    const built = toggle({
      id: `omega-consent-${category.key}`,
      label: category.label,
      description: category.description,
      checked: current[category.key] === true,
      locked: false,
    });

    // The flip IS the answer (#391) — applied and stored on the spot, with the
    // panel left open so the next one is a click away.
    built.input.addEventListener('change', () => apply(boxes, 'customize'));

    boxes[category.key] = built.input;
    toggles.appendChild(built.row);
  });

  options.appendChild(intro);
  options.appendChild(toggles);

  // ── The panel's own pair — the whole answer, either direction, in one click ─
  const panelActions = document.createElement('div');
  panelActions.className = 'omega-consent__panel-actions';

  // One answer per banner: the hide animation keeps the buttons on screen for
  // ANIMATION_MS, so without this latch a double-click would store the answer
  // twice and double-count the accept/deny event.
  let settled = false;
  const settle = (answer) => {
    if (settled) {
      return;
    }

    settled = true;
    answer();
    dismiss(banner, config);
  };

  const acceptAll = button('omega-consent__accept-all', config.content.acceptAll);
  acceptAll.addEventListener('click', () => settle(() => {
    setAll(boxes, true);
    apply(boxes, 'accept');
  }));

  const acceptNone = button('omega-consent__accept-none', config.content.acceptNone);
  acceptNone.addEventListener('click', () => settle(() => {
    setAll(boxes, false);
    // Granting nothing IS the denial, so `apply` fires deny rather than this
    // `via` — the same rule that read an all-clear Save as a refusal.
    apply(boxes, 'accept');
  }));

  panelActions.appendChild(acceptAll);
  panelActions.appendChild(acceptNone);
  options.appendChild(panelActions);

  // ── The two controls ─────────────────────────────────────────────────────
  const actions = document.createElement('div');
  actions.className = 'omega-consent__actions';

  const accept = button('omega-consent__accept', config.content.accept);
  accept.addEventListener('click', () => settle(() => {
    setTrackingConsent({ analytics: true, marketing: true });
    trackAccepted('accept');
  }));

  const customize = button('omega-consent__customize', config.content.customize);
  customize.setAttribute('aria-expanded', 'false');
  customize.setAttribute('aria-controls', 'omega-consent-options');
  customize.addEventListener('click', () => {
    options.hidden = false;
    customize.setAttribute('aria-expanded', 'true');
    // The whole opening row steps aside (#391): Accept all is the grant the big
    // Accept was, at the same one click, and Customize has nothing left to open.
    actions.hidden = true;
    // The panel that just appeared is where the keyboard should be.
    boxes.analytics.focus();
  });

  actions.appendChild(accept);
  actions.appendChild(customize);

  banner.appendChild(message);
  banner.appendChild(options);
  banner.appendChild(actions);

  document.body.appendChild(banner);

  // Next frame, so the mounted panel has a state to transition FROM.
  setTimeout(() => banner.classList.add('omega-consent--show'), 100);
}

/**
 * Store exactly what the switches say, and count it.
 * @param {object} boxes - category key → its checkbox
 * @param {string} via - what the accept event reports as the route
 * @returns {object} the choices stored
 */
function apply(boxes, via) {
  const choices = {
    analytics: boxes.analytics.checked,
    marketing: boxes.marketing.checked,
  };

  setTrackingConsent(choices);

  // A save that grants nothing IS the denial — Accept none and an all-off panel
  // are the same answer, so they are the same event.
  if (choices.analytics || choices.marketing) {
    trackAccepted(via);
  } else {
    trackDenied();
  }

  return choices;
}

/**
 * Flip every optional switch one way — what Accept all / Accept none press.
 * @param {object} boxes - category key → its checkbox
 * @param {boolean} checked
 */
function setAll(boxes, checked) {
  Object.keys(boxes).forEach((key) => {
    boxes[key].checked = checked;
  });
}

/**
 * One category as a pill switch: a REAL checkbox (styled by _consent.scss, not
 * replaced by one), a label bound to it, and its explanation on the input's
 * title — so the row stays dense without costing the row its meaning.
 * @param {object} spec - { id, label, description, checked, locked }
 * @returns {{ row: object, input: object }}
 */
function toggle(spec) {
  const row = document.createElement('div');
  row.className = 'omega-consent__toggle';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = spec.id;
  input.className = 'omega-consent__switch';
  input.checked = spec.checked;
  input.title = spec.description;

  if (spec.locked) {
    // Locked ON, and said out loud rather than implied by a greyed pill.
    input.disabled = true;
    input.setAttribute('aria-disabled', 'true');
    row.classList.add('omega-consent__toggle--locked');
  }

  const label = document.createElement('label');
  label.className = 'omega-consent__toggle-label';
  label.htmlFor = spec.id;
  label.textContent = spec.label;

  row.appendChild(input);
  row.appendChild(label);

  return { row: row, input: input };
}

/**
 * A real button, every time — never a div with a click handler.
 * @param {string} className
 * @param {string} text
 * @returns {object} the button element
 */
function button(className, text) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = text;

  return element;
}

/** `{terms}` / `{cookies}` in the configured copy become real links. */
function renderMessage(message) {
  return String(message)
    .replace(/\{\s*terms\s*\}/gi, policyLink('/terms', 'terms of service'))
    .replace(/\{\s*cookies\s*\}/gi, policyLink('/cookies', 'cookie policy'));
}

function policyLink(path, text) {
  return `<a href="${siteUrl(path)}" class="omega-consent__link" target="_blank" rel="noopener noreferrer">${text}</a>`;
}

/** Animate the banner out and leave the reopen tab in its place. */
function dismiss(banner, config) {
  banner.classList.remove('omega-consent--show');
  banner.classList.add('omega-consent--hide');

  setTimeout(() => {
    banner.remove();
    createTab(config);
  }, ANIMATION_MS);
}

/**
 * The small tab a settled visitor keeps — the way back into the choice, and in
 * an opt-out region the only surface a first visit ever sees.
 * @param {object} config - the resolved `client.consent.config` blob
 */
function createTab(config) {
  const tab = button('omega-consent__tab', 'Cookies Settings');
  tab.classList.add(POSITIONS[config.position] || POSITIONS['bottom-left']);
  tab.setAttribute('aria-label', 'Cookies Settings');
  tab.title = 'Cookies Settings';

  // The JS-built-DOM half of the ONE icon mechanism (docs/shared/icons.md): a
  // real `<i>` the shared renderer swaps for an inline SVG, and a FREE glyph,
  // because framework markup may never name a Pro-only icon. Decorative — the
  // button's own text is the name.
  const icon = document.createElement('i');
  icon.className = 'fa-solid fa-cookie-bite omega-consent__icon';
  icon.setAttribute('aria-hidden', 'true');
  tab.prepend(icon);

  tab.addEventListener('click', () => {
    trackPolicyReopened();
    tab.remove();
    clearTrackingDecision();
    createBanner(config);
  });

  document.body.appendChild(tab);

  setTimeout(() => tab.classList.add('omega-consent__tab--show'), 100);
}

// ─── The banner's own events (canonical names, straight onto the catalog) ───

function trackBannerShown() {
  event('cookie_banner_show', {
    event_category: 'consent',
  });
}

function trackAccepted(via) {
  event('cookie_consent_accept', {
    event_category: 'consent',
    consent_type: via,
  });
}

function trackDenied() {
  event('cookie_consent_deny', {
    event_category: 'consent',
  });
}

function trackPolicyReopened() {
  event('cookie_policy_reopen', {
    event_category: 'consent',
  });
}
