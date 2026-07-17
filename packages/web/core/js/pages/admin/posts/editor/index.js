/**
 * Admin Post Editor Page JavaScript
 *
 * One editor, two modes. Create (default): full frontmatter form →
 * POST /admin/post (the backend downloads/resizes images and commits the
 * post to the website repo). Edit (?post=<url>): loads the live post via
 * GET /content/post, then title + body → PUT /admin/post (frontmatter is
 * preserved server-side). D13: saving dispatches a site build unless the
 * deploy switch is off.
 */

// Libraries
import { FormManager } from '@omega.js/client/modules/form-manager.js';
import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';
import omega from '@omega.js/client';

// State
let formManager = null;
let editUrl = null;
let slugTouched = false;

// Module
export default () => {
  return new Promise(async function (resolve) {
    await omega.dom().ready();

    omega.auth().listen({ once: true }, async (state) => {
      if (!state.user) {
        return;
      }

      editUrl = new URLSearchParams(window.location.search).get('post');

      initForm();

      if (editUrl) {
        enterEditMode();
      } else {
        initSlugFollow();
      }
    });

    return resolve();
  });
};

// ============================================
// Create mode
// ============================================

// Slug follows the title until it's edited by hand
function initSlugFollow() {
  const $title = document.getElementById('editor-title');
  const $slug = document.getElementById('editor-slug');
  if (!$title || !$slug) {
    return;
  }

  $title.addEventListener('input', () => {
    if (!slugTouched) {
      $slug.value = hyphenate($title.value);
    }
  });

  $slug.addEventListener('input', () => {
    slugTouched = $slug.value.trim() !== '';
  });
}

function hyphenate(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ============================================
// Edit mode
// ============================================

async function enterEditMode() {
  const $note = document.getElementById('editor-mode-note');
  const $submitText = document.getElementById('editor-submit-text');
  const $formCard = document.getElementById('editor-form-card');
  const $loading = document.getElementById('editor-loading');

  if ($note) $note.textContent = 'Editing a live post — title and body are editable, frontmatter is preserved';
  if ($submitText) $submitText.textContent = 'Save changes';

  // Create-only fields don't apply on edit — hide them and drop their
  // required flags so HTML5 validation doesn't block the submit
  document.querySelectorAll('.create-only').forEach(($wrapper) => {
    $wrapper.classList.add('d-none');
    $wrapper.querySelectorAll('input, textarea').forEach(($field) => {
      $field.required = false;
      $field.disabled = true;
    });
  });

  if ($formCard) $formCard.classList.add('d-none');
  if ($loading) $loading.classList.remove('d-none');

  try {
    const url = new URL(`${omega.getApiUrl()}/omega/content/post`);
    url.searchParams.set('url', editUrl);

    const post = await authorizedFetch(url.toString(), {
      method: 'GET',
      timeout: 60000,
      response: 'json',
      tries: 1,
      log: true,
    });

    const $title = document.getElementById('editor-title');
    const $body = document.getElementById('editor-body');
    if ($title) $title.value = post?.title || '';
    if ($body) $body.value = post?.body || '';

    // Show the preserved frontmatter for transparency
    const $details = document.getElementById('editor-frontmatter-details');
    const $frontmatter = document.getElementById('editor-frontmatter');
    if ($details && $frontmatter && post?.frontmatter) {
      $frontmatter.textContent = post.frontmatter;
      $details.classList.remove('d-none');
    }

    if ($loading) $loading.classList.add('d-none');
    if ($formCard) $formCard.classList.remove('d-none');
  } catch (error) {
    console.error('Failed to load post:', error);

    const $error = document.getElementById('editor-load-error');
    const $message = document.getElementById('editor-load-error-message');
    if ($loading) $loading.classList.add('d-none');
    if ($message) $message.textContent = error.message || 'Unknown error';
    if ($error) $error.classList.remove('d-none');
  }
}

// ============================================
// Submit
// ============================================

function initForm() {
  formManager = new FormManager('#post-editor-form', {
    allowResubmit: true,
    submittingText: 'Saving...',
  });

  formManager.on('submit', async ({ data }) => {
    const post = data?.post || {};
    const deploy = post.deploy === true;

    const payload = editUrl
      ? {
          url: editUrl,
          title: (post.title || '').trim(),
          body: post.body || '',
          deploy: deploy,
        }
      : {
          title: (post.title || '').trim(),
          url: hyphenate(post.url || post.title),
          description: (post.description || '').trim(),
          headerImageURL: (post.headerImageURL || '').trim(),
          body: post.body || '',
          categories: splitList(post.categories),
          tags: splitList(post.tags),
          deploy: deploy,
        };

    // Author defaults to the brand server-side — only send a real one
    if (!editUrl && post.author?.trim()) {
      payload.author = post.author.trim();
    }

    try {
      const response = await authorizedFetch(`${omega.getApiUrl()}/omega/admin/post`, {
        method: editUrl ? 'PUT' : 'POST',
        timeout: 190000,
        response: 'json',
        tries: 1,
        log: true,
        body: payload,
      });

      showSuccess(response, payload);
    } catch (error) {
      console.error('Failed to save post:', error);
      formManager.showError(error.message || 'Failed to save the post');
    }
  });
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

// Swap the form for the success panel
function showSuccess(response, payload) {
  const $formCard = document.getElementById('editor-form-card');
  const $success = document.getElementById('editor-success');
  const $title = document.getElementById('editor-success-title');
  const $detail = document.getElementById('editor-success-detail');
  const $view = document.getElementById('btn-view-post');

  if ($title) {
    $title.textContent = editUrl ? 'Changes committed' : 'Post committed';
  }

  if ($detail) {
    if (response?.deployDispatched === true) {
      $detail.textContent = 'A site build was dispatched — it goes live when the build finishes.';
    } else if (payload.deploy === false) {
      $detail.textContent = 'Deploy skipped — the commit rides the next site build.';
    } else {
      $detail.textContent = 'The commit landed, but the build dispatch could not be confirmed — check the repo\'s Actions.';
    }
  }

  if ($view) {
    $view.href = editUrl || `/blog/${payload.url}`;
  }

  if ($formCard) $formCard.classList.add('d-none');
  if ($success) $success.classList.remove('d-none');
}
