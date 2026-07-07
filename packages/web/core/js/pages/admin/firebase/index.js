/**
 * Admin Firebase Explorer Page JavaScript
 */

// Libraries
import { FormManager } from '__main_assets__/js/libs/form-manager.js';
import { getPrerenderedIcon } from '__main_assets__/js/libs/prerendered-icons.js';
import webManager from 'web-manager';

// State
let currentCollection = '';
let currentDocPath = null;
let documents = [];
let lastDoc = null;
let isQueryActive = false;
let collectionFormManager = null;
let queryFormManager = null;

const PAGE_SIZE = 20;
const MAX_DISPLAY_COLUMNS = 4;

// Module
export default () => {
  return new Promise(async function (resolve) {
    await webManager.dom().ready();

    webManager.auth().listen({ once: true }, async (state) => {
      if (!state.user) {
        return;
      }

      initExplorer();
    });

    return resolve();
  });
};

// ============================================
// Initialize
// ============================================
function initExplorer() {
  initCollectionLinks();
  initCustomCollectionInput();
  initQueryBuilder();
  initDocumentDetail();
  initRefresh();
  loadCollectionCounts();
}

function initCollectionLinks() {
  const $links = document.querySelectorAll('#collection-links [data-collection]');
  $links.forEach(($link) => {
    $link.addEventListener('click', (e) => {
      e.preventDefault();
      browseCollection($link.dataset.collection);
    });
  });
}

function initCustomCollectionInput() {
  collectionFormManager = new FormManager('#collection-form', {
    allowResubmit: true,
    submittingText: '...',
  });

  collectionFormManager.on('submit', async ({ data }) => {
    const path = data?.collection?.path?.trim();
    if (path) {
      await browseCollection(path);
    }
  });
}

function initQueryBuilder() {
  queryFormManager = new FormManager('#query-form', {
    allowResubmit: true,
    submittingText: 'Querying...',
  });

  queryFormManager.on('submit', async ({ data }) => {
    await runQuery(data);
  });

  const $clearQuery = document.getElementById('btn-clear-query');
  if ($clearQuery) {
    $clearQuery.addEventListener('click', () => {
      isQueryActive = false;
      $clearQuery.classList.add('d-none');
      if (currentCollection) {
        browseCollection(currentCollection);
      }
    });
  }
}

function initDocumentDetail() {
  const $backBtn = document.getElementById('btn-back-to-list');
  const $editBtn = document.getElementById('btn-edit-doc');
  const $saveBtn = document.getElementById('btn-save-doc');
  const $cancelBtn = document.getElementById('btn-cancel-edit');

  if ($backBtn) {
    $backBtn.addEventListener('click', backToList);
  }

  if ($editBtn) {
    $editBtn.addEventListener('click', startEditing);
  }

  if ($saveBtn) {
    $saveBtn.addEventListener('click', saveDocument);
  }

  if ($cancelBtn) {
    $cancelBtn.addEventListener('click', cancelEditing);
  }
}

function initRefresh() {
  const $refresh = document.getElementById('btn-refresh-explorer');
  if ($refresh) {
    $refresh.addEventListener('click', () => {
      loadCollectionCounts();
      if (currentCollection) {
        browseCollection(currentCollection);
      }
    });
  }
}

// ============================================
// Collection Counts
// ============================================
async function loadCollectionCounts() {
  const { collection, getCountFromServer } = await import('firebase/firestore');
  const db = webManager.firebaseFirestore;

  const $links = document.querySelectorAll('#collection-links [data-collection]');
  const promises = [];

  $links.forEach(($link) => {
    const colName = $link.dataset.collection;
    const $badge = $link.querySelector('.collection-count');

    const promise = getCountFromServer(collection(db, colName))
      .then((snap) => {
        if ($badge) {
          $badge.textContent = snap.data().count.toLocaleString();
        }
      })
      .catch(() => {
        if ($badge) {
          $badge.textContent = '—';
        }
      });

    promises.push(promise);
  });

  await Promise.allSettled(promises);
}

