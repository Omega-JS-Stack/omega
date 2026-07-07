/**
 * Verts Init Module
 * Handles lazy loading of ad units (verts) when scrolled into view.
 * Configuration is passed via data attributes on the script tag itself.
 */
import webManager from 'web-manager';

// Get search params to check for debug mode
const searchParams = new URLSearchParams(window.location.search);
const qsDebug = searchParams.get('debug') === 'true';
const qsLoud = searchParams.get('loud') === 'true';

// AdSense aggressively overrides styles with height: auto !important on ancestor elements.
// This protects height-constrained ancestors and the vert-unit itself from being tampered with.
const HEIGHT_CLASSES = ['vh-100', 'h-100', 'min-vh-100'];
const protectFromAdSenseOverrides = ($el, $vertUnit, resolvedSize) => {
  // Protect the vert-unit's max-height constraint
  if (resolvedSize) {
    new MutationObserver(() => {
      if ($vertUnit.style.getPropertyValue('max-height') !== resolvedSize) {
        $vertUnit.style.setProperty('max-height', resolvedSize, 'important');
      }
    }).observe($vertUnit, { attributes: true, attributeFilter: ['style'] });
  }

  // Protect height-constrained ancestors
  let $current = $el?.parentElement;
  while ($current && $current !== document.body) {
    if (HEIGHT_CLASSES.some((cls) => $current.classList.contains(cls))) {
      const $protected = $current;
      new MutationObserver(() => {
        if ($protected.style.height) {
          $protected.style.removeProperty('height');
        }
      }).observe($protected, { attributes: true, attributeFilter: ['style'] });
    }
    $current = $current.parentElement;
  }
};

// Main initialization
webManager.dom().ready().then(() => {
  // Get the current script element to extract configuration
  const $currentScript = document.currentScript;
  if (!$currentScript) {
    console.error('[Vert] Unable to find current script element');
    return;
  }

  // Extract configuration from data attributes
  const config = {
    client: $currentScript.getAttribute('data-ad-client'),
    slot: $currentScript.getAttribute('data-ad-slot'),
    type: $currentScript.getAttribute('data-ad-type') || 'display',
    layout: $currentScript.getAttribute('data-ad-layout'),
    style: $currentScript.getAttribute('data-ad-style') || '',
    size: $currentScript.getAttribute('data-ad-size') || '',
    vertId: $currentScript.getAttribute('data-ad-vert-id') || '',
  };

  // Log the configuration for debugging
  console.log('[Vert] Initializing ad unit:', config, $currentScript);

  // Create the ad unit with the extracted configuration
  createAdUnit(config, $currentScript);
});

