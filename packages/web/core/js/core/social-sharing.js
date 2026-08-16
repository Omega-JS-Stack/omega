import omega from '@omega.js/client';
import { trackGoogle, trackMeta, trackTikTok } from '__main_assets__/js/libs/analytics.js';

// Social Sharing Module
export default function () {

  // Configuration with defaults merged with supplied config
  const config = omega.config.socialSharing.config;

  // Platform configurations. Button colors are CSS-owned
  // (core/_social-sharing.scss keys off the social-share-<platform> class) so
  // themes can restyle without fighting inline styles.
  const platforms = {
    facebook: {
      name: 'Facebook',
      icon: 'brands/facebook',
      shareUrl: 'https://www.facebook.com/sharer/sharer.php?u={ url }'
    },
    twitter: {
      name: 'X',
      icon: 'brands/x-twitter',
      shareUrl: 'https://twitter.com/intent/tweet?url={ url }&text={ title }'
    },
    linkedin: {
      name: 'LinkedIn',
      icon: 'brands/linkedin',
      shareUrl: 'https://www.linkedin.com/sharing/share-offsite/?url={ url }'
    },
    pinterest: {
      name: 'Pinterest',
      icon: 'brands/pinterest',
      shareUrl: 'https://pinterest.com/pin/create/button/?url={ url }&description={ title }'
    },
    reddit: {
      name: 'Reddit',
      icon: 'brands/reddit',
      shareUrl: 'https://reddit.com/submit?url={ url }&title={ title }'
    },
    whatsapp: {
      name: 'WhatsApp',
      icon: 'brands/whatsapp',
      shareUrl: 'https://api.whatsapp.com/send?text={ title }%20{ url }'
    },
    telegram: {
      name: 'Telegram',
      icon: 'brands/telegram',
      shareUrl: 'https://t.me/share/url?url={ url }&text={ title }'
    },
    email: {
      name: 'Email',
      icon: 'regular/envelope',
      shareUrl: 'mailto:?subject={ title }&body={ title }%20{ url }'
    },
    copy: {
      name: 'Copy Link',
      icon: 'solid/link',
      handler: copyToClipboard
    }
  };

  // Wait for DOM to be ready
  omega.dom().ready().then(() => {
    initSocialSharing();
  });

  function initSocialSharing() {
    // Find all social sharing containers
    const $containers = document.querySelectorAll(config.selector);

    // Quit if no containers found
    if ($containers.length === 0) {
      console.warn('No social sharing containers found');
      return;
    }

    // Setup each container
    $containers.forEach($container => {
      setupContainer($container);
    });
  }

  function setupContainer($container) {
    // Check if already initialized
    if ($container.hasAttribute('data-social-share-initialized')) {
      return;
    }

    // Get configuration from data attributes
    const shareConfig = getShareConfig($container);

    // Clear existing content if any
    $container.innerHTML = '';

    // Add Bootstrap spacing classes to container
    $container.classList.add('d-flex', 'flex-wrap', 'gap-2');

    // Create buttons for each platform
    shareConfig.platforms.forEach(platformKey => {
      const platform = platforms[platformKey];
      if (!platform) {
        console.warn(`Unknown social platform: ${platformKey}`);
        return;
      }

      const $button = createShareButton(platform, platformKey, shareConfig);
      $container.appendChild($button);
    });

    // Mark as initialized
    $container.setAttribute('data-social-share-initialized', 'true');
  }

  function getShareConfig($container) {
    // Get data from container attributes or use defaults
    const url = $container.getAttribute('data-url') || window.location.href;
    const title = $container.getAttribute('data-title') || document.title;
    const $descriptionMeta = document.querySelector('meta[name="description"]');
    const description = $container.getAttribute('data-description') ||
                        $descriptionMeta?.content || '';
    const $imageMeta = document.querySelector('meta[property="og:image"]');
    const image = $container.getAttribute('data-image') ||
                  $imageMeta?.content || '';

    // Get platforms list
    const platformsAttr = $container.getAttribute('data-platforms');
    const platformsList = platformsAttr ?
                          platformsAttr.split(',').map(p => p.trim()) :
                          config.defaultPlatforms;

    // Get display options
    const showLabels = $container.hasAttribute('data-labels') ?
                       $container.getAttribute('data-labels') !== 'false' :
                       config.showLabels;
    const buttonSize = $container.getAttribute('data-size') || 'sm';

    return {
      url: url,
      title: title,
      description: description,
      image: image,
      platforms: platformsList,
      showLabels,
      buttonSize
    };
  }

  function createShareButton(platform, platformKey, shareConfig) {
    const $button = document.createElement('button');

    // Add classes
    $button.className = `btn btn-${shareConfig.buttonSize} social-share-btn social-share-${platformKey} align-items-center justify-content-center ${config.buttonClass}`;

    $button.setAttribute('data-platform', platformKey);

    // Icon — plain fa-* markup; the client icon-renderer resolves it through
    // the best-first asset chain (no hardcoded CDN URL — docs/shared/icons.md).
    const [iconFamily, iconName] = platform.icon.split('/');
    const $icon = document.createElement('i');
    $icon.classList.add(`fa-${iconFamily}`, `fa-${iconName}`, 'fa-md');
    $button.appendChild($icon);

    // Add tooltip for accessibility
    $button.setAttribute('title', `Share on ${platform.name}`);
    $button.setAttribute('aria-label', `Share on ${platform.name}`);

    // Add label if needed
    if (shareConfig.showLabels) {
      const $label = document.createElement('span');
      $label.textContent = platform.name;
      $label.classList.add('ms-2');
      $button.appendChild($label);
    }

    // Add click handler
    $button.addEventListener('click', (e) => {
      e.preventDefault();
      handleShare(platform, platformKey, shareConfig);
    });

    return $button;
  }

  function handleShare(platform, platformKey, shareConfig) {
    // If platform has custom handler, use it
    if (platform.handler) {
      platform.handler(shareConfig);

      return;
    }

    // Build share URL using URL constructor
    const baseUrl = platform.shareUrl.split('?')[0];
    const url = new URL(baseUrl);

    // Parse the template and set search params
    const templateParams = platform.shareUrl.split('?')[1];
    if (templateParams) {
      const params = new URLSearchParams(templateParams);
      params.forEach((value, key) => {
        let paramValue = value;
        paramValue = paramValue.replace('{ url }', shareConfig.url);
        paramValue = paramValue.replace('{ title }', shareConfig.title);
        paramValue = paramValue.replace('{ description }', shareConfig.description);
        paramValue = paramValue.replace('{ image }', shareConfig.image);
        url.searchParams.set(key, paramValue);
      });
    }

    const shareUrl = url.toString();

    // Open in new window or tab
    if (config.openInNewWindow && platformKey !== 'email') {
      const windowFeatures = `width=${config.windowWidth},height=${config.windowHeight},menubar=no,toolbar=no,resizable=yes,scrollbars=yes`;
      window.open(shareUrl, `share-${platformKey}`, windowFeatures);
    } else {
      // Open new tab
      window.open(shareUrl, `_blank`);
    }

    // Track share event
    trackShare(platformKey, shareConfig);
  }

  function copyToClipboard(shareConfig) {
    const url = shareConfig.url;

    // Use omega utility for clipboard copy
    omega.utilities().clipboardCopy(url);

    // Show success message
    showCopySuccess();

    // Track
    trackCopyLink(shareConfig);
  }

  function showCopySuccess() {
    // Find the copy button and temporarily change its text/icon
    const $copyButtons = document.querySelectorAll('[data-platform="copy"]');
    $copyButtons.forEach($button => {
      const $iconImg = $button.querySelector('img[data-icon-type="share"]');
      const $label = $button.querySelector('span:not(.me-2)');

      // Store original src/text
      const originalIconSrc = $iconImg?.src;
      const originalLabel = $label?.textContent;

      // Change to success state
      if ($iconImg) {
        $iconImg.src = `${ICON_BASE_URL}/solid/check.svg`;
      }
      if ($label) {
        $label.textContent = 'Copied!';
      }

      // Revert after 2 seconds
      setTimeout(() => {
        if ($iconImg && originalIconSrc) {
          $iconImg.src = originalIconSrc;
        }
        if ($label && originalLabel) {
          $label.textContent = originalLabel;
        }
      }, 2000);
    });
  }

  // Tracking functions
  function trackShare(platformKey, shareConfig) {
    const platformName = platforms[platformKey]?.name || platformKey;

    trackGoogle('event', 'share', {
      method: platformKey,
      content_type: 'article',
      item_id: shareConfig.url
    });

    trackMeta('track', 'Share', {
      content_name: shareConfig.title,
      content_url: shareConfig.url,
      share_method: platformKey
    });

    trackTikTok('Share', {
      content_id: `social-share-${platformKey}`,
      content_type: 'product',
      content_name: `Social Share ${platformName}`
    });
  }

  function trackCopyLink(shareConfig) {
    trackGoogle('event', 'copy_link', {
      content_type: 'share',
      item_id: shareConfig.url
    });

    trackMeta('trackCustom', 'CopyLink', {
      content_url: shareConfig.url
    });

    trackTikTok('ClickButton', {
      content_id: 'social-share-copy-link',
      content_type: 'product',
      content_name: 'Social Share Copy Link'
    });
  }
};
