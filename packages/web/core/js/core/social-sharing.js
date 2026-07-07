import webManager from 'web-manager';

// Social Sharing Module
export default function () {

  // Configuration with defaults merged with supplied config
  const config = webManager.config.socialSharing.config;

  // CDN base URL for Font Awesome SVG icons
  const ICON_BASE_URL = 'https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@7.0.0/svgs';

  // Platform configurations
  const platforms = {
    facebook: {
      name: 'Facebook',
      icon: 'brands/facebook',
      color: '#1877F2',
      shareUrl: 'https://www.facebook.com/sharer/sharer.php?u={ url }'
    },
    twitter: {
      name: 'X',
      icon: 'brands/x-twitter',
      color: '#000000',
      shareUrl: 'https://twitter.com/intent/tweet?url={ url }&text={ title }'
    },
    linkedin: {
      name: 'LinkedIn',
      icon: 'brands/linkedin',
      color: '#0077B5',
      shareUrl: 'https://www.linkedin.com/sharing/share-offsite/?url={ url }'
    },
    pinterest: {
      name: 'Pinterest',
      icon: 'brands/pinterest',
      color: '#E60023',
      shareUrl: 'https://pinterest.com/pin/create/button/?url={ url }&description={ title }'
    },
    reddit: {
      name: 'Reddit',
      icon: 'brands/reddit',
      color: '#FF4500',
      shareUrl: 'https://reddit.com/submit?url={ url }&title={ title }'
    },
    whatsapp: {
      name: 'WhatsApp',
      icon: 'brands/whatsapp',
      color: '#25D366',
      shareUrl: 'https://api.whatsapp.com/send?text={ title }%20{ url }'
    },
    telegram: {
      name: 'Telegram',
      icon: 'brands/telegram',
      color: '#0088CC',
      shareUrl: 'https://t.me/share/url?url={ url }&text={ title }'
    },
    email: {
      name: 'Email',
      icon: 'regular/envelope',
      color: '#6c757d',
      shareUrl: 'mailto:?subject={ title }&body={ title }%20{ url }'
    },
    copy: {
      name: 'Copy Link',
      icon: 'solid/link',
      color: '#6c757d',
      handler: copyToClipboard
    }
  };

  // Wait for DOM to be ready
  webManager.dom().ready().then(() => {
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

    // Add custom styles for platform color
    $button.style.backgroundColor = platform.color;
    $button.style.borderColor = platform.color;
    $button.style.color = '#ffffff';
    // $button.style.display = 'inline-flex';

    // Add hover effect inline (will be moved to CSS)
    $button.setAttribute('data-platform', platformKey);

    // Create SVG icon
    const $iconWrapper = document.createElement('span');
    $iconWrapper.classList.add('fa', 'fa-md');

    const $iconImg = document.createElement('img');
    $iconImg.setAttribute('data-lazy', `@src ${ICON_BASE_URL}/${platform.icon}.svg`);
    $iconImg.alt = '';
    $iconImg.classList.add('filter-white');
    $iconImg.setAttribute('data-icon-type', 'share');

    $iconWrapper.appendChild($iconImg);
    $button.appendChild($iconWrapper);

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

    // Use webManager utility for clipboard copy
    webManager.utilities().clipboardCopy(url);

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

    gtag('event', 'share', {
      method: platformKey,
      content_type: 'article',
      item_id: shareConfig.url
    });

    fbq('track', 'Share', {
      content_name: shareConfig.title,
      content_url: shareConfig.url,
      share_method: platformKey
    });

    ttq.track('Share', {
      content_id: `social-share-${platformKey}`,
      content_type: 'product',
      content_name: `Social Share ${platformName}`
    });
  }

  function trackCopyLink(shareConfig) {
    gtag('event', 'copy_link', {
      content_type: 'share',
      item_id: shareConfig.url
    });

    fbq('trackCustom', 'CopyLink', {
      content_url: shareConfig.url
    });

    ttq.track('ClickButton', {
      content_id: 'social-share-copy-link',
      content_type: 'product',
      content_name: 'Social Share Copy Link'
    });
  }
};
