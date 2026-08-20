/**
 * Billing Section JavaScript
 */

// Libraries
import { FormManager } from '@omega.js/client/modules/form-manager.js';
import omega from '@omega.js/client';
import { createLogger } from '__main_assets__/js/libs/logger.js';
import initializeTooltips from '__main_assets__/js/libs/initialize-tooltips.js';
import { event } from '__main_assets__/js/libs/analytics.js';
import { FREQUENCIES, getAvailableFrequencies } from '../../../payment/checkout/modules/state.js';

const logger = createLogger('account:billing');

let paymentConfig = null;
let cancelFormManager = null;
let currentAccount = null;

// Whether the account's processor can do these at all is the BACKEND's answer
// (the capability gate): we attempt the route and branch on the code that comes
// back, never on a processor map here. A refusal retires the button for the
// session — the billing portal is the path that works for that processor.
let uncancelSupported = true;
let planSwitchSupported = true;
let winbackSupported = true;

// The save offer (#268) is pitched per CANCEL ATTEMPT, never once per session
// ([#324]): every fresh click on "Cancel subscription" re-evaluates
// eligibility, so a customer who declined, shut the questionnaire and came back
// to cancel is pitched again — the subscription is still live and the offer is
// still unclaimed, which is exactly the moment the pitch is for. A one-shot
// flag made the SECOND attempt the silent one, which is the state Ian's QA
// found.
//
// Only two things end the pitch, and both are facts about the account rather
// than about the click: the offer has been CLAIMED (the discount is on the
// subscription, and the backend refuses a second claim), or the backend has
// refused it in a way no retry fixes (`winbackSupported`).
let winbackClaimed = false;

// Cancellation reasons (will be shuffled on each render)
const CANCEL_REASONS = [
  'Too expensive',
  'Not using it enough',
  'Missing features I need',
  'Found a better alternative',
  'Technical issues or bugs',
  'Just testing or temporary need',
  'Other',
];

// Status display configuration (classy status pill: dot + label, never color alone)
const STATUS_CONFIG = {
  free:       { label: 'Free',      badgeClass: 'omega-status',                       dotClass: 'omega-dot omega-dot--muted' },
  active:     { label: 'Active',    badgeClass: 'omega-status omega-status--ok',     dotClass: 'omega-dot omega-dot--ok' },
  trialing:   { label: 'Active',    badgeClass: 'omega-status omega-status--ok',     dotClass: 'omega-dot omega-dot--ok' },
  cancelling: { label: 'Active',    badgeClass: 'omega-status omega-status--ok',     dotClass: 'omega-dot omega-dot--ok' },
  suspended:  { label: 'Suspended', badgeClass: 'omega-status omega-status--danger', dotClass: 'omega-dot omega-dot--danger' },
  cancelled:  { label: 'Cancelled', badgeClass: 'omega-status',                       dotClass: 'omega-dot omega-dot--muted' },
};

const FREQUENCY_LABELS = { daily: 'day', weekly: 'week', monthly: 'month', annually: 'year' };

// The cadence toggle's segment copy — the same wording the pricing page's
// billing toggle uses, for the same catalog frequencies.
const CADENCE_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', annually: 'Annually' };

// The details row's slots always render, so a value the subscription never
// recorded needs something to SAY: one placeholder word for every slot, drawn
// in the muted ink so it reads as "not known" rather than as a fact ([#236] QA
// round 3). Never an empty gap, and never `undefined`/`NaN`.
//
// Both class names are spelled out in FULL, never composed: the purge pass
// reads the built JS as content, and a class it only ever sees assembled at
// runtime is a class it deletes.
const UNKNOWN_DETAIL = 'Unknown';
const DETAIL_CLASS = 'omega-billing-detail';
const UNKNOWN_DETAIL_CLASS = 'omega-billing-detail omega-billing-detail--unknown';

// How many bullets a plan option shows in the switcher. The modal is a billing
// ACTION, not the pricing page — "Compare plans" carries the full story.
const HEADLINE_FEATURE_LIMIT = 4;

// The cadence the switcher is currently showing prices at. Set from the
// account's own cadence every time the modal opens, then by the toggle.
let switcherFrequency = null;

// The plan the PRICING page sent us here to switch to (`?product=&frequency=`),
// held from the moment the URL is read until the billing tab is on screen —
// a modal cannot open inside a section that is still `d-none`.
let pendingSwitch = null;

// Initialize billing section
export async function init() {
  setupActionButtons();
  setupTrialCancelWarning();
  setupWinbackOffer();
  setupRetentionWarning();
  setupCancellationForm();
  setupUncancelConfirm();
  setupPlanSwitcher();
}

// Load billing data
export async function loadData(account, sharedPaymentConfig) {
  if (!account) {
    return;
  }

  paymentConfig = sharedPaymentConfig;
  currentAccount = account;

  updateUI(account);
  readPlanSwitchRequest();
}

// Called when section is shown
export function onShow() {
  openRequestedPlanSwitch();
}

// ─── UI Update ──────────────────────────────────────────────

// Previewing a billing state is the dev palette's job and only its job (Ian's
// ruling, [#329]): a seeded persona shows this card a real account, so there is
// no synthetic preview path beside it to keep honest.

function updateUI(account) {
  const state = buildBillingState(account);

  omega.bindings().update(state);
  syncCancelTriggerToggle(dialogOwed(state));
  updateUsageInfo(account);
}

// Does a dialog stand in front of the questionnaire right now? ALL THREE
// pre-questionnaire steps ride the same switch: the trial warning (#267), the
// save offer (#268) and the retention warning ([#341]) each need the
// declarative collapse toggle off the trigger, and they are mutually exclusive
// by state.
//
// A step only counts if the DIALOG IT OPENS is on the page. The gate works by
// taking the trigger's toggle away, so a layout that dropped a dialog (a
// consumer override, a trimmed template) would otherwise be left with a cancel
// button that opens nothing at all — the one path in this flow that cannot be
// clicked out of ([#324]).
function dialogOwed(state) {
  return (state.billing.cancelWarning.show && !!document.getElementById('cancel-trial-warning-modal'))
    || (state.billing.winbackOffer.show && !!document.getElementById('cancel-winback-modal'))
    || (state.billing.cancelRetention.show && !!document.getElementById('cancel-retention-modal'));
}