// ============================================
// Browse Collection
// ============================================
async function browseCollection(collectionName) {
  currentCollection = collectionName;
  currentDocPath = null;
  documents = [];
  lastDoc = null;
  isQueryActive = false;

  // Update sidebar active state
  document.querySelectorAll('#collection-links .nav-link').forEach(($link) => {
    $link.classList.toggle('active', $link.dataset.collection === collectionName);
  });

  // Update collection form input
  if (collectionFormManager) {
    collectionFormManager.setData({ collection: { path: collectionName } });
  }

  // Update breadcrumb
  updateBreadcrumb([collectionName]);

  // Show documents view
  showDocumentsView();
  showDocsLoading();

  // Clear query UI
  const $clearQuery = document.getElementById('btn-clear-query');
  if ($clearQuery) $clearQuery.classList.add('d-none');

  // Load documents
  try {
    await loadDocuments();
  } catch (error) {
    console.error('Failed to load documents:', error);
    showDocsEmpty(`Error loading collection: ${error.message}`);
  }
}

// ============================================
// Load Documents
// ============================================
async function loadDocuments() {
  const firestore = webManager.firestore();
  let ref = firestore.collection(currentCollection).limit(PAGE_SIZE);

  if (lastDoc) {
    ref = ref.startAfter(lastDoc);
  }

  const snapshot = await ref.get();

  if (snapshot.empty && documents.length === 0) {
    showDocsEmpty('No documents in this collection');
    return;
  }

  if (!snapshot.empty) {
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    snapshot.docs.forEach((doc) => {
      documents.push({ id: doc.id, data: doc.data() });
    });
  }

  renderDocuments();
}

async function loadMoreDocuments() {
  if (!lastDoc) {
    return;
  }

  const $btn = document.getElementById('btn-load-more-docs');
  if ($btn) {
    $btn.disabled = true;
    $btn.textContent = 'Loading...';
  }

  try {
    if (isQueryActive) {
      // For queries, we stored the query ref — can't easily paginate client-side queries
      // Just hide the button
      if ($btn) $btn.classList.add('d-none');
    } else {
      await loadDocuments();
    }
  } catch (error) {
    console.error('Failed to load more:', error);
  }

  if ($btn) {
    $btn.disabled = false;
    $btn.textContent = 'Load more';
  }
}

// ============================================
// Render Documents Table
// ============================================
function renderDocuments() {
  const $table = document.getElementById('docs-table');
  const $thead = document.getElementById('docs-thead-row');
  const $tbody = document.getElementById('docs-tbody');
  const $footer = document.getElementById('docs-footer');
  const $count = document.getElementById('docs-count');
  const $loadMore = document.getElementById('btn-load-more-docs');
  const $loading = document.getElementById('docs-loading');
  const $empty = document.getElementById('docs-empty');

  if ($loading) $loading.classList.add('d-none');
  if ($empty) $empty.classList.add('d-none');

  if (documents.length === 0) {
    showDocsEmpty('No documents found');
    return;
  }

  // Determine columns from first document
  const firstDoc = documents[0].data;
  const columns = getDisplayColumns(firstDoc);

  // Build header
  if ($thead) {
    $thead.innerHTML = '<th>Document ID</th>';
    columns.forEach((col) => {
      $thead.innerHTML += `<th>${webManager.utilities().escapeHTML(col)}</th>`;
    });
    $thead.innerHTML += '<th style="width: 40px;"></th>';
  }

  // Build rows
  if ($tbody) {
    $tbody.innerHTML = '';
    documents.forEach((doc) => {
      const $row = document.createElement('tr');
      $row.style.cursor = 'pointer';

      let cells = `<td class="font-monospace small text-truncate" style="max-width: 200px;" title="${webManager.utilities().escapeHTML(doc.id)}">${webManager.utilities().escapeHTML(doc.id)}</td>`;

      columns.forEach((col) => {
        const value = getNestedValue(doc.data, col);
        cells += `<td class="small text-truncate" style="max-width: 180px;" title="${webManager.utilities().escapeHTML(value ?? '')}">${renderCellValue(value)}</td>`;
      });

      cells += `<td>
        <button class="btn btn-sm btn-link p-0 btn-view-doc" data-doc-id="${webManager.utilities().escapeHTML(doc.id)}">
          ${getPrerenderedIcon('file', 'fa-sm')}
        </button>
      </td>`;

      $row.innerHTML = cells;

      // Click anywhere on row to view doc
      $row.addEventListener('click', (e) => {
        if (e.target.closest('.btn-view-doc')) {
          return;
        }
        viewDocument(doc.id, doc.data);
      });

      // View button click
      const $viewBtn = $row.querySelector('.btn-view-doc');
      if ($viewBtn) {
        $viewBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          viewDocument(doc.id, doc.data);
        });
      }

      $tbody.appendChild($row);
    });
  }

  if ($table) $table.classList.remove('d-none');
  if ($footer) $footer.classList.remove('d-none');

  if ($count) {
    $count.textContent = `${documents.length} document${documents.length !== 1 ? 's' : ''} loaded`;
  }

  // Show/hide load more
  if ($loadMore) {
    if (lastDoc && !isQueryActive) {
      $loadMore.classList.remove('d-none');
      // Remove old listener and add new one
      const newBtn = $loadMore.cloneNode(true);
      $loadMore.parentNode.replaceChild(newBtn, $loadMore);
      newBtn.addEventListener('click', loadMoreDocuments);
    } else {
      $loadMore.classList.add('d-none');
    }
  }
}