// Function to load the AdSense script
const loadAdSenseScript = (config) => {
  // Check if AdSense script is already loaded
  if (window.adsbygoogle && Array.isArray(window.adsbygoogle)) {
    return Promise.resolve();
  }

  // Load the AdSense script dynamically
  return webManager.dom().loadScript({
    src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${config.client}`,
    async: true,
    crossorigin: 'anonymous',
  });
};

// Set up message handler for iframe communication (only once)
const setupMessageHandler = () => {
  // Ensure this is only set up once
  if (window.__ujVertMessageHandlerSetup) {
    return;
  }

  // Flag as set up
  window.__ujVertMessageHandlerSetup = true;

  // Listen for messages from vert iframes (validate origin)
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin && event.origin !== 'https://promo-server.itwcreativeworks.com') {
      return;
    }

    const message = event.data || {};
    const command = message.command || '';
    const payload = message.payload || {};

    // Auto-set id from iframe name (inside try/catch to prevent CORS errors)
    try {
      if (!payload.id && event.source.name) {
        payload.id = event.source.name;
      }
    } catch (e) {
      console.warn('[Vert] Failed to auto-set id', e);
    }

    // Log received message for debugging
    console.log('[Vert] Message received:', command, payload);

    // Handle commands
    if (command === 'uj-vert-unit:set-dimensions') {
      const $iframe = document.getElementById(payload.id);
      if ($iframe && payload.height) {
        $iframe.style.height = payload.height + 'px';
      }
    } else if (command === 'uj-vert-unit:click') {
      // Navigate to the URL when ad is clicked — only allow http/https schemes
      if (payload.url && /^https?:\/\//i.test(payload.url)) {
        window.location.href = payload.url;
      }
    }
  }, false);
};

// Function to monitor ad fill status
const monitorAdFillStatus = ($vertUnit, config) => {
  // Configuration for monitoring
  const maxCheckTime = 10000;
  const checkInterval = 100;
  let elapsedTime = 0;

  // Check if ad is filled or unfilled
  const checkUnfilled = () => {
    const $ins = $vertUnit.querySelector('ins.adsbygoogle');
    const status = $ins ? $ins.getAttribute('data-ad-status') : null;

    // Log status for debugging
    if (qsLoud) {
      console.log('[Vert] Checking ad status...', status);
    }

    // Handle unfilled status
    if (status === 'unfilled') {
      console.log('[Vert] Adsense is unfilled, loading fallback');
      return createCustomAd($vertUnit, config);
    }

    // Handle filled status
    if (status === 'filled') {
      console.log('[Vert] Adsense is filled, no fallback needed');
      return;
    }

    // Continue checking if within timeout
    if (elapsedTime < maxCheckTime) {
      elapsedTime += checkInterval;
      setTimeout(checkUnfilled, checkInterval);
    } else {
      // Timeout reached, load fallback
      console.log('[Vert] Adsense timed out, loading fallback');
      createCustomAd($vertUnit, config);
    }
  };

  // Start checking immediately
  checkUnfilled();
};

// Function to create custom ad
const createCustomAd = ($vertUnit, config) => {
  // Set up message handler for iframe communication
  setupMessageHandler();

  // Create the iframe element
  const $iframe = document.createElement('iframe');

  // Generate unique ID for the iframe
  const iframeId = `vert-${window.__ujVertIdCounter = (window.__ujVertIdCounter || 0) + 1}`;

  // Build base URL for the ad content
  // Use local server if debug=true OR if we're in development mode AND on promo-server
  const baseURL = (qsDebug || (webManager.isDevelopment() && webManager.config.brand.id === 'promo-server'))
    ? `${window.location.protocol}//${window.location.host}/verts/main`
    : 'https://promo-server.itwcreativeworks.com/verts/main';

  // Build full URL with parameters
  const adURL = new URL(baseURL);
  adURL.searchParams.set('parentURL', window.location.href);
  adURL.searchParams.set('frameId', iframeId);
  if (config.vertId) {
    adURL.searchParams.set('loadVertId', config.vertId);
  }

  // Set iframe attributes
  $iframe.id = iframeId;
  $iframe.name = iframeId;
  $iframe.style.cssText = config.style;
  $iframe.setAttribute('sandbox', 'allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts allow-top-navigation-by-user-activation');
  $iframe.width = '100%';
  $iframe.height = '100%';
  $iframe.setAttribute('frameborder', '0');
  $iframe.setAttribute('marginwidth', '0');
  $iframe.setAttribute('marginheight', '0');
  $iframe.setAttribute('vspace', '0');
  $iframe.setAttribute('hspace', '0');
  $iframe.setAttribute('allowtransparency', 'true');
  $iframe.setAttribute('scrolling', 'no');
  $iframe.src = adURL.toString();

  // Clear any existing content and insert the iframe
  $vertUnit.innerHTML = '';
  $vertUnit.appendChild($iframe);

  // Retrigger bindings to apply plan visibility
  webManager.auth().listen({ once: true }, async () => {
    webManager.bindings().update();
  });

  // Log success
  console.log('[Vert] Custom ad unit created');
};

// Size presets (name → max-height in pixels)
const SIZE_PRESETS = {
  banner: 150,
  leaderboard: 90,
  rectangle: 250,
  'large-rectangle': 600,
  skyscraper: 600,
};

// Resolve size value from preset name or raw pixel number
const resolveSize = (value) => {
  if (!value) {
    return '';
  }

  // Check presets first
  if (SIZE_PRESETS[value]) {
    return SIZE_PRESETS[value] + 'px';
  }

  // Treat as raw pixel value
  const num = parseInt(value, 10);
  if (!isNaN(num)) {
    return num + 'px';
  }

  return '';
};

// Function to create and insert the ad unit
const createAdUnit = (config, $currentScript) => {
  // Create ad unit elements
  const $vertUnit = document.createElement('vert-unit');

  // Set attributes and classes
  $vertUnit.className = 'uj-vert-unit';
  $vertUnit.setAttribute('data-wm-bind', '@hide auth.resolved.active');

  // Apply size constraint if specified
  let resolvedSize = '';
  if (config.size) {
    resolvedSize = resolveSize(config.size);
    $vertUnit.setAttribute('data-vert-size', config.size);
    $vertUnit.style.setProperty('max-height', resolvedSize, 'important');
    $vertUnit.style.setProperty('overflow', 'hidden');
  }

  // Protect vert-unit and height-constrained ancestors from AdSense style overrides
  protectFromAdSenseOverrides($currentScript, $vertUnit, resolvedSize);

  // Create the ins element for AdSense
  const $ins = document.createElement('ins');
  $ins.className = 'adsbygoogle';
  $ins.setAttribute('data-ad-client', config.client);

  // Configure based on ad type
  // Display ads
  if (config.type === 'display') {
    $ins.style.cssText = `display:block; ${config.style}`;
    $ins.setAttribute('data-ad-format', 'auto');
    $ins.setAttribute('data-full-width-responsive', 'true');
    if (config.slot) {
      $ins.setAttribute('data-ad-slot', config.slot);
    }
  // In-article ads
  } else if (config.type === 'in-article') {
    $ins.style.cssText = `display:block; text-align:center; ${config.style}`;
    $ins.setAttribute('data-ad-layout', 'in-article');
    $ins.setAttribute('data-ad-format', 'fluid');
    if (config.slot) {
      $ins.setAttribute('data-ad-slot', config.slot);
    }
  // In-feed ads
  } else if (config.type === 'in-feed') {
    // Map layout to AdSense layout key
    let layoutKey = config.layout || 'image-above';
    if (layoutKey === 'image-above') {
      layoutKey = '-6t+ed+2x-11-88';
    } else if (layoutKey === 'image-side') {
      layoutKey = '-fb+5w+4e-db+86';
    }

    $ins.style.cssText = `display:block; ${config.style}`;
    $ins.setAttribute('data-ad-format', 'fluid');
    $ins.setAttribute('data-ad-layout-key', layoutKey);
    if (config.slot) {
      $ins.setAttribute('data-ad-slot', config.slot);
    }
  // Multiplex ads
  } else if (config.type === 'multiplex') {
    $ins.style.cssText = `display:block; ${config.style}`;
    $ins.setAttribute('data-ad-format', 'autorelaxed');
    if (config.slot) {
      $ins.setAttribute('data-ad-slot', config.slot);
    }
  // Custom ads (our own ad server)
  } else if (config.type === 'custom') {
    $currentScript.parentNode.insertBefore($vertUnit, $currentScript);
    createCustomAd($vertUnit, config);
    return;
  // Unsupported ad type
  } else {
    console.error('[Vert] Unsupported ad type:', config.type);
    return;
  }

  // Append ins element to vert unit
  $vertUnit.appendChild($ins);

  // Insert vert unit into DOM
  $currentScript.parentNode.insertBefore($vertUnit, $currentScript);

  // Load AdSense script
  loadAdSenseScript(config)
    .then(() => {
      // Push ad unit to adsbygoogle
      (window.adsbygoogle = window.adsbygoogle || []).push({});

      // Monitor for unfilled ads
      monitorAdFillStatus($vertUnit, config);

      // Retrigger bindings to apply plan visibility
      webManager.auth().listen({ once: true }, async () => {
        webManager.bindings().update();
      });

      // Log success
      console.log('[Vert] Ad unit pushed to adsbygoogle');
    })
    .catch((error) => {
      // Handle AdSense script load failure
      console.error('[Vert] Failed to load AdSense script, loading fallback:', error);
      createCustomAd($vertUnit, config);
    });
};