function buildBillingState(account) {
  const subscription = account?.subscription || {};
  const resolved = omega.auth().resolveSubscription(account);
  const rawStatus = subscription.status;
  const isPaid = subscription.product?.id !== 'basic' && !!subscription.product?.id;
  const displayName = getDisplayName(subscription);

  // Map raw + resolved state to UI config
  let configKey = 'free';
  if (isPaid) {
    if (rawStatus === 'suspended') configKey = 'suspended';
    else if (rawStatus === 'cancelled') configKey = 'cancelled';
    else if (resolved.active) configKey = 'active';
  }
  const config = STATUS_CONFIG[configKey] || STATUS_CONFIG.free;

  // Pre-format alert dates
  const cancelTimestamp = subscription.cancellation?.date?.timestampUNIX;
  const cancelDate = formatDate(cancelTimestamp) || 'the end of your billing period';
  const trialEndDate = formatDate(subscription.trial?.expires?.timestampUNIX);

  // Pre-format billing details. EVERY paid state owes the user its price, its
  // cadence and a date line — the row used to gate on `resolved.active &&
  // hasValidBilling`, so a cancelled or cancelling account, the two states
  // where "when does this end?" IS the question, showed nothing at all
  // ([#236]). Every slot now RENDERS in every paid state: a piece the
  // subscription does not record shows the placeholder (the QA persona whose
  // doc carries neither price nor frequency dropped two of the three slots and
  // left the row looking half-built).
  const nextBillingUnix = subscription.expires?.timestampUNIX;
  const amount = subscription.payment?.price;
  const currency = paymentConfig?.currency || 'USD';
  const frequency = subscription.payment?.frequency;
  const amountText = (typeof amount === 'number' && amount > 0) ? formatCurrency(amount, currency) : '';
  const cadenceText = CADENCE_LABELS[frequency] || frequency || '';

  // The date line's LABEL is the claim it makes, so only a renewing
  // subscription may say "renews": a scheduled cancellation says how long
  // access lasts, an ended one says when it ended, and a suspended one — where
  // nothing is scheduled while a payment is failing — names the slot without
  // claiming a date for it.
  let dateLabel = 'Next billing';
  let dateValue = '';
  if (configKey === 'cancelled') {
    dateLabel = 'Ended';
    dateValue = formatDate(cancelTimestamp) || formatDate(nextBillingUnix);
  } else if (subscription.cancellation?.pending === true) {
    dateLabel = 'Access until';
    dateValue = formatDate(cancelTimestamp) || formatDate(nextBillingUnix);
  } else if (configKey === 'active') {
    dateLabel = 'Renews';
    dateValue = formatDate(nextBillingUnix);
  }

  // One home for "is cancelling on the table at all" — the button and the trial
  // warning that gates it both read it (#267)
  const canCancel = isPaid && rawStatus !== 'cancelled' && !resolved.cancelling;

  // And one home for "this cancel would end a TRIAL", read by the warning dialog
  // AND by the questionnaire copy behind it (#267). Two rules would eventually
  // disagree, and a form contradicting the dialog that opened it is the bug the
  // dialog exists to fix.
  const trialCancel = canCancel && resolved.trialing;

  // The save offer (#268): pitched to a PAID cancel, before the questionnaire.
  // A trial is never offered a discount on a cycle it has not paid for — its
  // access ends today (#267), so "off your next month" is the wrong sentence —
  // which is what keeps the two gates from ever wanting the same click.
  //
  // The offer itself is the brand's, resolved at BUILD time from omega.json5
  // (`payment.winback`, @omega.js/config's resolveWinbackOffer): the 50%-off
  // default has one home and the browser never applies one of its own.
  //
  // The offer is only pitchable to a subscription the apply route can REACH:
  // it discounts the live subscription at the processor, so it needs the
  // processor and the resource it holds it under. A paid, active subscription
  // can carry neither — granted by an admin, imported, a backfill that never
  // landed — and pitching that account an offer whose only button can 400 is a
  // dead end in front of the cancel it came to make ([#311]).
  const reachable = !!subscription.payment?.processor && !!subscription.payment?.resourceId;

  const offer = paymentConfig?.winback;
  const offerable = canCancel
    && !trialCancel
    && reachable
    && offer?.enabled === true
    && winbackSupported
    && !winbackClaimed
    // A claim persisted on the account ([#325]): the backend stamps the discount
    // it applied with source 'winback', so a past claimant is not re-pitched in
    // a fresh session. Only that source suppresses the pitch — a checkout code's
    // discount rides the same node with its own source and keeps the offer open.
    && subscription.discount?.source !== 'winback';

  // The fallback dialog ([#341]): a cancel the other two steps have nothing to
  // say to still gets a word before the questionnaire. Ian's QA found the hole
  // in three states, and every one of them is a real cancel walking into
  // silence: a brand that turned the offer off, a subscription the apply route
  // cannot reach, a customer who already claimed the discount.
  //
  // It is the LAST gate by construction: it reads the other two rather than
  // restating their rules, so exactly one dialog is ever owed and adding a
  // condition to either of them can never leave the click with two.
  const retentionCancel = canCancel && !offerable && !trialCancel;

  // The discount riding the subscription right now ([#325]). Accepting the save
  // offer applies a real discount at the processor and the card said nothing
  // about it at all, so the saving a customer had just been given was invisible
  // on the one page that exists to explain their billing.
  //
  // The shape is the one the whole payment stack already speaks — a
  // discount-codes validate result (`{ valid, percent | amount, duration }`),
  // the same object the apply route records and hands back — so nothing here
  // learns a second shape, and an invalid one is no discount at all.
  const discount = subscription.discount?.valid === true ? subscription.discount : null;

  return {
    billing: {
      plan: {
        name: displayName,
      },
      status: {
        label: config.label,
        badgeClass: config.badgeClass,
        dotClass: config.dotClass,
      },
      description: {
        free: !isPaid,
        active: resolved.active,
        suspended: rawStatus === 'suspended',
        cancelled: rawStatus === 'cancelled',
      },
      alerts: {
        suspended: rawStatus === 'suspended',
        cancelling: resolved.cancelling,
        trialing: resolved.trialing,
        cancelDate: cancelDate,
        trialEndDate: trialEndDate,
        trialHasEndDate: !!trialEndDate,
      },
      details: {
        visible: isPaid,
        dateLabel: dateLabel,
        date: dateValue || UNKNOWN_DETAIL,
        dateClass: detailClass(dateValue),
        amount: amountText || UNKNOWN_DETAIL,
        amountClass: detailClass(amountText),
        cadence: cadenceText || UNKNOWN_DETAIL,
        cadenceClass: detailClass(cadenceText),
      },
      // Cancelling a TRIAL ends access immediately (#267), which is the
      // opposite of what the questionnaire's own copy promises — so a trial is
      // told before it answers questions, never after. The gate reads the
      // cancel button's OWN flag rather than restating its rule: a warning that
      // could disagree with the button it guards is the bug twice.
      cancelWarning: {
        show: trialCancel,
        trialEndDate: trialEndDate,
        hasTrialEndDate: !!trialEndDate,
      },
      // What leaving MIGHT cost, for the cancel neither the offer nor the trial
      // warning speaks to ([#341]). The dialog's copy is a retention-policy
      // statement, not a threat, so all this carries is whether it is owed.
      cancelRetention: {
        show: retentionCancel,
      },
      // The questionnaire the warning hands the customer to: its explanation and
      // the checkbox they must tick both state what THIS cancel does, so a trial
      // is never asked to attest to access it will not get.
      cancelForm: {
        trial: trialCancel,
      },
      // The saving already on the subscription (#325): how much comes off, and
      // which bills it comes off. Both are TEXT — a discount announced by a
      // colored pill alone is not announced at all.
      discount: {
        show: !!discount,
        label: discount ? `${discountOffText(discount)} off` : '',
        when: discount ? discountWhenText(discount, subscription.payment?.frequency) : '',
      },
      // The save offer the customer reads before the questionnaire (#268). Its
      // wording is built here, from the brand's own numbers and the cadence the
      // subscription is billed at, so the markup carries no discount at all.
      winbackOffer: {
        show: offerable,
        headline: offerable ? winbackHeadline(offer, subscription.payment?.frequency) : '',
      },
      buttons: {
        upgrade: !isPaid || rawStatus === 'cancelled',
        change: canChangePlan(account),
        manage: isPaid && rawStatus !== 'cancelled',
        cancel: canCancel,
        // Undo reads the SAME raw flag Change does, not `resolved.cancelling`
        // (which is `pending && !trialing`): a TRIALING subscription with a
        // scheduled cancellation is reachable — the processor's own billing
        // portal schedules one — and reading the derived flag left that account
        // with neither button, a dead end on its own billing page.
        uncancel: uncancelSupported && isPaid && rawStatus === 'active' && subscription.cancellation?.pending === true,
      },
    },
  };
}

