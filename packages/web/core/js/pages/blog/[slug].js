// Libraries
import omega from '@omega.js/client';
import { createLogger } from '__main_assets__/js/libs/logger.js';

const logger = createLogger('blog-post');

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

// Insert verts into blog post content
function insertBlogPostAds() {
  // Find the article content
  const $article = document.querySelector('article .blog-post-content');
  if (!$article) {
    logger.log('No article element found');
    return;
  }

  // Advertising is key-presence enabled — no config, no hosts inserted
  if (!omega.config?.advertising) {
    logger.log('No advertising config — skipping vert insertion');
    return;
  }

  // Per-post opt-out: `verts: false` frontmatter marks the article
  // (the same flag suppresses the layout's in-article unit)
  if ($article.closest('[data-omega-verts="false"]')) {
    logger.log('Post opted out of verts — skipping vert insertion');
    return;
  }

  // Get all top-level paragraphs (exclude those inside blockquotes, details, etc.)
  const $paragraphs = Array.from($article.querySelectorAll('p'))
    .filter(p => !p.closest('blockquote, details, figure'));
  if ($paragraphs.length < 3) {
    logger.log('Not enough paragraphs for vert insertion');
    return;
  }

  // Find valid positions to insert verts (every 4 paragraphs)
  // But ensure the last vert isn't too close to the end of the article
  const positions = [];
  const minParagraphsAfterLastVert = 2; // Ensure at least 2 paragraphs after the last vert

  for (let i = 0; i < $paragraphs.length; i++) {
    // Only consider every 4th paragraph
    if ((i + 1) % 4 !== 0) {
      continue;
    }

    // Skip if this position is too close to the end of the article
    const paragraphsRemaining = $paragraphs.length - 1 - i;
    if (paragraphsRemaining < minParagraphsAfterLastVert) {
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
    logger.log('No valid positions for vert insertion');
    return;
  }

  // Log vert insertion
  logger.log('Inserting', positions.length, 'verts');

  // Insert a modern vert host at each position — the shared client verts module
  // owns the whole lifecycle (lazy arming, AdSense → house fallback ladder,
  // no-fill collapse). Same markup vocabulary as the verts/unit section.
  positions.forEach((targetParagraph) => {
    const $host = document.createElement('div');
    $host.classList.add('omega-vert-unit', 'my-4');
    $host.setAttribute('data-omega-vert', 'in-article');
    $host.setAttribute('data-omega-bind', '@hide auth.resolved.active');

    // Insert after the target paragraph, then hand it to the verts module
    targetParagraph.parentNode.insertBefore($host, targetParagraph.nextSibling);
    omega.verts().mount($host);
  });
}
