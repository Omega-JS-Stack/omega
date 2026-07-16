// Libraries
import omega from '@omega.js/client';

// Module
export default () => {
  return new Promise(async function (resolve) {
    // Initialize when DOM is ready
    await omega.dom().ready();

    insertBlogPostAds();
    setupReadingProgress();

    // Resolve after initialization
    return resolve();
  });
};

// Reading progress — fill [data-read-progress] as the article scrolls by.
// rAF-throttled; no element (a theme without the bar) = no-op.
function setupReadingProgress() {
  const $bar = document.querySelector('[data-read-progress]');
  const $article = document.querySelector('article');
  if (!$bar || !$article) {
    return;
  }

  let ticking = false;
  const update = () => {
    ticking = false;
    const rect = $article.getBoundingClientRect();
    const total = rect.height - window.innerHeight;
    const progress = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 1;
    $bar.style.transform = `scaleX(${progress})`;
  };

  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });
  update();
}

// Insert ads into blog post content
function insertBlogPostAds() {
  // Find the article content
  const $article = document.querySelector('article .blog-post-content');
  if (!$article) {
    console.log('[Blog Post] No article element found');
    return;
  }

  // Get ad configuration from window.Configuration (set by Jekyll)
  const adClient = window.Configuration?.advertising?.providers?.['google-adsense']?.client;
  const adSlot = window.Configuration?.advertising?.providers?.['google-adsense']?.['in-article-slot'];
  const adLayout = 'in-article';
  const adFormat = 'fluid';

  // Get all top-level paragraphs (exclude those inside blockquotes, details, etc.)
  const $paragraphs = Array.from($article.querySelectorAll('p'))
    .filter(p => !p.closest('blockquote, details, figure'));
  if ($paragraphs.length < 3) {
    console.log('[Blog Post] Not enough paragraphs for ad insertion');
    return;
  }

  // Find valid positions to insert ads (every 4 paragraphs)
  // But ensure the last ad isn't too close to the end of the article
  const positions = [];
  const minParagraphsAfterLastAd = 2; // Ensure at least 2 paragraphs after the last ad

  for (let i = 0; i < $paragraphs.length; i++) {
    // Only consider every 4th paragraph
    if ((i + 1) % 4 !== 0) {
      continue;
    }

    // Skip if this position is too close to the end of the article
    const paragraphsRemaining = $paragraphs.length - 1 - i;
    if (paragraphsRemaining < minParagraphsAfterLastAd) {
      continue;
    }

    const $p = $paragraphs[i];
    const $prevSibling = $p.previousElementSibling;

    // Skip if previous sibling is an image or heading
    if ($prevSibling) {
      const isAfterImage = $prevSibling.tagName === 'IMG' || $prevSibling.tagName === 'PICTURE' || $prevSibling.querySelector('img');
      const isAfterHeading = /^H[1-6]$/.test($prevSibling.tagName);

      if (isAfterImage || isAfterHeading) {
        continue;
      }
    }

    positions.push($p);
  }

  if (positions.length === 0) {
    console.log('[Blog Post] No valid positions for ad insertion');
    return;
  }

  // Get configuration from Manager
  const adConfig = {
    client: adClient,
    type: 'in-article',
    slot: adSlot,
    layout: adLayout,
    format: adFormat,
  };

  // Log ad insertion
  console.log('[Blog Post] Inserting', positions.length, 'ads', adConfig);

  // Insert ads at each position
  positions.forEach((targetParagraph, index) => {
    // Create div with data-lazy script configuration
    const $adContainer = document.createElement('div');

    // Build data-lazy object
    const lazyConfig = {
      src: `${window.location.origin}/assets/js/modules/vert.bundle.js?cb=${omega.config.buildTime}`,
      attributes: {
        'data-ad-client': adConfig.client,
        'data-ad-type': adConfig.type,
        'data-ad-slot': adConfig.slot,
        'data-ad-layout': adConfig.layout,
        'data-ad-format': adConfig.format,
        'async': ''
      }
    };

    // Set data-lazy attribute
    $adContainer.setAttribute('data-lazy', `@script ${JSON.stringify(lazyConfig)}`);
    $adContainer.classList.add('my-4');

    // Insert after the target paragraph
    targetParagraph.parentNode.insertBefore($adContainer, targetParagraph.nextSibling);

    // Log each insertion
    console.log('[Blog Post] Inserted ad #' + (index + 1), lazyConfig);
  });

  // Final log
  console.log('[Blog Post] Blog post ads inserted');
}