// Get top-level keys to display as columns
function getDisplayColumns(data) {
  if (!data || typeof data !== 'object') {
    return [];
  }

  const keys = Object.keys(data);
  // Prioritize common useful fields
  const priority = ['auth.email', 'email', 'name', 'title', 'status', 'type'];
  const sorted = [];

  // Check for nested priority fields
  priority.forEach((key) => {
    if (key.includes('.')) {
      if (getNestedValue(data, key) !== undefined) {
        sorted.push(key);
      }
    } else if (keys.includes(key)) {
      sorted.push(key);
    }
  });

  // Add remaining top-level keys
  keys.forEach((key) => {
    if (!sorted.includes(key) && sorted.length < MAX_DISPLAY_COLUMNS) {
      sorted.push(key);
    }
  });

  return sorted.slice(0, MAX_DISPLAY_COLUMNS);
}

// Get nested value from an object by dot-separated path
function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => {
    return current?.[key];
  }, obj);
}

// Render a cell value for display
function renderCellValue(value) {
  if (value === null || value === undefined) {
    return '<span class="text-muted">null</span>';
  }

  if (typeof value === 'boolean') {
    return `<span class="badge ${value ? 'bg-success' : 'bg-secondary'}">${value}</span>`;
  }

  if (typeof value === 'number') {
    // Check if it looks like a UNIX timestamp (reasonable range)
    if (value > 1000000000 && value < 10000000000) {
      return `<span title="${webManager.utilities().escapeHTML(value)}">${webManager.utilities().escapeHTML(new Date(value * 1000).toLocaleDateString())}</span>`;
    }
    return webManager.utilities().escapeHTML(value.toLocaleString());
  }

  if (typeof value === 'object') {
    if (value.toDate && typeof value.toDate === 'function') {
      return webManager.utilities().escapeHTML(value.toDate().toLocaleDateString());
    }
    return `<span class="text-muted">{...}</span>`;
  }

  const str = String(value);
  if (str.length > 40) {
    return webManager.utilities().escapeHTML(str.substring(0, 40) + '...');
  }

  return webManager.utilities().escapeHTML(str);
}

