/**
 * Ghostii API client — mirror of @omega.js/backend's Ghostii client
 * (@omega.js/backend src/manager/libraries/content/ghostii.js). The SSOT for
 * the request shape is @omega.js/backend; keep this in sync when it changes.
 *
 * Raw Cloud Functions URL (not api.ghostii.ai) to get the 5-min function
 * timeout instead of Firebase Hosting's hard 60s proxy timeout.
 */

const GHOSTII_WRITE_URL = 'https://us-central1-ghostii.cloudfunctions.net/writeGlobal/write/article';

// Ghostii API caps
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_SOURCE_CONTENT_LENGTH = 16000;

/**
 * node-powertools' random({ mode: 'gaussian' }) equivalent — the mean of two
 * uniform draws biases toward the middle of the range.
 *
 * @param {number} min - Inclusive lower bound
 * @param {number} max - Inclusive upper bound
 * @returns {number} Integer in [min, max]
 */
function gaussianRandomInt(min, max) {
  const draw = () => min + Math.random() * (max - min);

  return Math.round((draw() + draw()) / 2);
}

/**
 * Generate an article via the Ghostii API.
 *
 * @param {object} args
 * @param {object} args.brandConfig - Merged brand config
 * @param {string} args.description - Article brief (truncated to Ghostii's 2KB cap)
 * @param {string[]} [args.links] - URLs to inject into the article body
 * @param {string} [args.sourceContent] - Reference text (the commit digest; 16KB cap)
 * @param {object} [args.overrides] - Ghostii API param overrides (length, research, images, ...)
 * @returns {Promise<object>} Ghostii's generic article response
 *   ({ title, description, body, json, headerImageUrl, categories, keywords, ... })
 */
async function writeArticle({ brandConfig, description, links = [], sourceContent, overrides = {} }) {
  if (!process.env.OMEGA_ADMIN_KEY) {
    throw new Error('OMEGA_ADMIN_KEY is not set — required to call the Ghostii API (brand or company .env)');
  }

  const { brand } = brandConfig;

  const body = {
    backendManagerKey: process.env.OMEGA_ADMIN_KEY,
    keywords: overrides.keywords || [],
    description: description.slice(0, MAX_DESCRIPTION_LENGTH),
    insertLinks: overrides.insertLinks ?? true,
    research: overrides.research ?? true,
    insertImages: overrides.insertImages ?? true,
    length: overrides.length || 'long',
    maxLinks: overrides.maxLinks || 6,
    headerImageUrl: overrides.headerImageUrl || 'unsplash',
    url: brand.url,
    sectionQuantity: overrides.sectionQuantity || gaussianRandomInt(3, 6),
    feedUrl: overrides.feedUrl || `${brand.url}/feeds/posts.json`,
    links,
  };

  if (sourceContent) {
    body.sourceContent = sourceContent.slice(0, MAX_SOURCE_CONTENT_LENGTH);
  }

  const response = await fetch(GHOSTII_WRITE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`Ghostii API ${response.status}: ${detail || response.statusText}`);
  }

  return response.json();
}

/**
 * Transform Ghostii's JSON block array into a clean post shape.
 * Mirror of @omega.js/backend's blocksToPost(): title ← first heading-1, headerImageUrl ←
 * first image block, body ← every remaining block joined as markdown (no
 * title embedded).
 *
 * @param {Array} json - Ghostii's block array ([{ name, content }])
 * @returns {{ title: string, headerImageUrl: string, body: string }}
 */
function blocksToPost(json) {
  const blocks = Array.isArray(json) ? json : [];

  const titleBlock = blocks.find((b) => b.name === 'heading-1');
  const imageBlock = blocks.find((b) => b.name === 'image');

  const title = (titleBlock?.content || '').replace(/^#+\s*/, '').trim();

  const imageMatch = (imageBlock?.content || '').match(/\((.*?)\)\s*$/);
  const headerImageUrl = imageMatch ? imageMatch[1] : '';

  const body = blocks
    .filter((b) => b !== titleBlock && b !== imageBlock)
    .map((b) => b.content)
    .join('\n\n')
    .trim();

  return { title, headerImageUrl, body };
}

module.exports = {
  writeArticle,
  blocksToPost,
  MAX_DESCRIPTION_LENGTH,
  MAX_SOURCE_CONTENT_LENGTH,
};
