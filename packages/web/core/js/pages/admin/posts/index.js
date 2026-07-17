/**
 * Admin Posts Index Page JavaScript
 *
 * The CMS list view: reads the site's own JSON feed (/feeds/posts.json,
 * generated at build time) so it lists exactly what's LIVE — newest first,
 * instant client-side filter. Create/edit hand off to /admin/posts/editor,
 * which rides the backend admin/post routes.
 */

// Libraries
import { formatTimeAgo } from '__main_assets__/js/libs/admin-helpers.js';
import { getPrerenderedIcon } from '__main_assets__/js/libs/prerendered-icons.js';
import omega from '@omega.js/client';

// State
let posts = [];
let filterText = '';

// Module
export default () => {
  return new Promise(async function (resolve) {
    await omega.dom().ready();

    omega.auth().listen({ once: true }, async (state) => {
      if (!state.user) {
        return;
      }

      initControls();
      loadPosts();
    });

    return resolve();
  });
};

// Wire refresh + filter
function initControls() {
  const $refresh = document.getElementById('btn-refresh-posts');
  if ($refresh) {
    $refresh.addEventListener('click', () => loadPosts());
  }

  const $filter = document.getElementById('posts-filter');
  if ($filter) {
    $filter.addEventListener('input', () => {
      filterText = $filter.value.trim().toLowerCase();
      renderPosts();
    });
  }
}

// Load the site's own JSON feed
async function loadPosts() {
  showLoading();

  try {
    const response = await fetch('/feeds/posts.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Feed returned ${response.status}`);
    }

    const feed = await response.json();

    // Newest first regardless of feed order
    posts = (feed.items || []).slice().sort((a, b) => new Date(b.date_published) - new Date(a.date_published));

    renderStats();

    if (posts.length === 0) {
      showEmpty('No posts yet — write the first one from the editor');
      return;
    }

    renderPosts();
  } catch (error) {
    console.error('Failed to load posts feed:', error);
    renderStats();
    showEmpty(`Failed to load the posts feed: ${error.message || 'Unknown error'}`);
  }
}

// Fill the stat cards from the loaded feed
function renderStats() {
  const $total = document.getElementById('stat-total-posts');
  const $latest = document.getElementById('stat-latest-post');
  const $latestTitle = document.getElementById('stat-latest-title');
  const $categories = document.getElementById('stat-categories');

  const latest = posts[0];
  const categories = new Set(posts.flatMap((post) => post.tags || []));

  if ($total) $total.textContent = posts.length.toLocaleString();
  if ($latest) $latest.textContent = latest ? formatTimeAgo(new Date(latest.date_published).getTime()) : '—';
  if ($latestTitle) $latestTitle.textContent = latest ? latest.title : '';
  if ($categories) $categories.textContent = categories.size.toLocaleString();
}

// Render the posts table (filter-aware)
function renderPosts() {
  const $loading = document.getElementById('posts-loading');
  const $empty = document.getElementById('posts-empty');
  const $table = document.getElementById('posts-table');
  const $tbody = document.getElementById('posts-tbody');
  const $footer = document.getElementById('posts-footer');
  const $count = document.getElementById('posts-count');

  const shown = posts.filter(matchesFilter);

  if (shown.length === 0) {
    showEmpty(filterText ? 'No posts match your filter' : 'No posts yet');
    return;
  }

  if ($loading) $loading.classList.add('d-none');
  if ($empty) $empty.classList.add('d-none');
  if ($table) $table.classList.remove('d-none');
  if ($footer) $footer.classList.remove('d-none');
  if ($tbody) $tbody.innerHTML = '';

  shown.forEach((post) => {
    $tbody.appendChild(renderRow(post));
  });

  if ($count) {
    $count.textContent = filterText
      ? `${shown.length} of ${posts.length} posts match “${filterText}”`
      : `${posts.length} post${posts.length !== 1 ? 's' : ''} · from the live site feed`;
  }
}