// ============================================
// View Document
// ============================================
function viewDocument(docId, data) {
  currentDocPath = `${currentCollection}/${docId}`;

  // Update breadcrumb
  updateBreadcrumb([currentCollection, docId]);

  // Show detail view
  const $docsView = document.getElementById('view-documents');
  const $docView = document.getElementById('view-document');
  if ($docsView) $docsView.classList.add('d-none');
  if ($docView) $docView.classList.remove('d-none');

  // Set path
  const $path = document.getElementById('doc-detail-path');
  if ($path) $path.textContent = currentDocPath;

  // Render JSON
  const $jsonContent = document.getElementById('doc-json-content');
  if ($jsonContent) {
    $jsonContent.textContent = JSON.stringify(data, null, 2);
  }

  // Ensure viewer is shown, editor is hidden
  showViewer();
}

function backToList() {
  currentDocPath = null;
  showDocumentsView();
  updateBreadcrumb(currentCollection ? [currentCollection] : []);
}

// ============================================
// Edit Document
// ============================================
function startEditing() {
  const $jsonContent = document.getElementById('doc-json-content');
  const $editor = document.getElementById('doc-json-editor');

  if ($jsonContent && $editor) {
    $editor.value = $jsonContent.textContent;
  }

  showEditor();
}

function cancelEditing() {
  showViewer();
}

async function saveDocument() {
  const $editor = document.getElementById('doc-json-editor');
  const $error = document.getElementById('doc-editor-error');
  const $saveBtn = document.getElementById('btn-save-doc');

  if (!$editor || !currentDocPath) {
    return;
  }

  // Parse JSON
  let parsedData;
  try {
    parsedData = JSON.parse($editor.value);
  } catch (e) {
    if ($error) {
      $error.textContent = `Invalid JSON: ${e.message}`;
      $error.classList.remove('d-none');
    }
    return;
  }

  if ($error) $error.classList.add('d-none');
  if ($saveBtn) {
    $saveBtn.disabled = true;
    $saveBtn.textContent = 'Saving...';
  }

  try {
    const firestore = webManager.firestore();
    await firestore.doc(currentDocPath).set(parsedData, { merge: true });

    // Update the local document cache
    const docId = currentDocPath.split('/').pop();
    const docIndex = documents.findIndex((d) => d.id === docId);
    if (docIndex !== -1) {
      documents[docIndex].data = parsedData;
    }

    // Update JSON viewer and switch back
    const $jsonContent = document.getElementById('doc-json-content');
    if ($jsonContent) {
      $jsonContent.textContent = JSON.stringify(parsedData, null, 2);
    }

    showViewer();
  } catch (error) {
    console.error('Failed to save document:', error);
    if ($error) {
      $error.textContent = `Save failed: ${error.message}`;
      $error.classList.remove('d-none');
    }
  }

  if ($saveBtn) {
    $saveBtn.disabled = false;
    $saveBtn.innerHTML = `${getPrerenderedIcon('floppy-disk', 'fa-sm me-1')} Save`;
  }
}

// ============================================
// Query Builder
// ============================================
async function runQuery(data) {
  if (!currentCollection) {
    return;
  }

  const field = data?.query?.field?.trim();
  const operator = data?.query?.operator;
  let value = data?.query?.value?.trim();

  if (!field || !value) {
    return;
  }

  const $clearQuery = document.getElementById('btn-clear-query');

  // Auto-detect value type
  value = parseQueryValue(value);

  // Reset state
  documents = [];
  lastDoc = null;
  isQueryActive = true;

  showDocsLoading();

  if ($clearQuery) $clearQuery.classList.remove('d-none');

  try {
    const firestore = webManager.firestore();
    const snapshot = await firestore.collection(currentCollection)
      .where(field, operator, value)
      .limit(PAGE_SIZE)
      .get();

    if (!snapshot.empty) {
      lastDoc = snapshot.docs[snapshot.docs.length - 1];
      snapshot.docs.forEach((doc) => {
        documents.push({ id: doc.id, data: doc.data() });
      });
    }

    renderDocuments();

    if (documents.length === 0) {
      showDocsEmpty('No documents match your query');
    }
  } catch (error) {
    console.error('Query failed:', error);
    showDocsEmpty(`Query error: ${error.message}`);
  }
}

