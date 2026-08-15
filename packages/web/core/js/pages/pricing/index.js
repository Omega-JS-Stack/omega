// Libraries
import { getSaleName } from '__main_assets__/js/libs/sale-name.js';
import omega from '@omega.js/client';
import { parseCountTarget, formatCount } from '@omega.js/client/modules/motion.js';

// Module
export default () => {
  return new Promise(async function (resolve) {
    // Initialize when DOM is ready
    await omega.dom().ready();

    setupBillingToggle();
    setupPlanButtons();
    setupCurrentPlanIndicator();

    // Setup promo countdown (wait until mouse is not over nav)
    waitForNavUnhover();

    // Resolve after initialization
    return resolve();
  });
};

// Configuration
const config = {
  selectors: {
    billingRadios: 'input[name="billing"]',
    amountElements: '.amount',
    billingInfoElements: '.billing-info',
    pricePerUnitElements: '.price-per-unit',
    planButtons: '.btn-primary',
    cardTitle: '.card-title'
  }
};

// Setup billing toggle functionality
function setupBillingToggle() {
  const $billingRadios = document.querySelectorAll(config.selectors.billingRadios);
  const $amountElements = document.querySelectorAll(config.selectors.amountElements);
  const $billingInfoElements = document.querySelectorAll(config.selectors.billingInfoElements);
  const $pricePerUnitElements = document.querySelectorAll(config.selectors.pricePerUnitElements);

  // Debug log to check if elements are found
  console.log('Amount elements found:', $amountElements.length);
  console.log('Billing info elements found:', $billingInfoElements.length);
  console.log('Price per unit elements found:', $pricePerUnitElements.length);

  $billingRadios.forEach(radio => {
    radio.addEventListener('change', function() {
      const billingType = this.dataset.billing;
      console.log('Billing type changed to:', billingType);

      // Update button styling for toggle buttons
      updateToggleButtons(this);

      trackPricingToggle(billingType);
      updatePricing(billingType, $amountElements, $billingInfoElements, $pricePerUnitElements);
    });
  });

  // Initialize toggle button styling on page load
  const $checkedRadio = document.querySelector(`${config.selectors.billingRadios}:checked`);
  if ($checkedRadio) {
    updateToggleButtons($checkedRadio);
  }
}

// Update toggle button styling
function updateToggleButtons(activeRadio) {
  // Find all toggle buttons (labels for the radio inputs)
  const toggleGroup = activeRadio.closest('.btn-group, .btn-group-toggle');
  if (!toggleGroup) return;

  const allButtons = toggleGroup.querySelectorAll('label.btn');

  console.log('Toggle group found:', toggleGroup);
  console.log('All buttons found:', allButtons.length);
  console.log('Active radio:', activeRadio);

  allButtons.forEach(button => {
    // Remove all button classes first
    button.classList.remove('btn-primary', 'btn-outline-adaptive');

    // Check if this button's for attribute matches the active radio's id
    const forAttribute = button.getAttribute('for');
    const isActive = forAttribute && forAttribute === activeRadio.id;

    console.log('Button for:', forAttribute, 'Radio id:', activeRadio.id, 'Is active:', isActive);

    if (isActive) {
      // Active button - make it outline primary
      button.classList.add('btn-primary');
    } else {
      // Inactive button - make it outline adaptive
      button.classList.add('btn-outline-adaptive');
    }
  });
}

// Tween a numeric text swap (prices glide between billing periods); falls
// back to an instant swap for non-numeric text or reduced motion.
const PRICE_TWEEN_MS = 450;

function animateNumericText($el, newText) {
  const from = parseCountTarget($el.textContent);
  const to = parseCountTarget(newText);

  if (!from || !to || from.value === to.value
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    $el.textContent = newText;
    return;
  }

  // Rapid toggling cancels the in-flight tween
  if ($el._priceTween) {
    cancelAnimationFrame($el._priceTween);
  }

  const start = performance.now();
  const tick = (now) => {
    const progress = Math.min((now - start) / PRICE_TWEEN_MS, 1);
    const eased = 1 - ((1 - progress) ** 3);

    if (progress < 1) {
      $el.textContent = formatCount(to, from.value + ((to.value - from.value) * eased));
      $el._priceTween = requestAnimationFrame(tick);
    } else {
      $el.textContent = newText;
      $el._priceTween = null;
    }
  };
  $el._priceTween = requestAnimationFrame(tick);
}

