/**
 * Redirect Module
 * Handles intelligent redirects with querystring forwarding and development mode delays.
 * Configuration is passed via data attributes on a #redirect-config element.
 */
// Relative, not the __main_assets__ alias: modules/ builds in the legacy IIFE
// lane (src/assets.js), whose esbuild pass carries no layer-alias plugin.
import { createLogger } from '../libs/logger.js';
import { siteUrl } from '../libs/path-prefix.js';

const logger = createLogger('redirect');


const performRedirect = () => {
  // Get redirect configuration element
  const $redirectConfig = document.getElementById('redirect-config');
  if (!$redirectConfig) {
    logger.error('Configuration element #redirect-config not found');
    return;
  }

  // Extract configuration from data attributes
  const config = {
    url: $redirectConfig.getAttribute('data-url'),
    querystring: $redirectConfig.getAttribute('data-querystring'),
    siteUrl: $redirectConfig.getAttribute('data-site-url'),
    environment: $redirectConfig.getAttribute('data-environment')
  };

  // Log configuration
  logger.log('Configuration:', config);

  // Validate required configuration
  if (!config.siteUrl) {
    logger.error('Site URL is required but not provided');
    return;
  }

  // Parse URLs
  const currentUrl = new URL(window.location.href);
  const siteUrlBase = new URL(config.siteUrl);

  // Determine redirect delay — slow in any non-production environment (development OR
  // testing) so the redirect is observable; near-instant in production.
  const isNonProduction = config.environment !== 'production';
  const timeout = isNonProduction ? 3000 : 1;

  // Build redirect URL
  let redirectUrl;
  try {
    if (config.url) {
      // Handle both relative and absolute URLs
      const isAbsoluteUrl = /^https?:\/\//i.test(config.url);
      if (isAbsoluteUrl) {
        redirectUrl = new URL(config.url);
      } else {
        // Construct URL from site base, under the path the site is mounted at (#355)
        const path = config.url.startsWith('/') ? config.url : `/${config.url}`;
        redirectUrl = new URL(`${siteUrlBase.origin}${siteUrl(path)}`);
      }
    } else {
      // Default to site home page
      redirectUrl = new URL(siteUrlBase);
    }
  } catch (error) {
    logger.error('Invalid redirect URL:', config.url, error);
    redirectUrl = new URL(siteUrlBase);
  }

  // Handle querystring forwarding
  const shouldForwardQuerystring = config.querystring !== 'false' && config.querystring !== false;
  if (shouldForwardQuerystring && currentUrl.search) {
    // Merge current URL params into redirect URL
    for (const [key, value] of currentUrl.searchParams.entries()) {
      redirectUrl.searchParams.set(key, value);
    }
    logger.log(`Forwarded ${currentUrl.searchParams.size} query parameters`);
  }

  // Forward the fragment (#billing deep-links from emails/bookmarks) unless
  // the target declares its own
  if (currentUrl.hash && !redirectUrl.hash) {
    redirectUrl.hash = currentUrl.hash;
    logger.log('Forwarded fragment:', currentUrl.hash);
  }

  const finalUrl = redirectUrl.toString();

  // Log redirect details
  console.group(logger.tag, 'Configuration');
  console.log('Original URL:', config.url);
  console.log('Querystring forwarding:', shouldForwardQuerystring);
  console.log('Environment:', config.environment);
  console.log('Delay:', `${timeout}ms`);
  console.log('Final URL:', finalUrl);
  console.groupEnd();

  // Show user-friendly message in development
  if (config.environment === 'development') {
    logger.log(`Delaying redirect by ${timeout}ms for development mode`);
  }

  // Perform the redirect
  setTimeout(() => {
    window.location.href = finalUrl;
  }, timeout);
};

// Initialize based on Manager availability and DOM state
if (document.readyState === 'loading') {
  // Wait for DOM if still loading
  document.addEventListener('DOMContentLoaded', performRedirect);
} else {
  // DOM is already ready
  performRedirect();
}