// Is a plan switch on the table at all? ONE home for the rule, read by the
// Change button and by the pricing page's preselect alike — a modal that opens
// on a plan the button would not have offered is the same bug twice.
//
// Change is hidden while a cancellation is scheduled: the processors swap the
// price, never the schedule, so the backend refuses the switch outright
// (`cancellation-pending`, [#237]). Undo cancellation is the honest button in
// that state, and this reads the SAME raw flag the backend guard does so the
// two can never disagree.
function canChangePlan(account) {
  return planSwitchSupported
    && omega.auth().resolveSubscription(account).active
    && account?.subscription?.cancellation?.pending !== true;
}

// ─── Action Buttons ──────────────────────────────────────────

function setupActionButtons() {
  const $upgradeBtn = document.getElementById('upgrade-plan-btn');
  const $changeBtn = document.getElementById('change-plan-btn');
  const $manageBtn = document.getElementById('manage-billing-btn');

  if ($upgradeBtn) {
    $upgradeBtn.addEventListener('click', () => {
      trackBilling('upgrade_click');
      window.location.href = '/pricing';
    });
  }

  // The plan switcher modal itself opens declaratively (data-bs-toggle), the
  // same way the signin link modal does — this only records the intent
  if ($changeBtn) {
    $changeBtn.addEventListener('click', () => {
      trackBilling('change_plan_click');
    });
  }

  if ($manageBtn) {
    $manageBtn.addEventListener('click', () => {
      trackBilling('manage_billing_click');
      openBillingPortal();
    });
  }
}

// ─── Billing Portal ─────────────────────────────────────────

async function openBillingPortal() {
  const $manageBtn = document.getElementById('manage-billing-btn');
  const $btnText = $manageBtn?.querySelector('.button-text');
  const originalText = $btnText?.textContent;

  try {
    // Show loading state
    if ($manageBtn) $manageBtn.disabled = true;
    if ($btnText) $btnText.textContent = 'Opening...';

    const response = await omega.request(`/omega/payments/portal`, {
      method: 'POST',
      timeout: 15000,
      body: {
        returnUrl: window.location.href,
      },
    });

    if (response.url) {
      window.open(response.url, '_blank');
    } else {
      throw new Error('No portal URL returned');
    }
  } catch (error) {
    console.error('Failed to open billing portal:', error);
    omega.utilities().showNotification(error.message || 'Failed to open billing portal. Please try again later.', 'danger');
  } finally {
    if ($manageBtn) $manageBtn.disabled = false;
    if ($btnText) $btnText.textContent = originalText;
  }
}

// ─── Undo Cancellation ──────────────────────────────────────

function setupUncancelConfirm() {
  const $confirmBtn = document.getElementById('uncancel-confirm-btn');
  if (!$confirmBtn) {
    return;
  }

  $confirmBtn.addEventListener('click', () => uncancelSubscription($confirmBtn));
}

// Withdraw the scheduled cancellation so the subscription just keeps renewing.
// Nothing is charged today — the processor resumes the existing term.
async function uncancelSubscription($confirmBtn) {
  const $btnText = $confirmBtn.querySelector('.button-text');
  const originalText = $btnText?.textContent;

  trackBilling('uncancel_submit');

  try {
    // Show loading state
    $confirmBtn.disabled = true;
    if ($btnText) $btnText.textContent = 'Resuming...';

    await omega.request(`/omega/payments/uncancel`, {
      method: 'POST',
      timeout: 30000,
      body: {
        confirmed: true,
      },
    });

    logger.log('Cancellation withdrawn:', { productId: currentAccount?.subscription?.product?.id });

    // The webhook pipeline writes the real state — patch locally so the card
    // stops saying "cancellation scheduled" the moment the route succeeds
    const currentSub = currentAccount?.subscription;
    if (currentSub) {
      currentSub.cancellation = { pending: false };
      updateUI(currentAccount);
    }

    collapseUncancelConfirm();

    omega.utilities().showNotification('Your subscription will continue as normal. You were not charged today.', 'success');
  } catch (error) {
    logger.error('Failed to withdraw cancellation:', error);

    // The processor cannot resume a subscription AT ALL (the backend's
    // capability gate). The button is a dead end for this account, so retire it
    // for the session — the message already points at the billing portal, which
    // is the "Manage billing" button right beside it.
    if (error.properties?.additional?.code === 'not-supported-by-processor') {
      uncancelSupported = false;
      updateUI(currentAccount);
      collapseUncancelConfirm();
      omega.utilities().showNotification(error.message, { type: 'warning', timeout: 8000 });
    } else {
      omega.utilities().showNotification(error.message || 'Failed to resume your subscription. Please try again later.', 'danger');
    }
  } finally {
    $confirmBtn.disabled = false;
    if ($btnText) $btnText.textContent = originalText;
  }
}

function collapseUncancelConfirm() {
  const $confirm = document.getElementById('uncancel-subscription-confirm');
  if (!$confirm) {
    return;
  }

  const bsCollapse = bootstrap.Collapse.getInstance($confirm);
  if (bsCollapse) bsCollapse.hide();
}

// ─── Plan Switcher ──────────────────────────────────────────

function setupPlanSwitcher() {
  const $modal = document.getElementById('change-plan-modal');
  if (!$modal) {
    return;
  }

  const $cadence = document.getElementById('change-plan-cadence');
  const $options = document.getElementById('change-plan-options');
  const $confirmBtn = document.getElementById('change-plan-confirm-btn');

  // Rebuild the picker every time it opens — the plan it must exclude, and the
  // cadence it opens on, are whatever the account is on right now
  $modal.addEventListener('show.bs.modal', () => {
    switcherFrequency = defaultCadence();
    renderCadenceToggle($cadence);
    populatePlanOptions($options);
    $confirmBtn.disabled = true;
  });

  // Flipping the cadence re-prices every card, which rebuilds the radios: the
  // pick does not survive it, so neither does the enabled Confirm button
  $cadence.addEventListener('change', (event) => {
    switcherFrequency = event.target.value;
    populatePlanOptions($options);
    $confirmBtn.disabled = true;
  });

  // Nothing to confirm until a plan is picked
  $options.addEventListener('change', () => {
    $confirmBtn.disabled = !getSelectedPlan();
  });

  // The WHOLE card is the target, not just the head: the feature list and the
  // card's padding are most of its area, and they were dead space — worst on
  // touch, where the head is a thin strip. Two things keep their own clicks: a
  // label (the browser already checks the radio for it, and doing it again
  // would fire a second change event) and a feature's hover explanation, whose
  // tooltip a stretched overlay would have swallowed entirely.
  $options.addEventListener('click', (event) => {
    if (event.target.closest('[data-bs-toggle="tooltip"]') || event.target.closest('label')) {
      return;
    }

    const $card = event.target.closest('.omega-plan-card');
    const $radio = $card?.previousElementSibling;

    if (!$radio || $radio.disabled || $radio.checked) {
      return;
    }

    $radio.checked = true;
    $radio.dispatchEvent(new Event('change', { bubbles: true }));
  });

  $confirmBtn.addEventListener('click', () => changePlan($confirmBtn, $modal));
}

// ─── Arriving from the pricing page ─────────────────────────