// Update pricing display based on billing type
function updatePricing(billingType, amountElements, billingInfoElements, pricePerUnitElements) {
  // Update prices (tweened — the numbers glide between billing periods)
  amountElements.forEach(amount => {
    const newPrice = billingType === 'monthly'
      ? amount.dataset.monthly
      : amount.dataset.annually;

    animateNumericText(amount, newPrice);
  });

  // Update billing info
  billingInfoElements.forEach(info => {
    const newText = billingType === 'monthly'
      ? info.dataset.monthly
      : info.dataset.annually;

    info.textContent = newText;
  });

  // Update price per unit (tweened, same as the headline amounts)
  pricePerUnitElements.forEach(pricePerUnit => {
    const newPricePerUnit = billingType === 'monthly'
      ? pricePerUnit.dataset.monthly
      : pricePerUnit.dataset.annually;

    animateNumericText(pricePerUnit, newPricePerUnit);
  });
}

// Setup plan button click handlers
function setupPlanButtons() {
  // Select all buttons with data-plan-id attribute
  const $planButtons = document.querySelectorAll('button[data-plan-id]');

  $planButtons.forEach(button => {
    button.addEventListener('click', function() {
      handlePlanSelection(this);
    });
  });

  // The enterprise tier is a LINK in its own row (no checkout, no cart) — the
  // browser does the navigating, we only track the intent on the way out
  document.querySelectorAll('a[data-plan-enterprise]').forEach($link => {
    $link.addEventListener('click', function() {
      trackEnterpriseContact();
    });
  });
}

// Handle plan selection
function handlePlanSelection(button) {
  const planId = button.dataset.planId;
  const planType = button.dataset.planType || 'subscription';
  const billingType = document.querySelector(`${config.selectors.billingRadios}:checked`)?.dataset.billing || 'monthly';

  if (!planId) {
    omega.sentry().captureException(new Error('Plan ID missing from button'));
    return;
  }

  // A signed-in subscriber switching plans has nothing to check out: the live
  // subscription moves, prorated, from the billing page's change-plan modal.
  // The account page opens on its billing tab and the section reads these
  // params back to open that modal preselected ([#236]).
  //
  // This returns BEFORE the add-to-cart pair below on purpose: no cart is
  // involved and no purchase follows, so firing `add_to_cart` at three
  // networks would put a conversion event on every plan switch.
  if (button.dataset.planAction === 'switch') {
    const switchUrl = new URL('/dashboard/account', window.location.origin);
    switchUrl.searchParams.set('product', planId);
    switchUrl.searchParams.set('frequency', billingType);
    switchUrl.hash = 'billing';

    window.location.href = switchUrl.toString();
    return;
  }

  // Get plan name and price for analytics
  const card = button.closest('.card');
  const planNameElement = card?.querySelector('.h3, .h2, .card-title');
  const planName = planNameElement?.textContent || planId;
  const priceElement = card?.querySelector('.amount');
  const price = priceElement ? parseFloat(priceElement.textContent) : 0;

  // Track add to cart event
  trackAddToCart(planId, planName, price, billingType, planType);

  // Log for debugging
  console.log(`Added to cart: ${planId} (${planType}, ${billingType} frequency) - $${price}`);

  // Special handling for enterprise plan
  if (planId === 'enterprise') {
    trackEnterpriseContact();
    window.location.href = '/contact';
    return;
  }

  // Build URL going directly to checkout (skip cart page)
  const url = new URL('/payment/checkout', window.location.origin);
  url.searchParams.set('product', planId);

  // Billing frequency only applies to subscriptions — one-time products
  // have a single price (payment.products type drives this via data-plan-type)
  if (planType === 'subscription') {
    url.searchParams.set('frequency', billingType);
  }

  // Redirect directly to checkout
  window.location.href = url.toString();
}

// Tracking functions
function trackPricingToggle(billingType) {
  gtag('event', 'pricing_toggle', {
    billing_type: billingType
  });
  fbq('track', 'ViewContent', {
    content_name: 'Pricing',
    content_category: billingType
  });
  ttq.track('ViewContent', {
    content_id: 'pricing-page',
    content_type: 'product',
    content_name: 'Pricing Toggle'
  });
}

function trackAddToCart(planId, planName, price, billingType, planType) {
  const items = [{
    item_id: planId,
    item_name: planName,
    item_category: planType || 'subscription',
    item_variant: billingType,
    price: price,
    quantity: 1
  }];

  // Google Analytics 4
  gtag('event', 'add_to_cart', {
    currency: 'USD',
    value: price,
    items: items
  });

  // Facebook Pixel
  fbq('track', 'AddToCart', {
    content_ids: [planId],
    content_name: planName,
    content_type: 'product',
    currency: 'USD',
    value: price
  });

  // TikTok Pixel
  ttq.track('AddToCart', {
    content_id: planId,
    content_type: 'product',
    content_name: planName,
    price: price,
    quantity: 1,
    currency: 'USD',
    value: price
  });
}

