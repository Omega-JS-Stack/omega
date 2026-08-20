/**
 * Development-only utilities and features
 * This file contains code that should only run in development mode
 *
 * The tracking interceptors that used to live here are GONE (#386): they
 * monkey-patched gtag/fbq/ttq to log what passed through them, which only ever
 * saw the calls that survived the page's own guards. `@omega.js/analytics` logs
 * the whole walk itself — one tagged line per fire, per provider, including the
 * ones that were skipped and why — so there is nothing left to intercept.
 */

/* @dev-only:start */
// The palette is the ONE home for dev affordances (#342). These helpers used to
// be `window.logOpeningTags()` / `window.changeTheme()`, invocable only if you
// already knew the name to type. The import rides inside the block so a
// production build strips it with the registration.
import { registerDevSection } from '__main_assets__/js/core/dev-sections.js';
/* @dev-only:end */

export default function () {
  // Main log
  console.log('⚠️ Enabling development mode features!');

  // Setup handlers
  setupHandlers();

  // Setup helpers
  setupHelpers();

  // Setup breakpoint logger
  setupBreakpointLogger();
}

function setupHandlers() {
  // Add development click handler
  document.addEventListener('click', function (event) {
    console.log('Click', event.target);
  });
}

function setupHelpers() {
  // Hand the palette a button per helper — the panel is where you FIND them,
  // instead of having to already know the name (#342).
  /* @dev-only:start */
  registerDevSection('tools', {
    title: 'Tools',
    buildNode: (doc) => {
      const wrap = doc.createElement('div');
      wrap.className = 'omega-devbar__grid';

      [
        ['Log opening tags', () => logOpeningTags()],
        ['Toggle theme', () => changeTheme()],
      ].forEach(([label, run]) => {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'omega-devbar__btn';
        button.textContent = label;
        button.addEventListener('click', run);
        wrap.appendChild(button);
      });

      return wrap;
    },
  });
  /* @dev-only:end */
}

// Log opening tags of common HTML elements
function logOpeningTags(detail) {
  const tags = ['html', 'body', 'nav', 'main', 'footer'];

  // Convert detail to array if provided
  const detailTags = detail ? (Array.isArray(detail) ? detail : [detail]) : [];

  // Log opening tags and add innerHTML for matching detail tags
  const result = tags.map(tag => {
    const el = document.querySelector(tag);
    if (!el) return `<!-- ${tag} not found -->`;

    const openingTag = getOpeningTag(tag);

    // If this tag matches detail, include innerHTML
    if (detailTags.includes(tag)) {
      const innerHTML = el.innerHTML.trim();
      return `${openingTag}\n${innerHTML}\n</${el.tagName.toLowerCase()}>`;
    }

    return openingTag;
  }).join('\n\n');

  // Log the result
  console.log('Opening tags:\n', result);
}

// Change theme to the argument or flip it
function changeTheme(theme) {
  const currentTheme = document.documentElement.getAttribute('data-bs-theme');
  if (theme) {
    document.documentElement.setAttribute('data-bs-theme', theme);
  } else {
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-bs-theme', newTheme);
  }
  console.log(`Theme changed to: ${document.documentElement.getAttribute('data-bs-theme')}`);
}

function getOpeningTag(tagName) {
  const el = document.querySelector(tagName);
  if (!el) return '';
  const attrs = Array.from(el.attributes)
    .map(attr => ` ${attr.name}="${attr.value}"`)
    .join('');
  return `<${el.tagName.toLowerCase()}${attrs}>`;
}

function setupBreakpointLogger() {
  let lastBreakpoint = null;

  function getCurrentBreakpoint() {
    const width = window.innerWidth;

    if (width >= 1400) return 'xxl';
    if (width >= 1200) return 'xl';
    if (width >= 992) return 'lg';
    if (width >= 768) return 'md';
    if (width >= 576) return 'sm';
    return 'xs';
  }

  function logBreakpoint() {
    const breakpoint = getCurrentBreakpoint();

    if (breakpoint !== lastBreakpoint) {
      const width = window.innerWidth;
      console.log(`📱 Current breakpoint: ${breakpoint} (${width}px)`);
      lastBreakpoint = breakpoint;
    }
  }

  // Log breakpoint on page load
  logBreakpoint();

  // Log breakpoint on resize
  let resizeTimeout;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(logBreakpoint, 100);
  });
}
