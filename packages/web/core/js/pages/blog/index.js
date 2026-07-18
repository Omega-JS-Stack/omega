/**
 * Blog Page JavaScript
 */

// Libraries
import omega from '@omega.js/client';

// Module
// (The newsletter form binding moved to the section that renders it —
// themes/classy/_sections/marketing/newsletter-cta/section.js, initialized
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
  const $searchInput = document.getElementById('blog-search');
  const $searchResults = document.getElementById('search-results');
  const $blogPosts = document.querySelectorAll('.blog-post');

  if (!$searchInput || !$searchResults || !$blogPosts.length) {
    return;
  }

  let searchTimeout;

  // Handle search input
  $searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim().toLowerCase();

    if (query.length === 0) {
      // Reset if empty
      $searchResults.classList.add('d-none');
      $blogPosts.forEach(post => {
        post.classList.remove('d-none');
      });
      return;
    }

    // Debounce search
    searchTimeout = setTimeout(() => {
      performSearch(query, $blogPosts, $searchResults);
    }, 300);
  });

  // Add keyboard shortcut (Ctrl/Cmd + K)
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      $searchInput.focus();
      $searchInput.select();
    }
  });
}

// Perform search on blog posts
function performSearch(query, $blogPosts, $searchResults) {
  let matchCount = 0;

  $blogPosts.forEach(post => {
    const title = post.dataset.title?.toLowerCase() || '';
    const description = post.dataset.description?.toLowerCase() || '';
    const tags = post.dataset.tags?.toLowerCase() || '';

    if (title.includes(query) || description.includes(query) || tags.includes(query)) {
      post.classList.remove('d-none');
      matchCount++;
    } else {
      post.classList.add('d-none');
    }
  });

  // Update results message
  if (matchCount === 0) {
    $searchResults.innerHTML = '<p class="text-muted">No posts found matching your search.</p>';
  } else {
    $searchResults.innerHTML = `<p class="text-muted">Found ${matchCount} post${matchCount !== 1 ? 's' : ''} matching "${omega.utilities().escapeHTML(query)}"</p>`;
  }

  $searchResults.classList.remove('d-none');

  // Track search
  trackBlogSearch(query);
}

// Tracking functions
function trackBlogSearch(query) {
  gtag('event', 'search', {
    search_term: query,
    event_category: 'engagement',
    event_label: 'blog_page',
  });
  fbq('track', 'Search', {
    search_string: query,
    content_category: 'blog',
  });
  ttq.track('Search', {
    content_id: 'blog-search',
    content_type: 'product',
    search_string: query,
  });
}