// The pricing page's "Switch to this plan" button lands here naming the plan it
// meant: `/dashboard/account?product=<id>&frequency=<cadence>#billing`
// ([#236]). Reading it is one thing and acting on it is another — the modal
// cannot open while the billing section is still `d-none` — so the request is
// read the moment the account loads and honoured when the tab is on screen.
//
// The params are consumed ONCE and struck from the URL right here: a refresh
// (or a back to this page) must not reopen a modal the user already closed.
function readPlanSwitchRequest() {
  const params = new URLSearchParams(window.location.search || '');
  const productId = params.get('product');

  if (!productId) {
    return;
  }

  pendingSwitch = { productId: productId, frequency: params.get('frequency') };

  params.delete('product');
  params.delete('frequency');

  const query = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash || ''}`);
}

// Open the switcher on the plan the pricing page named. A state that cannot
// switch at all lands on the billing tab plainly: while a cancellation is
// scheduled the Change button is hidden (the backend refuses the switch), and
// opening the modal anyway would offer a move that cannot happen.
function openRequestedPlanSwitch() {
  const request = pendingSwitch;
  pendingSwitch = null;

  const $modal = document.getElementById('change-plan-modal');
  if (!request || !$modal || !canChangePlan(currentAccount)) {
    return;
  }

  // Bootstrap's show() fires `show.bs.modal`, which is what renders the toggle
  // and the cards — so the picking below happens over the real thing.
  bootstrap.Modal.getOrCreateInstance($modal).show();

  // The cadence goes FIRST: flipping it re-prices and rebuilds every card, so
  // a plan picked before it would not survive the rebuild.
  if (request.frequency) {
    pickRadio(document.getElementById('change-plan-cadence'), (radio) => radio.value === request.frequency);
  }

  // Exactly the mechanism a card click uses — check the radio, announce it —
  // so Confirm arms the way it would have by hand.
  pickRadio(document.getElementById('change-plan-options'), (radio) => radio.value === request.productId && !radio.disabled);
}

// Check one radio inside a container and announce it the way a click does. The
// match is a PREDICATE, never a selector built from the URL.
function pickRadio($container, matches) {
  const $radio = [...($container?.querySelectorAll('input[type="radio"]') || [])].find(matches);

  if (!$radio || $radio.checked) {
    return;
  }

  $radio.checked = true;
  $radio.dispatchEvent(new Event('change', { bubbles: true }));
}

// The plans a live subscription can move to: the brand's subscription
// products, minus the free tier (leaving a paid plan is CANCELLING, not
// switching) and minus one-time purchases. The enterprise tier excludes
// itself — it carries no prices, so it is on sale at no cadence.
function switchableProducts() {
  return (paymentConfig?.products || [])
    .filter(product => (product.type || 'subscription') === 'subscription' && product.id !== 'basic');
}

// Every cadence the brand actually sells a switchable plan at, shortest first.
function availableCadences() {
  const sold = new Set(switchableProducts().flatMap(product => getAvailableFrequencies(product)));

  return FREQUENCIES.filter(frequency => sold.has(frequency));
}

// The cadence the modal opens on: the one the account is billed at, whenever
// the brand still sells it. A subscription with no recorded frequency opens on
// monthly, and a brand that doesn't sell monthly opens on its shortest cadence.
function defaultCadence() {
  const cadences = availableCadences();
  const current = currentAccount?.subscription?.payment?.frequency;

  if (current && cadences.includes(current)) {
    return current;
  }

  return cadences.includes('monthly') ? 'monthly' : (cadences[0] || 'monthly');
}

// The one cadence control, in the pricing page's own vocabulary
// (`omega-billing-toggle`): a segmented group of real radios that re-prices
// every card. A brand selling a single cadence gets no toggle — there is
// nothing to toggle between.
function renderCadenceToggle($container) {
  const cadences = availableCadences();

  // Nothing rendered means nothing reserved either — an empty container still
  // held its bottom margin, so a single-cadence brand opened on a gap.
  if (cadences.length < 2) {
    $container.innerHTML = '';
    $container.classList.add('d-none');
    return;
  }

  $container.classList.remove('d-none');

  const savings = annualSavingsPercent();

  const segments = cadences.map((frequency) => {
    const id = `change-plan-cadence-${frequency}`;
    const save = (frequency === 'annually' && savings > 0)
      ? ` <span class="omega-chip omega-chip--accent omega-billing-toggle__save ms-1">Save ${savings}%</span>`
      : '';

    return `
      <input type="radio" class="btn-check" name="change_plan_cadence" id="${id}" value="${omega.utilities().escapeHTML(frequency)}" autocomplete="off"${frequency === switcherFrequency ? ' checked' : ''}>
      <label class="btn" for="${id}">${CADENCE_LABELS[frequency] || frequency}${save}</label>
    `;
  }).join('');

  // `data-omega-segmented` is the pricing page's own attribute: the motion
  // engine injects the thumb and glides it under the checked segment. The
  // engine's MutationObserver would find this node eventually, but the modal
  // renders and opens in the same tick — scanning the container here is the
  // deterministic path, and adoption is idempotent (`omegaSegmentedReady`
  // makes a second pass a no-op). The thumb measures 0 while the modal is
  // still hidden and the engine's own ResizeObserver re-places it the moment
  // Bootstrap shows the dialog.
  $container.innerHTML = `<div class="omega-billing-toggle" role="group" aria-label="Billing cadence" data-omega-segmented>${segments}</div>`;

  omega.library?.().motion?.scan($container);
}

// The honest annual discount: the best saving the catalog really offers across
// the plans on sale, the same arithmetic the pricing page's badge runs
// (`packages/web/src/pricing.js`). Annual pricing that doesn't beat twelve
// months of monthly earns no tag.
function annualSavingsPercent() {
  let best = 0;

  for (const product of switchableProducts()) {
    const monthly = resolvePlanPrice(product, 'monthly');
    const annually = resolvePlanPrice(product, 'annually');

    if (monthly <= 0 || annually <= 0) {
      continue;
    }

    const percent = Math.round((1 - (annually / (monthly * 12))) * 100);
    if (percent > best) {
      best = percent;
    }
  }

  return best;
}

// ONE card per plan the brand sells at the cadence the toggle is on — the
// price on the card follows the toggle, so the same plan never occupies two
// rows ([#236] round 2). The plan the account is already on RENDERS —
// greyed out, badged "Current plan", not selectable — rather than
// disappearing: a plan list missing the plan you are on reads as a bug, and
// dropping it was what let a no-op switch through when the recorded frequency
// was absent.
function populatePlanOptions($container) {
  const subscription = currentAccount?.subscription || {};
  const currentProductId = subscription.product?.id;
  const currentFrequency = subscription.payment?.frequency;
  const currency = paymentConfig?.currency || 'USD';
  const frequency = switcherFrequency;

  const options = switchableProducts()
    .filter(product => getAvailableFrequencies(product).includes(frequency))
    .map(product => ({
      product: product,
      current: isCurrentPlan(product.id, frequency, currentProductId, currentFrequency),
    }));

  // Bootstrap keeps ONE instance per element and never learns the element is
  // gone: the bullets below are about to be replaced (every open, every
  // cadence flip), so retire their tooltips first or each pass leaks a set.
  disposeTooltips($container);

  if (options.length === 0) {
    $container.innerHTML = '<div class="text-muted small">There are no other plans to switch to right now.</div>';
    return;
  }

  const list = options.map(({ product, current }, i) => {
    // The bullets sit OUTSIDE the label (a list is not phrasing content), so the
    // radio points at them with aria-describedby — otherwise a screen reader
    // hears the plan's name and price and never its features.
    const featuresId = `change-plan-features-${i}`;
    const features = renderPlanFeatures(product, featuresId);
    const id = `change-plan-option-${i}`;

    return `
    <div class="omega-plan-option">
      <input class="btn-check" type="radio" name="change_plan_option" id="${id}" value="${omega.utilities().escapeHTML(product.id)}" data-frequency="${omega.utilities().escapeHTML(frequency)}" autocomplete="off"${current ? ' disabled' : ''}${features ? ` aria-describedby="${featuresId}"` : ''}>
      <div class="omega-plan-card${current ? ' omega-plan-card--current' : ''}">
        <label class="omega-plan-card__head" for="${id}">
          <span class="omega-plan-card__name">${omega.utilities().escapeHTML(product.name || product.id)}</span>
          ${current ? '<span class="omega-chip omega-plan-card__badge">Current plan</span>' : ''}
          <span class="omega-plan-card__price">${omega.utilities().escapeHTML(formatCurrency(resolvePlanPrice(product, frequency), currency))}<span class="omega-plan-card__per"> / ${FREQUENCY_LABELS[frequency] || frequency}</span></span>
        </label>
        ${features}
      </div>
    </div>
  `;
  }).join('');

  // Every card IS the current plan — a brand that sells a single plan. The
  // card still renders (the plan you are on is a fact worth seeing), with the
  // sentence that explains why nothing here is pickable.
  const nothingToPick = options.every(option => option.current)
    ? '<div class="text-muted small mt-3">There are no other plans to switch to right now.</div>'
    : '';

  $container.innerHTML = `${list}${nothingToPick}`;

  // The bullets are freshly injected, so the page-load pass never saw them
  initializeTooltips($container);
}

// Retire the tooltips of a container whose contents are about to be replaced.
function disposeTooltips($container) {
  $container.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(($el) => {
    bootstrap.Tooltip.getInstance($el)?.dispose();
  });
}

// Is this option the plan the account is on right now? When the subscription
// carries no recorded frequency, the product id alone decides — deliberately
// conservative, so BOTH cadences disable instead of offering a switch the
// backend's same-plan guard would refuse anyway ([#237]).
function isCurrentPlan(productId, frequency, currentProductId, currentFrequency) {
  if (productId !== currentProductId) {
    return false;
  }

  return !currentFrequency || frequency === currentFrequency;
}

// A plan's headline features, straight off the SAME `payment.products` catalog
// the pricing page composes its cards from — the config is the only home of this
// copy — and presented the way the pricing card presents them: a green check,
// the resolved value, and the feature's definition on hover behind the same
// dotted underline. A feature's value falls back to the product's matching
// limit, and -1 is the catalog's "unlimited" sentinel.
//
// The definition is ALSO spelled out for assistive tech: a tooltip is
// hover/focus text on an element that is neither, and these bullets are a
// radio's description rather than a stop of their own.
function renderPlanFeatures(product, id) {
  const features = (product.features || []).slice(0, HEADLINE_FEATURE_LIMIT);

  if (features.length === 0) {
    return '';
  }

  const items = features.map((feature) => {
    const value = feature.value === undefined ? product.limits?.[feature.id] : feature.value;
    const definition = resolveFeatureDefinition(feature);
    let prefix = '';

    // A value only prints when it SAYS something. `true` means "included" —
    // which the check already says — and so do `false`, `''` and absent, which
    // used to print themselves literally ("false Priority support"). A number
    // always prints, zero included: "0 Seats" beside a check is the honest
    // reading. Same visible output as the pricing composer's rule.
    if (value === -1) {
      prefix = 'Unlimited ';
    } else if (typeof value === 'number') {
      prefix = `${value.toLocaleString()} `;
    } else if (typeof value === 'string' && value !== '') {
      prefix = `${value} `;
    }

    const name = omega.utilities().escapeHTML(feature.name);
    const explained = definition
      ? `<span class="text-decoration-underline text-decoration-dotted cursor-help" data-bs-toggle="tooltip" data-bs-title="${omega.utilities().escapeHTML(definition)}">${name}</span><span class="visually-hidden"> &mdash; ${omega.utilities().escapeHTML(definition)}</span>`
      : name;

    return `<li><span class="omega-feature-check text-success"><i class="fa-solid fa-check fa-sm"></i></span><span>${omega.utilities().escapeHTML(prefix)}${explained}</span></li>`;
  });

  return `<ul class="omega-plan-card__features list-unstyled mb-0" id="${id}">${items.join('')}</ul>`;
}

// A feature's explanation, authored ONCE in the catalog: a definition on any
// product's copy of a feature explains every other copy, exactly as the pricing
// page's composer backfills them (`packages/web/src/pricing.js`).
function resolveFeatureDefinition(feature) {
  if (feature.definition) {
    return feature.definition;
  }

  for (const product of paymentConfig?.products || []) {
    const match = (product.features || []).find(other => other.id === feature.id && other.definition);
    if (match) {
      return match.definition;
    }
  }

  return null;
}

function getSelectedPlan() {
  const $selected = document.querySelector('input[name="change_plan_option"]:checked');
  if (!$selected) {
    return null;
  }

  return { productId: $selected.value, frequency: $selected.dataset.frequency };
}

// Move the live subscription onto another plan. The processor prorates the
// difference — no cancel-and-resubscribe, no second checkout.
async function changePlan($confirmBtn, $modal) {
  const selection = getSelectedPlan();
  if (!selection) {
    return;
  }

  const $btnText = $confirmBtn.querySelector('.button-text');
  const originalText = $btnText?.textContent;

  trackBilling('change_plan_submit');

  try {
    // Show loading state
    $confirmBtn.disabled = true;
    if ($btnText) $btnText.textContent = 'Changing...';

    await omega.request(`/omega/payments/plan`, {
      method: 'POST',
      timeout: 30000,
      body: {
        productId: selection.productId,
        frequency: selection.frequency,
        confirmed: true,
      },
    });

    logger.log('Plan change requested:', selection);

    // The webhook pipeline writes the real state — patch locally so the card
    // shows the plan they just picked
    const currentSub = currentAccount?.subscription;
    const product = paymentConfig?.products?.find(candidate => candidate.id === selection.productId);
    if (currentSub && product) {
      currentSub.product = { id: product.id, name: product.name };
      currentSub.payment = {
        ...currentSub.payment,
        frequency: selection.frequency,
        price: resolvePlanPrice(product, selection.frequency),
      };

      updateUI(currentAccount);
    }

    hidePlanSwitcher($modal);

    omega.utilities().showNotification(`You're now on the ${product?.name || selection.productId} plan. Your next invoice reflects the change.`, 'success');
  } catch (error) {
    logger.error('Failed to change plan:', error);

    // Same capability gate as uncancel: the processor cannot move a live
    // subscription at all, so retire the button for the session and let the
    // message send them to the billing portal
    if (error.properties?.additional?.code === 'not-supported-by-processor') {
      planSwitchSupported = false;
      updateUI(currentAccount);
      hidePlanSwitcher($modal);
      omega.utilities().showNotification(error.message, { type: 'warning', timeout: 8000 });
    } else {
      omega.utilities().showNotification(error.message || 'Failed to change your plan. Please try again later.', 'danger');
    }
  } finally {
    $confirmBtn.disabled = false;
    if ($btnText) $btnText.textContent = originalText;
  }
}

