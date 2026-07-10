// ============================================
// Popup Component - Omega Manager
// Smart search with keyboard navigation
// ============================================

// Import Browser Extension Manager
import Manager from '@omega.js/extension/popup';

// Category icons
const CATEGORY_ICONS = {
  Analytics: '\uD83D\uDCCA',
  Firebase: '\uD83D\uDD25',
  GitHub: '\uD83D\uDC19',
  Cloud: '\u2601\uFE0F',
  Search: '\uD83D\uDD0D',
  Stripe: '\uD83D\uDCB3',
  Live: '\uD83C\uDF10',
  Default: '\uD83D\uDD17',
};

// State
let allBookmarks = {};
let flatItems = [];
let filteredItems = [];
let selectedIndex = 0;

// Create instance
const manager = new Manager();

// Initialize
manager.initialize()
.then(() => {
  const { extension, logger } = manager;

  // DOM references
  const $search = document.getElementById('search-input');
  const $results = document.getElementById('results');
  const $statusDot = document.getElementById('status-dot');

  /**
   * Get favicon URL for a bookmark
   */
  function getFaviconUrl(url) {
    try {
      const domain = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch {
      return null;
    }
  }

  /**
   * Flatten bookmarks into a searchable list
   */
  function flattenBookmarks(bookmarks) {
    const items = [];

    for (const brandName of Object.keys(bookmarks).sort()) {
      const categories = bookmarks[brandName];

      for (const categoryName of Object.keys(categories).sort()) {
        const links = categories[categoryName];

        for (const link of links) {
          const isSeparator = /^[\u2500-\u257F\u2014\u2015\u2012\u2013-]+$/.test(link.title);
          items.push({
            brand: brandName,
            category: categoryName,
            title: link.title,
            url: link.url,
            separator: isSeparator,
            searchText: isSeparator ? '' : `${brandName} ${categoryName} ${link.title}`.toLowerCase(),
          });
        }
      }
    }

    return items;
  }

  /**
   * Smart search - all terms must match somewhere in brand+category+title
   */
  function filterItems(query) {
    if (!query.trim()) {
      return flatItems;
    }

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

    return flatItems.filter((item) => {
      if (item.separator) {
        return false;
      }
      return terms.every((term) => item.searchText.includes(term));
    });
  }

  /**
   * Highlight matched terms in text
   */
  function highlightText(text, query) {
    if (!query.trim()) {
      return escapeHtml(text);
    }

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const escaped = escapeHtml(text);

    const pattern = terms
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');

    if (!pattern) {
      return escaped;
    }

    const regex = new RegExp(`(${pattern})`, 'gi');
    return escaped.replace(regex, '<span class="omega-highlight">$1</span>');
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Render the filtered results
   */
  function renderResults() {
    const query = $search.value;
    filteredItems = filterItems(query);
    selectedIndex = Math.min(selectedIndex, Math.max(0, filteredItems.length - 1));

    if (flatItems.length === 0) {
      $results.innerHTML = `
        <div class="omega-empty">
          <div class="omega-empty-icon">\uD83D\uDCDA</div>
          <div>No bookmarks yet</div>
          <div class="mt-2" style="font-size: 11px;">
            Run <code>npm start -- --service=bookmark</code><br>
            in omega-manager to sync bookmarks
          </div>
        </div>
      `;
      return;
    }

    if (filteredItems.length === 0) {
      $results.innerHTML = `
        <div class="omega-empty">
          <div class="omega-empty-icon">\uD83D\uDD0D</div>
          <div>No matches</div>
        </div>
      `;
      return;
    }

    let html = '';
    let lastBrand = '';
    let lastCategory = '';

    filteredItems.forEach((item, index) => {
      // Brand header
      if (item.brand !== lastBrand) {
        lastBrand = item.brand;
        lastCategory = '';
        html += `<div class="omega-brand-header">${highlightText(item.brand, query)}</div>`;
      }

      // Category header
      if (item.category !== lastCategory) {
        lastCategory = item.category;
        const icon = CATEGORY_ICONS[item.category] || CATEGORY_ICONS.Default;
        html += `<div class="omega-category-header">${icon} ${highlightText(item.category, query)}</div>`;
      }

      // Separator
      if (item.separator) {
        html += `<hr class="omega-separator">`;
      } else {
        // Bookmark item
        const favicon = getFaviconUrl(item.url);
        const selectedClass = index === selectedIndex ? ' selected' : '';

        html += `
          <a href="${escapeHtml(item.url)}"
             class="omega-item${selectedClass}"
             data-index="${index}"
             target="_blank">
            <img class="omega-item-icon" src="${favicon}" onerror="this.style.display='none'">
            <div class="omega-item-text">
              <div class="omega-item-title">${highlightText(item.title, query)}</div>
              ${query.trim() ? `<div class="omega-item-path">${escapeHtml(item.brand)} / ${escapeHtml(item.category)}</div>` : ''}
            </div>
          </a>
        `;
      }
    });

    $results.innerHTML = html;
    scrollSelectedIntoView();
  }

  /**
   * Scroll the selected item into view
   */
  function scrollSelectedIntoView() {
    const $selected = $results.querySelector('.omega-item.selected');
    if (!$selected) {
      return;
    }

    $selected.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Open the selected item
   */
  function openSelected() {
    if (filteredItems.length === 0) {
      return;
    }

    const item = filteredItems[selectedIndex];
    if (!item) {
      return;
    }

    extension.tabs.create({ url: item.url });
    window.close();
  }

  /**
   * Handle keyboard navigation
   */
  $search.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (filteredItems.length > 0) {
          do {
            selectedIndex = (selectedIndex + 1) % filteredItems.length;
          } while (filteredItems[selectedIndex]?.separator && filteredItems.length > 1);
          renderResults();
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (filteredItems.length > 0) {
          do {
            selectedIndex = (selectedIndex - 1 + filteredItems.length) % filteredItems.length;
          } while (filteredItems[selectedIndex]?.separator && filteredItems.length > 1);
          renderResults();
        }
        break;

      case 'Enter':
        e.preventDefault();
        openSelected();
        break;

      case 'Escape':
        e.preventDefault();
        if ($search.value) {
          $search.value = '';
          selectedIndex = 0;
          renderResults();
        } else {
          window.close();
        }
        break;
    }
  });

  /**
   * Handle search input
   */
  $search.addEventListener('input', () => {
    selectedIndex = 0;
    renderResults();
  });

  /**
   * Handle mouse hover on items
   */
  $results.addEventListener('mousemove', (e) => {
    const $item = e.target.closest('.omega-item');
    if (!$item) {
      return;
    }

    const index = parseInt($item.dataset.index, 10);
    if (index !== selectedIndex) {
      selectedIndex = index;
      renderResults();
    }
  });

  /**
   * Handle click on items
   */
  $results.addEventListener('click', (e) => {
    const $item = e.target.closest('.omega-item');
    if (!$item) {
      return;
    }

    e.preventDefault();
    const index = parseInt($item.dataset.index, 10);
    selectedIndex = index;
    openSelected();
  });

  /**
   * Update connection status
   */
  function updateStatus(connected) {
    if (connected) {
      $statusDot.classList.add('connected');
      $statusDot.title = 'Connected';
    } else {
      $statusDot.classList.remove('connected');
      $statusDot.title = 'Disconnected';
    }
  }

  /**
   * Load bookmarks from Chrome
   */
  function loadBookmarks() {
    extension.runtime.sendMessage({ action: 'getBookmarks' }, (bookmarks) => {
      allBookmarks = bookmarks || {};
      flatItems = flattenBookmarks(allBookmarks);
      filteredItems = flatItems;
      selectedIndex = 0;
      renderResults();
    });
  }

  /**
   * Check connection status
   */
  function checkStatus() {
    extension.runtime.sendMessage({ action: 'getStatus' }, (response) => {
      updateStatus(response?.connected || false);
    });
  }

  // Initialize
  loadBookmarks();
  checkStatus();

  // Ensure search input is focused
  $search.focus();

  // Refresh status periodically
  setInterval(checkStatus, 2000);

  logger.log('Popup initialized!');
});