function trackEnterpriseContact() {
  gtag('event', 'contact_enterprise', {
    from_page: 'pricing'
  });
  fbq('track', 'Contact', {
    content_name: 'Enterprise Plan'
  });
  ttq.track('Contact', {
    content_id: 'enterprise-plan',
    content_type: 'product',
    content_name: 'Enterprise Plan'
  });
}

function waitForNavUnhover() {
  function checkAndRun() {
    const $nav = document.querySelector('nav');

    if (!$nav) {
      // If no nav element found, just run immediately
      setupPromoCountdown();
      return;
    }

    const isHovering = $nav.matches(':hover');

    if (isHovering) {
      // Mouse is over nav, restart timer
      setTimeout(checkAndRun, 1000);
    } else {
      // Mouse is not over nav, safe to run
      setupPromoCountdown();
    }
  }

  // Always wait 1 second first, then check
  setTimeout(checkAndRun, 1000);
}

function setupPromoCountdown() {
  const $countdownEl = document.getElementById('pricing-promo-countdown');
  const $promoTextEl = document.getElementById('pricing-promo-text');

  if (!$countdownEl || !$promoTextEl) {
    return;
  }

  const { saleName } = getSaleName();

  $promoTextEl.textContent = saleName;

  const twoDaysInMs = 2 * 24 * 60 * 60 * 1000;
  const cycleStart = Math.floor(Date.now() / twoDaysInMs) * twoDaysInMs;
  const cycleEnd = cycleStart + twoDaysInMs;

  function updateCountdown() {
    const now = new Date();
    const diff = cycleEnd - now.getTime();

    if (diff <= 0) {
      $countdownEl.textContent = '0d : 00h : 00m : 00s';
      return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = String(Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))).padStart(2, '0');
    const minutes = String(Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))).padStart(2, '0');
    const seconds = String(Math.floor((diff % (1000 * 60)) / 1000)).padStart(2, '0');

    $countdownEl.textContent = `${days}d : ${hours}h : ${minutes}m : ${seconds}s`;
  }

  // Initial call and interval setup
  updateCountdown();
  setInterval(updateCountdown, 1000);

  // Adjust navbar offset to account for banner height
  adjustNavbarOffset();
}

// Update buttons based on the user's current active plan
function setupCurrentPlanIndicator() {
  omega.auth().listen({ once: true }, (state) => {
    const resolved = omega.auth().resolveSubscription(state.account);

    if (!resolved.active) {
      return;
    }

    // Mark current plan button
    const $currentButton = document.querySelector(`button[data-plan-id="${resolved.plan}"]`);
    if ($currentButton) {
      $currentButton.disabled = true;
      $currentButton.textContent = 'Current Plan';
      $currentButton.classList.remove('btn-primary', 'btn-outline-adaptive');
      $currentButton.classList.add('btn-adaptive');
    }

    // A subscription with a cancellation already scheduled cannot switch at
    // all — the processors swap the price and leave the schedule standing, so
    // the backend refuses it and the billing page hides its Change button
    // ([#237]). Offering "Switch to this plan" here would promise a move that
    // ends in a modal that will not open: those buttons keep the CTA they were
    // authored with.
    if (state.account?.subscription?.cancellation?.pending === true) {
      return;
    }

    // Update other subscription buttons to "Switch to this plan" — one-time
    // products and the enterprise contact button keep their own CTAs. The
    // stamped action is what re-routes the click: a subscriber switching plans
    // is not buying a second one, so the button goes to the billing page's own
    // switcher rather than through checkout ([#236]).
    document.querySelectorAll('button[data-plan-id]').forEach(($button) => {
      if ($button.dataset.planId === resolved.plan || $button.dataset.planId === 'enterprise' || $button.dataset.planType !== 'subscription') {
        return;
      }
      $button.textContent = 'Switch to This Plan';
      $button.dataset.planAction = 'switch';
    });
  });
}

function adjustNavbarOffset() {
  const $promoBanner = document.getElementById('pricing-promo-banner');
  // The fixed nav the banner pushes down (classy v2's .omega-nav; .navbar-wrapper for legacy themes)
  const $nav = document.querySelector('.omega-nav, .navbar-wrapper');
  const $firstSection = document.querySelector('main > section:first-of-type');

  if (!$promoBanner || !$nav) {
    return;
  }

  // Remove hidden attribute
  $promoBanner.removeAttribute('hidden');

  // Full banner height — the banner sits entirely ABOVE the nav, never
  // bleeding into it (the nav/section transitions make the push-down glide)
  const bannerOffset = $promoBanner.offsetHeight;

  // Push navbar down to make room for banner
  $nav.style.marginTop = `${bannerOffset}px`;

  // Also increase first section padding to account for banner
  if ($firstSection) {
    const currentPadding = parseFloat(getComputedStyle($firstSection).paddingTop);
    $firstSection.style.paddingTop = `${currentPadding + bannerOffset}px`;
  }
}