function hidePlanSwitcher($modal) {
  const bsModal = bootstrap.Modal.getInstance($modal);
  if (bsModal) bsModal.hide();
}

// ─── Trial Cancel Warning ───────────────────────────────────

// Cancelling a free trial ends access IMMEDIATELY (#267) — the opposite of what
// the questionnaire's own copy promises — so a trial is told before it answers
// questions. The "Cancel subscription" link opens the questionnaire
// declaratively, and that toggle CANNOT be intercepted from the button:
// Bootstrap's collapse data-api is a delegate on `document`, and its
// EventHandler passes `isDelegated` straight through as `useCapture`, so it
// runs on the way DOWN (`document` → button) and has already opened the
// accordion before any listener on the button — capture or bubble — is
// reached. Taking `data-bs-toggle` off the button is the only thing that stops
// it, which is what syncCancelTriggerToggle() does for a cancel that owes a
// warning; the listener below then owns that button's clicks outright. A paid
// cancel keeps the attribute, is never intercepted, and behaves exactly as it
// did.
function setupTrialCancelWarning() {
  const $trigger = document.getElementById('cancel-subscription-trigger-btn');
  const $modal = document.getElementById('cancel-trial-warning-modal');

  if (!$trigger || !$modal) {
    return;
  }

  const $accordion = document.getElementById('cancel-subscription-accordion');

  $trigger.addEventListener('click', (event) => {
    if (!needsTrialCancelWarning()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // The button is a TOGGLE, and half of a toggle is closing. With the
    // questionnaire already open the warning has been shown and answered, so
    // this click only shuts it — warning again would leave the accordion with
    // no way closed at all.
    if ($accordion?.classList.contains('show')) {
      bootstrap.Collapse.getOrCreateInstance($accordion, { toggle: false }).hide();
      return;
    }

    // Open FIRST, count second: counting is the analytics providers' business
    // and this dialog is the customer's, so a blocked snippet must never be
    // able to leave this button doing nothing at all.
    bootstrap.Modal.getOrCreateInstance($modal).show();
    trackBilling('cancel_trial_warning_shown');
  }, true);

  // While the gate holds the trigger, Bootstrap does not count it as one of the
  // collapse's triggers and stops keeping its expanded state honest. Mirror it
  // off the collapse itself, which covers every way the questionnaire opens or
  // shuts — this button, "Keep my plan" inside it, and the auto-collapse after
  // a cancel goes through.
  $accordion?.addEventListener('shown.bs.collapse', () => setCancelTriggerExpanded($trigger, true));
  $accordion?.addEventListener('hidden.bs.collapse', () => setCancelTriggerExpanded($trigger, false));

  document.getElementById('cancel-trial-continue-btn')?.addEventListener('click', () => {
    bootstrap.Modal.getInstance($modal)?.hide();

    if ($accordion) {
      bootstrap.Collapse.getOrCreateInstance($accordion, { toggle: false }).show();
    }

    trackBilling('cancel_trial_warning_continue');
  });

  document.getElementById('cancel-trial-keep-btn')?.addEventListener('click', () => {
    trackBilling('cancel_trial_warning_keep');
  });
}

// The declarative collapse toggle on the "Cancel subscription" button: ON for
// every cancel that goes straight to the questionnaire, OFF for one that owes a
// warning first (#267). Bootstrap re-reads `[data-bs-toggle="collapse"]` from
// the document on every click, so the attribute IS the switch — and it is
// driven from the SAME state that decides whether the warning is owed at all,
// so the markup and the gate can never disagree.
function syncCancelTriggerToggle(warningOwed) {
  const $trigger = document.getElementById('cancel-subscription-trigger-btn');

  if (!$trigger) {
    return;
  }

  if (warningOwed) {
    $trigger.removeAttribute('data-bs-toggle');
  } else {
    $trigger.setAttribute('data-bs-toggle', 'collapse');
  }
}

// What Bootstrap's own `_addAriaAndCollapsedClass` would do for this trigger,
// for the states where it no longer tracks it.
function setCancelTriggerExpanded($trigger, isOpen) {
  $trigger.classList.toggle('collapsed', !isOpen);
  $trigger.setAttribute('aria-expanded', isOpen);
}

// Does the account on screen owe a warning before the questionnaire? Read off
// the SAME state the bindings render, so the gate and the button it guards can
// never disagree.
function needsTrialCancelWarning() {
  return buildBillingState(currentAccount).billing.cancelWarning.show === true;
}

// ─── Winback Offer ──────────────────────────────────────────

// A customer who starts cancelling a PAID subscription is pitched a discount on
// the next cycle before they are asked why they are leaving (#268). The system
// already read a returning subscriber as a purchase (the `subscription-winback`
// transition); this is the offer made while they are still here to keep.
//
// The gate is #267's, for the same reason: the "Cancel subscription" link opens
// the questionnaire through Bootstrap's collapse data-api, which is a delegate
// on `document` running in the CAPTURE phase, so the only thing that stops it is
// taking `data-bs-toggle` off the button (syncCancelTriggerToggle) — and this
// listener then owns that button's clicks. The two gates never contend: a trial
// cancel is warned, a paid cancel is offered, and `offersWinback()` reads the
// same state the button does.
function setupWinbackOffer() {
  const $trigger = document.getElementById('cancel-subscription-trigger-btn');
  const $modal = document.getElementById('cancel-winback-modal');

  if (!$trigger || !$modal) {
    return;
  }

  const $accordion = document.getElementById('cancel-subscription-accordion');

  $trigger.addEventListener('click', (event) => {
    if (!offersWinback()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // Half of a toggle is closing: with the questionnaire already open this
    // click only shuts it, exactly as the trial gate handles its own.
    if ($accordion?.classList.contains('show')) {
      bootstrap.Collapse.getOrCreateInstance($accordion, { toggle: false }).hide();
      return;
    }

    // Open FIRST, count second — a blocked analytics snippet must never be able
    // to leave this button doing nothing ([#283], [#306]).
    bootstrap.Modal.getOrCreateInstance($modal).show();
    trackBilling('winback_offer_shown');
  }, true);

  // Declining answers THIS attempt: the questionnaire opens behind the dialog
  // and nothing is retired ([#324]). The trigger keeps its gate, so shutting the
  // questionnaire and coming back to cancel meets the offer again.
  document.getElementById('cancel-winback-decline-btn')?.addEventListener('click', () => {
    bootstrap.Modal.getInstance($modal)?.hide();

    if ($accordion) {
      bootstrap.Collapse.getOrCreateInstance($accordion, { toggle: false }).show();
    }

    trackBilling('winback_offer_declined');
  });

  const $acceptBtn = document.getElementById('cancel-winback-accept-btn');

  $acceptBtn?.addEventListener('click', () => acceptWinbackOffer($acceptBtn, $modal, $accordion));
}

// Apply the discount to the live subscription and call the cancel off. The
// route talks to the processor and the webhook pipeline writes whatever state
// changes — the subscription the customer keeps is the one they already had, so
// the only thing patched locally is the discount the route hands back, which is
// what the billing card's indicator reads ([#325]).
async function acceptWinbackOffer($acceptBtn, $modal, $accordion) {
  const $btnText = $acceptBtn.querySelector('.button-text');
  const originalText = $btnText?.textContent;

  try {
    // Show loading state
    $acceptBtn.disabled = true;
    if ($btnText) $btnText.textContent = 'Applying...';

    const response = await omega.request(`/omega/payments/winback`, {
      method: 'POST',
      timeout: 30000,
      body: {
        confirmed: true,
      },
    });

    logger.log('Winback offer accepted:', { productId: currentAccount?.subscription?.product?.id });

    claimWinbackOffer(response?.discount);

    bootstrap.Modal.getInstance($modal)?.hide();

    trackBilling('winback_offer_accepted');

    omega.utilities().showNotification('Your discount is applied to your next bill. Nothing else changes, and you can still cancel any time.', 'success');
  } catch (error) {
    logger.error('Failed to apply the winback offer:', error);

    // Same capability gate uncancel and plan-switch ride: the processor cannot
    // discount a live subscription at all, the claim has nowhere to be
    // recorded, or it was already claimed once (the offer's memory lives on the
    // order doc, which the account this card reads never carries, so a past
    // claimant IS pitched again) — either way the offer is a dead end for this
    // account, so retire it and open the questionnaire — a customer who came
    // here to cancel must never be left in a dialog that cannot answer them.
    //
    // The route names every refusal ([#311]), and the rest of them are dead
    // ends for the same reason: the brand turned the offer off since this page
    // loaded, the subscription is not the state the offer is for (ended,
    // suspended, trialing, already scheduled to cancel), or it carries no
    // processor to discount through. Pressing the button again changes none of
    // them. The one refusal LEFT OFF is `confirmation-required`: that is a
    // request that went out without its confirmation, which the same button
    // sending it again is the fix for.
    const deadEndCodes = [
      'not-supported-by-processor',
      'offer-not-claimable',
      'offer-already-claimed',
      'offer-disabled',
      'no-active-subscription',
      'trial-not-eligible',
      'cancellation-pending',
      'missing-payment-details',
      'unknown-processor',
    ];
    if (deadEndCodes.includes(error.properties?.additional?.code)) {
      winbackSupported = false;
      updateUI(currentAccount);

      bootstrap.Modal.getInstance($modal)?.hide();

      if ($accordion) {
        bootstrap.Collapse.getOrCreateInstance($accordion, { toggle: false }).show();
      }

      omega.utilities().showNotification(error.message, { type: 'warning', timeout: 8000 });
    } else {
      // A failure is not a decline: the dialog stays up so the same button can
      // be pressed again.
      omega.utilities().showNotification(error.message || 'We could not apply your discount right now. Please try again later.', 'danger');
    }
  } finally {
    $acceptBtn.disabled = false;
    if ($btnText) $btnText.textContent = originalText;
  }
}

// The offer has been CLAIMED. The discount is on the live subscription now and
// the backend refuses a second claim, so no later cancel attempt is pitched it
// again ([#324]). With nothing left to pitch, the trigger keeps its gate: the
// next click meets the retention warning ([#341]) instead of the offer.
//
// The claim's durable home is the backend's (the order doc, and whatever the
// webhook pipeline writes onto the account). The discount the route hands back
// is patched onto the account this page holds so the card's indicator ([#325])
// shows the saving in the same breath the customer earned it, exactly as the
// cancel and plan-switch paths patch what they just changed.
function claimWinbackOffer(discount) {
  winbackClaimed = true;

  const currentSub = currentAccount?.subscription;
  if (currentSub && discount?.valid === true) {
    // The route's response is the discount shape without its source; the
    // persisted doc carries source 'winback' (payments/winback/post.js), so the
    // in-session patch stamps the same ([#325]). The persisted node also
    // carries a resourceId stamp ([#333]) this patch skips: nothing on the
    // client reads it, and the next account read carries it.
    currentSub.discount = { ...discount, source: 'winback' };
  }

  updateUI(currentAccount);
}

// Is a save offer owed before the questionnaire? Read off the SAME state the
// bindings render, so the gate and the dialog can never disagree.
function offersWinback() {
  return buildBillingState(currentAccount).billing.winbackOffer.show === true;
}

// ─── Retention Warning ──────────────────────────────────────

// The cancel flow's LAST word ([#341]): a cancel that gets neither the save
// offer (#268) nor the trial warning (#267) used to reach the questionnaire
// with nothing said at all. This dialog is what it owes them: what leaving
// might cost, stated as the retention policy states it.
//
// The gate is #267's and #268's, mechanism for mechanism: Bootstrap's collapse
// data-api is a CAPTURE-phase delegate on `document`, so the only thing that
// stops it is taking `data-bs-toggle` off the trigger (syncCancelTriggerToggle),
// and this listener then owns that button's clicks. The three never contend:
// `needsRetentionWarning()` reads the same state the other two do, and that
// state only owes this dialog when neither of theirs is owed.
function setupRetentionWarning() {
  const $trigger = document.getElementById('cancel-subscription-trigger-btn');
  const $modal = document.getElementById('cancel-retention-modal');

  if (!$trigger || !$modal) {
    return;
  }

  const $accordion = document.getElementById('cancel-subscription-accordion');

  $trigger.addEventListener('click', (event) => {
    if (!needsRetentionWarning()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // Half of a toggle is closing: with the questionnaire already open this
    // click only shuts it, exactly as the other two gates handle their own.
    if ($accordion?.classList.contains('show')) {
      bootstrap.Collapse.getOrCreateInstance($accordion, { toggle: false }).hide();
      return;
    }

    // Open FIRST, count second: a blocked analytics snippet must never be able
    // to leave this button doing nothing ([#283], [#306]).
    bootstrap.Modal.getOrCreateInstance($modal).show();
    trackBilling('cancel_retention_warning_shown');
  }, true);

  document.getElementById('cancel-retention-continue-btn')?.addEventListener('click', () => {
    bootstrap.Modal.getInstance($modal)?.hide();

    if ($accordion) {
      bootstrap.Collapse.getOrCreateInstance($accordion, { toggle: false }).show();
    }

    trackBilling('cancel_retention_warning_continue');
  });

  document.getElementById('cancel-retention-keep-btn')?.addEventListener('click', () => {
    trackBilling('cancel_retention_warning_keep');
  });
}

// Is the retention warning owed before the questionnaire? Read off the SAME
// state the bindings render, so the gate and the dialog can never disagree.
function needsRetentionWarning() {
  return buildBillingState(currentAccount).billing.cancelRetention.show === true;
}

// What a discount is WORTH, in the brand's own numbers: a flat amount off in
// the brand's currency, or a percentage. ONE home, read by the offer being
// pitched (#268) and by the discount already applied (#325) — two spellings of
// the same number read as two different discounts.
function discountOffText(discount) {
  return discount.amount > 0
    ? formatCurrency(discount.amount, paymentConfig?.currency || 'USD')
    : `${discount.percent}%`;
}

// Which bills an applied discount comes off, in the cadence the subscription is
// actually billed at. A permanent cut does not promise a single cycle.
function discountWhenText(discount, frequency) {
  if (discount.duration === 'forever') {
    return 'Applied to every bill for as long as you stay';
  }

  return `Applied to your next ${FREQUENCY_LABELS[frequency] || 'bill'}`;
}

// What the offer SAYS: the brand's own number and the cadence the subscription
// is billed at, in the dialog's promotional voice (#323) — short, forward, and
// the whole pitch in one line.
function winbackHeadline(offer, frequency) {
  const off = discountOffText(offer);

  if (offer.duration === 'forever') {
    return `Take ${off} off for as long as you stay`;
  }

  return `Take ${off} off your next ${FREQUENCY_LABELS[frequency] || 'cycle'}`;
}

// ─── Cancellation Form ──────────────────────────────────────

function setupCancellationForm() {
  const $form = document.getElementById('cancel-subscription-form');
  if (!$form) {
    return;
  }

  // Populate randomized reasons
  populateCancelReasons();

  cancelFormManager = new FormManager('#cancel-subscription-form', {
    allowResubmit: false,
    warnOnUnsavedChanges: false,
    submittingText: 'Cancelling...',
    submittedText: 'Subscription Cancelled',
  });

  cancelFormManager.on('submit', async ({ data }) => {
    // Get selected reason
    const $selectedReason = document.querySelector('input[name="cancel_reason"]:checked');
    const reason = $selectedReason?.value || '';

    // Capture state BEFORE the API call — the auth listener may update currentAccount
    // with Firestore data (cancellation.pending=true) before we reach the post-cancel code
    const resolvedBeforeCancel = omega.auth().resolveSubscription(currentAccount);
    const isTrialCancel = resolvedBeforeCancel.trialing;

    logger.log('Cancelling:', { plan: resolvedBeforeCancel.plan, isTrialCancel });

    trackBilling('cancel_submit');

    const response = await omega.request(`/omega/payments/cancel`, {
      method: 'POST',
      timeout: 30000,
      body: {
        reason: reason,
        feedback: data.feedback || '',
        confirmed: true,
      },
    });

    if (response.error) {
      throw new Error(response.message || 'Failed to cancel subscription. Please try again.');
    }

    logger.log('Cancel complete:', { isTrialCancel, productId: currentAccount?.subscription?.product?.id });

    if (isTrialCancel) {
      cancelFormManager.showSuccess('Your trial has been cancelled. You\'ve been moved to the free plan. You can subscribe again anytime.');
    } else {
      cancelFormManager.showSuccess('Your subscription has been cancelled. You\'ll continue to have access until the end of your current billing period.');
    }

    // Collapse the cancel form after a short delay
    setTimeout(() => {
      const $accordion = document.getElementById('cancel-subscription-accordion');
      if ($accordion) {
        const bsCollapse = bootstrap.Collapse.getInstance($accordion);
        if (bsCollapse) bsCollapse.hide();
      }
    }, 1000);

    // Update the UI to reflect cancellation
    // Re-read currentAccount.subscription since the auth listener may have replaced it
    const currentSub = currentAccount?.subscription;
    if (currentSub) {
      if (isTrialCancel) {
        // Trial cancellations are immediate — downgrade to basic
        currentSub.status = 'cancelled';
        currentSub.product = { id: 'basic', name: 'Basic' };
        currentSub.cancellation = {
          pending: false,
          date: {
            timestamp: new Date().toISOString(),
            timestampUNIX: Math.floor(Date.now() / 1000),
          },
        };
      } else {
        // Non-trial cancellations are pending until end of billing period
        const expiresUnix = currentSub.expires?.timestampUNIX || 0;
        currentSub.cancellation = {
          pending: true,
          date: {
            timestamp: new Date(expiresUnix * 1000).toISOString(),
            timestampUNIX: expiresUnix,
          },
        };
      }

      logger.log('UI update after cancel:', { status: currentSub.status, productId: currentSub.product?.id, cancellationPending: currentSub.cancellation?.pending });

      updateUI(currentAccount);
    }
  });
}

function populateCancelReasons() {
  const $container = document.getElementById('cancel-reasons-container');
  if (!$container) {
    return;
  }

  const reasons = [...CANCEL_REASONS];
  const other = reasons.pop(); // Remove 'Other' from the end
  const shuffled = [...shuffleArray(reasons), other]; // Shuffle rest, append 'Other' last

  $container.innerHTML = shuffled.map((reason, i) => `
    <div class="form-check mb-2">
      <input class="form-check-input" type="radio" name="cancel_reason" id="cancel-reason-${i}" value="${omega.utilities().escapeHTML(reason)}">
      <label class="form-check-label" for="cancel-reason-${i}">${omega.utilities().escapeHTML(reason)}</label>
    </div>
  `).join('');
}

// ─── Usage Metrics ───────────────────────────────────────────

function updateUsageInfo(account) {
  const subscription = account.subscription || {};
  const $container = document.getElementById('usage-metrics-container');

  if (!$container) {
    return;
  }

  // Use the effective plan for usage limits (basic if cancelled/suspended)
  const resolved = omega.auth().resolveSubscription(account);
  const product = paymentConfig?.products?.find(p => p.id === resolved.plan);
  const limits = product?.limits || {};

  // Clear container
  $container.innerHTML = '';

  // Get product limits from app data
  if (!product || !limits || Object.keys(limits).length === 0) {
    $container.innerHTML = '<div class="text-muted">Usage tracking not available for this plan.</div>';
    return;
  }

  // Get actual usage from account
  const usage = account.usage || {};

  // Create a usage bar for each metric in limits
  Object.entries(limits).forEach(([metricId, limit]) => {
    const metricUsage = usage[metricId] || {};
    const used = metricUsage.period || 0;

    const isUnlimited = limit === -1;
    const usagePercent = isUnlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));

    let progressClass = 'bg-success';
    if (!isUnlimited && usagePercent >= 80) {
      progressClass = 'bg-danger';
    } else if (!isUnlimited && usagePercent >= 50) {
      progressClass = 'bg-warning';
    }

    const metricName = formatMetricName(metricId);
    const formattedUsed = formatMetricValue(metricId, used);
    const formattedLimit = isUnlimited ? '∞' : formatMetricValue(metricId, limit);

    $container.innerHTML += `
      <div class="mb-3">
        <div class="d-flex justify-content-between align-items-center mb-1">
          <small class="text-muted fw-semibold">${omega.utilities().escapeHTML(metricName)}</small>
          <small class="text-muted">${omega.utilities().escapeHTML(formattedUsed)} / ${omega.utilities().escapeHTML(formattedLimit)}</small>
        </div>
        <div class="progress" style="height: 20px;">
          <div class="progress-bar ${progressClass}" role="progressbar"
               style="width: ${usagePercent}%"
               aria-valuenow="${usagePercent}"
               aria-valuemin="0"
               aria-valuemax="100">
            ${usagePercent}%
          </div>
        </div>
      </div>
    `;
  });

  if ($container.innerHTML === '') {
    $container.innerHTML = '<div class="text-muted">No usage data available.</div>';
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function getDisplayName(subscription) {
  // Use backend-provided product name first
  if (subscription.product?.name && subscription.product.name !== 'Basic') {
    return subscription.product.name;
  }

  // Fall back to config product name
  const productId = subscription.product?.id || 'basic';
  const product = paymentConfig?.products?.find(p => p.id === productId);
  return product?.name || 'Free';
}

// A plan's price at one frequency (a price entry is either `{ amount: N }` or
// a plain `N`, the same two shapes checkout resolves)
function resolvePlanPrice(product, frequency) {
  const entry = product.prices?.[frequency];
  if (entry == null) {
    return 0;
  }

  return typeof entry === 'object' ? (entry.amount || 0) : Number(entry) || 0;
}

// How one details slot is drawn: a known value at full ink, an unknown one in
// the muted placeholder's own class.
function detailClass(value) {
  return value ? DETAIL_CLASS : UNKNOWN_DETAIL_CLASS;
}

// A UNIX timestamp as the local short date, or '' when there is no date to
// show — the caller decides what an absent date means for its own line.
function formatDate(timestampUNIX) {
  return (timestampUNIX && timestampUNIX > 0)
    ? new Date(timestampUNIX * 1000).toLocaleDateString()
    : '';
}

function formatCurrency(amount, currency) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency || 'USD').toUpperCase(),
  }).format(amount); // amount is already in display dollars
}

function formatMetricName(metricId) {
  const names = {
    requests: 'API Requests',
    tokens: 'Tokens',
    storage: 'Storage',
    bandwidth: 'Bandwidth',
    users: 'Users',
    projects: 'Projects',
  };
  return names[metricId] || metricId.charAt(0).toUpperCase() + metricId.slice(1);
}

function formatMetricValue(metricId, value) {
  if (metricId === 'storage' || metricId === 'bandwidth') {
    return formatBytes(value);
  }
  return value.toLocaleString();
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) {
    return '0 Bytes';
  }

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Tracking ────────────────────────────────────────────────

// Counting a billing action may never COST the customer that action ([#283]).
// An ad blocker does not stub these snippets, it stops them loading, so the
// names are simply never defined — and every caller here counts before it acts,
// so one ReferenceError turned "Undo cancellation" into a dead button. The
// guard this card was given first is now the ONE canonical call ([#328]): the
// catalog decides who hears `billing_action`, and the transport under it asks
// for each provider on its own — blockers work per list, so a page with Google
// allowed and Meta blocked still counts what it can.
function trackBilling(action) {
  event('billing_action', {
    action: action,
  });
}