// Filter predicate: title, categories, or URL
function matchesFilter(post) {
  if (!filterText) {
    return true;
  }

  return (post.title || '').toLowerCase().includes(filterText)
    || (post.url || '').toLowerCase().includes(filterText)
    || (post.tags || []).some((tag) => String(tag).toLowerCase().includes(filterText));
}

// Build one post row
function renderRow(post) {
  const escape = omega.utilities().escapeHTML;
  const title = post.title || 'Untitled';
  const url = post.url || '';
  const pathname = url ? new URL(url, window.location.origin).pathname : '';
  const author = post.authors?.[0]?.name || '—';
  const tags = post.tags || [];
  const published = post.date_published ? new Date(post.date_published) : null;

  // Categories cell (first 3 + overflow count)
  const badges = tags.slice(0, 3)
    .map((tag) => `<span class="classy-chip">${escape(String(tag))}</span>`)
    .join(' ');
  const overflow = tags.length > 3 ? ` <span class="text-muted small">+${tags.length - 3}</span>` : '';

  // Published cell
  const publishedText = published ? published.toLocaleDateString() : '—';
  const publishedAgo = published
    ? `<div class="text-muted" style="font-size: 0.7rem;">${escape(formatTimeAgo(published.getTime()))}</div>`
    : '';

  const editorHref = `/admin/posts/editor?post=${encodeURIComponent(url)}`;

  const $row = document.createElement('tr');
  $row.innerHTML = `
    <td>
      <div class="d-flex align-items-center gap-2">
        <span class="classy-icon-chip classy-icon-chip--neutral">${getPrerenderedIcon('newspaper', 'fa-sm')}</span>
        <div class="min-w-0">
          <div class="text-truncate fw-semibold" style="max-width: 320px;">${escape(title)}</div>
          <div class="font-monospace text-muted text-truncate" style="max-width: 320px; font-size: 0.7rem;">${escape(pathname)}</div>
        </div>
      </div>
    </td>
    <td class="small">${escape(author)}</td>
    <td>${badges || '<span class="text-muted small">—</span>'}${overflow}</td>
    <td class="text-muted small">${escape(publishedText)}${publishedAgo}</td>
    <td>
      <div class="dropdown">
        <button class="classy-iconbtn" type="button" data-bs-toggle="dropdown" aria-label="Post actions">
          ${getPrerenderedIcon('ellipsis-vertical', 'fa-sm')}
        </button>
        <ul class="dropdown-menu dropdown-menu-end">
          <li><a class="dropdown-item small" href="${escape(editorHref)}">
            ${getPrerenderedIcon('pen', 'fa-sm me-2')}
            Edit post
          </a></li>
          <li><a class="dropdown-item small" href="${escape(url)}" target="_blank" rel="noopener">
            ${getPrerenderedIcon('arrow-up-right-from-square', 'fa-sm me-2')}
            View live
          </a></li>
          <li><a class="dropdown-item small btn-copy-url" href="#">
            ${getPrerenderedIcon('copy', 'fa-sm me-2')}
            Copy URL
          </a></li>
        </ul>
      </div>
    </td>
  `;

  $row.querySelector('.btn-copy-url').addEventListener('click', (e) => {
    e.preventDefault();
    navigator.clipboard.writeText(url);
  });

  return $row;
}

// UI state helpers
function showLoading() {
  hideAll();
  const $loading = document.getElementById('posts-loading');
  if ($loading) $loading.classList.remove('d-none');
}

function showEmpty(message) {
  hideAll();
  const $empty = document.getElementById('posts-empty');
  if ($empty) {
    $empty.classList.remove('d-none');
    $empty.textContent = message || 'No posts found';
  }
}

function hideAll() {
  ['posts-loading', 'posts-empty'].forEach((id) => {
    const $el = document.getElementById(id);
    if ($el) $el.classList.add('d-none');
  });
  const $table = document.getElementById('posts-table');
  const $footer = document.getElementById('posts-footer');
  if ($table) $table.classList.add('d-none');
  if ($footer) $footer.classList.add('d-none');
}
