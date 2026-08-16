/**
 * Blog Page JavaScript
 *
 * Blog search, self-contained: the build emits /blog/index.json (every post's
 * title, description, date and taxonomy) and this module fetches it ONCE, on
 * first use, then filters it in the browser. No search library, no third-party
 * widget, no query leaving the site.
 */

// Libraries
import omega from '@omega.js/client';
import { createLogger } from '__main_assets__/js/libs/logger.js';
import { search, formatDate, createIndexLoader } from './_search.mjs';
import { trackGoogle, trackMeta, trackTikTok } from '__main_assets__/js/libs/analytics.js';

const logger = createLogger('blog-search');

// The build-emitted index (defaults/pages/blog/index-json.html)
const INDEX_URL = '/blog/index.json';

// Module
// (The newsletter form binding moved to the section that renders it —
// themes/base/_sections/marketing/newsletter-cta/section.js, initialized
// by the §7 presence init on any page composing the band.)
export default () => {
  return new Promise(async function (resolve) {
    // Initialize when DOM is ready
    await omega.dom().ready();

    setupSearch();

    // Resolve after initialization
    return resolve();
  });
};

// Setup blog search functionality
function setupSearch() {
  const $input = document.getElementById('blog-search');
  const $results = document.getElementById('blog-search-results');
  const $listing = document.querySelector('[data-blog-listing]');

  // A theme without the search surface renders no input — nothing to wire
  if (!$input || !$results || !$listing) {
    return;
  }

  let searchTimeout;

  // Lazy index load — the first focus (or a ?q= deep link) pays for it, a
  // visitor who never searches never downloads it, and the loader hands every
  // later query the same entries
  const loadIndex = createIndexLoader(INDEX_URL, logger);

  const run = async (query) => {
    if (!query) {
      showListing($results, $listing);
      return;
    }

    const entries = await loadIndex();

    // The index never arrived (404, offline, bad JSON) — say so instead of
    // rendering "no results", which would be a lie
    if (!entries) {
      renderUnavailable($results, $listing);
      return;
    }

    render($results, $listing, search(entries, query), query);
    trackBlogSearch(query);
  };

  $input.addEventListener('focus', loadIndex, { once: true });

  // Handle search input
  $input.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();

    // Restoring the listing is instant; querying is debounced
    if (!query) {
      run('');
      return;
    }

    searchTimeout = setTimeout(() => run(query), 200);
  });

  // The form-less input still answers Enter: search now, no page load
  $input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(searchTimeout);
      run($input.value.trim());
    }
  });

  // Add keyboard shortcut (Ctrl/Cmd + K)
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      $input.focus();
      $input.select();
    }
  });

  // Deep link: /blog?q=… (the site's SearchAction + OpenSearch target)
  const initialQuery = (new URL(window.location.href).searchParams.get('q') || '').trim();
  if (initialQuery) {
    $input.value = initialQuery;
    run(initialQuery);
  }
}

/**
 * Swap back to the paginated listing (empty query).
 * @param {HTMLElement} $results - the results region
 * @param {HTMLElement} $listing - the normal post listing
 */
function showListing($results, $listing) {
  $results.innerHTML = '';
  $results.hidden = true;
  $listing.hidden = false;
}

/**
 * Render the result list, replacing the listing while a query is active.
 * @param {HTMLElement} $results - the results region
 * @param {HTMLElement} $listing - the normal post listing
 * @param {object[]} matches - ranked index entries
 * @param {string} query - the raw query string
 */
function render($results, $listing, matches, query) {
  const { escapeHTML } = omega.utilities();
  const safeQuery = escapeHTML(query);

  const body = matches.length
    ? `<p class="omega-blog-search__summary">${matches.length} result${matches.length === 1 ? '' : 's'} for &ldquo;${safeQuery}&rdquo;</p>
      <ol class="omega-blog-search__list">${matches.map((entry) => resultItem(entry, escapeHTML)).join('')}</ol>`
    : `<div class="omega-blog-search__empty">
        <h2 class="h5">No posts match &ldquo;${safeQuery}&rdquo;</h2>
        <p class="mb-0">Try a shorter word, or clear the box to see every post.</p>
      </div>`;

  $results.innerHTML = `<div class="container">${body}</div>`;
  $results.hidden = false;
  $listing.hidden = true;
}

/**
 * The index failed to load: the search box stays usable (a later query
 * re-fetches), but this query has nothing honest to show.
 * @param {HTMLElement} $results - the results region
 * @param {HTMLElement} $listing - the normal post listing
 */
function renderUnavailable($results, $listing) {
  $results.innerHTML = `<div class="container">
      <div class="omega-blog-search__empty">
        <h2 class="h5">Search is unavailable right now.</h2>
        <p class="mb-0">Try again in a moment, or browse the posts below.</p>
      </div>
    </div>`;
  $results.hidden = false;
  $listing.hidden = false;
}

/**
 * One result row: title link, first category + date, capped description.
 * @param {object} entry - an index entry
 * @param {function} escapeHTML - the client's HTML escaper
 * @returns {string} the row markup
 */
function resultItem(entry, escapeHTML) {
  const category = (entry.categories || [])[0];
  const meta = [category, formatDate(entry.date)].filter(Boolean).map(escapeHTML).join(' · ');

  return `
    <li class="omega-blog-search__item">
      <a class="omega-blog-search__title" href="${escapeHTML(entry.url)}">${escapeHTML(entry.title)}</a>
      ${meta ? `<p class="omega-blog-search__meta">${meta}</p>` : ''}
      ${entry.desc ? `<p class="omega-blog-search__excerpt">${escapeHTML(entry.desc)}</p>` : ''}
    </li>
  `;
}

// Tracking functions
function trackBlogSearch(query) {
  trackGoogle('event', 'search', {
    search_term: query,
    event_category: 'engagement',
    event_label: 'blog_page',
  });
  trackMeta('track', 'Search', {
    search_string: query,
    content_category: 'blog',
  });
  trackTikTok('Search', {
    content_id: 'blog-search',
    content_type: 'product',
    search_string: query,
  });
}