function parseQueryValue(value) {
  // Boolean
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;

  // Number
  const num = Number(value);
  if (!isNaN(num) && value !== '') return num;

  // String
  return value;
}

// ============================================
// UI Helpers
// ============================================
function updateBreadcrumb(segments) {
  const $breadcrumb = document.querySelector('#explorer-breadcrumb .breadcrumb');
  if (!$breadcrumb) {
    return;
  }

  $breadcrumb.innerHTML = `
    <li class="breadcrumb-item">
      <a href="#" id="breadcrumb-root">${getPrerenderedIcon('folder', 'fa-xs')}</a>
    </li>
  `;

  // Re-bind root click
  const $root = $breadcrumb.querySelector('#breadcrumb-root');
  if ($root) {
    $root.addEventListener('click', (e) => {
      e.preventDefault();
      currentCollection = '';
      currentDocPath = null;
      documents = [];
      lastDoc = null;
      showDocumentsView();
      showDocsEmpty('Select a collection to browse documents');
      updateBreadcrumb([]);

      // Clear active states
      document.querySelectorAll('#collection-links .nav-link').forEach(($link) => {
        $link.classList.remove('active');
      });
    });
  }

  segments.forEach((segment, i) => {
    const $li = document.createElement('li');
    $li.className = 'breadcrumb-item';

    if (i === segments.length - 1) {
      // Last segment — active
      $li.classList.add('active');
      $li.textContent = segment;
    } else {
      // Clickable segment
      const $a = document.createElement('a');
      $a.href = '#';
      $a.textContent = segment;
      $a.addEventListener('click', (e) => {
        e.preventDefault();
        if (i === 0) {
          browseCollection(segment);
        }
      });
      $li.appendChild($a);
    }

    $breadcrumb.appendChild($li);
  });
}

function showDocumentsView() {
  const $docsView = document.getElementById('view-documents');
  const $docView = document.getElementById('view-document');
  if ($docsView) $docsView.classList.remove('d-none');
  if ($docView) $docView.classList.add('d-none');
}

function showDocsLoading() {
  const $loading = document.getElementById('docs-loading');
  const $empty = document.getElementById('docs-empty');
  const $table = document.getElementById('docs-table');
  const $footer = document.getElementById('docs-footer');

  if ($loading) $loading.classList.remove('d-none');
  if ($empty) $empty.classList.add('d-none');
  if ($table) $table.classList.add('d-none');
  if ($footer) $footer.classList.add('d-none');
}

function showDocsEmpty(message) {
  const $loading = document.getElementById('docs-loading');
  const $empty = document.getElementById('docs-empty');
  const $table = document.getElementById('docs-table');
  const $footer = document.getElementById('docs-footer');

  if ($loading) $loading.classList.add('d-none');
  if ($table) $table.classList.add('d-none');
  if ($footer) $footer.classList.add('d-none');

  if ($empty) {
    $empty.classList.remove('d-none');
    $empty.textContent = message || 'No documents found';
  }
}

function showViewer() {
  const $viewer = document.getElementById('doc-json-viewer');
  const $editorWrapper = document.getElementById('doc-editor-wrapper');
  const $editBtn = document.getElementById('btn-edit-doc');
  const $error = document.getElementById('doc-editor-error');

  if ($viewer) $viewer.classList.remove('d-none');
  if ($editorWrapper) $editorWrapper.classList.add('d-none');
  if ($editBtn) $editBtn.classList.remove('d-none');
  if ($error) $error.classList.add('d-none');
}

function showEditor() {
  const $viewer = document.getElementById('doc-json-viewer');
  const $editorWrapper = document.getElementById('doc-editor-wrapper');
  const $editBtn = document.getElementById('btn-edit-doc');

  if ($viewer) $viewer.classList.add('d-none');
  if ($editorWrapper) $editorWrapper.classList.remove('d-none');
  if ($editBtn) $editBtn.classList.add('d-none');
}
