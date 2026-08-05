/**
 * Admin Dashboard Page JavaScript
 */

// Libraries
import { getPrerenderedIcon } from '__main_assets__/js/libs/prerendered-icons.js';
import { getProducts } from '__main_assets__/js/libs/payment-config.js';
import { formatTimeAgo, capitalize, setStatValue, setStatSubValue } from '__main_assets__/js/libs/admin-helpers.js';
import { loadCharts, barChart, doughnutChart } from '__main_assets__/js/libs/charts.js';
import omega from '@omega.js/client';

// The plan doughnut paints STATUS hues, not the categorical ramp (#74, Ian's
// triage call): the slices mean healthy/attention/trouble, and the ramp would
// trade that meaning for a set of colors that only say "different". Passed as
// var() tokens so the helper's resolveColor reads them off the live sheet —
// brand ramp and dark mode follow with no work here.
const PLAN_HUES = [
  'var(--omega-accent)',
  'var(--omega-ok)',
  'var(--omega-warn)',
  'var(--omega-danger)',
  'var(--omega-ink-faint)',
  'var(--omega-accent-active)',
];

// Module
export default () => {
  return new Promise(async function (resolve) {
    await omega.dom().ready();

    omega.auth().listen({ once: true }, async (state) => {
      if (!state.user) {
        return;
      }

      loadDashboard();
      initTools();
    });

    return resolve();
  });
};

// Load all dashboard data in parallel
async function loadDashboard() {
  const results = await Promise.allSettled([
    loadStatCards(),
    loadSubscriberData(),
    loadSignupsTrend(),
    loadAttention(),
    loadContent(),
    loadRecentUsers(),
    loadRecentOrders(),
  ]);

  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(`Dashboard widget ${i} failed:`, result.reason);
    }
  });
}

// ============================================
// Stat Cards
// ============================================
async function loadStatCards() {
  const { collection, query, where, getCountFromServer } = await import('firebase/firestore');
  const db = omega.firebaseFirestore;
  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = now - (30 * 24 * 60 * 60);

  const [totalUsers, newUsers, totalNotifications, newNotifications, recentOrders, totalOrders] = await Promise.allSettled([
    getCountFromServer(collection(db, 'users')),
    getCountFromServer(query(collection(db, 'users'), where('metadata.created.timestampUNIX', '>=', thirtyDaysAgo))),
    getCountFromServer(collection(db, 'notifications')),
    getCountFromServer(query(collection(db, 'notifications'), where('metadata.created.timestampUNIX', '>=', thirtyDaysAgo))),
    getCountFromServer(query(collection(db, 'payments-orders'), where('metadata.created.timestampUNIX', '>=', thirtyDaysAgo))),
    getCountFromServer(collection(db, 'payments-orders')),
  ]);

  setStatValue('stat-total-users', totalUsers);
  setStatSubValue('stat-new-users', newUsers, 'in 30d');
  setStatValue('stat-notifications', totalNotifications);
  setStatSubValue('stat-new-notifications', newNotifications, 'in 30d');
  setStatValue('stat-orders', recentOrders);
  setStatSubValue('stat-orders-sub', totalOrders, 'all time');
}

// ============================================
// Needs Attention (actionable counts — all single-field queries)
// ============================================
async function loadAttention() {
  const { collection, query, where, getCountFromServer } = await import('firebase/firestore');
  const db = omega.firebaseFirestore;
  const now = Math.floor(Date.now() / 1000);
  const sevenDaysOut = now + (7 * 24 * 60 * 60);

  const [carts, expiring, suspended] = await Promise.allSettled([
    getCountFromServer(query(collection(db, 'payments-carts'), where('status', '==', 'pending'))),
    getCountFromServer(query(
      collection(db, 'users'),
      where('subscription.expires.timestampUNIX', '>=', now),
      where('subscription.expires.timestampUNIX', '<=', sevenDaysOut),
    )),
    getCountFromServer(query(collection(db, 'users'), where('subscription.status', '==', 'suspended'))),
  ]);

  setAttentionCount('att-carts', carts);
  setAttentionCount('att-expiring', expiring);
  setAttentionCount('att-suspended', suspended);
}

// Fill an attention counter; non-zero counts get the warn tint
function setAttentionCount(id, settled) {
  const $el = document.getElementById(id);
  if (!$el) {
    return;
  }

  if (settled.status !== 'fulfilled') {
    $el.textContent = '—';
    return;
  }

  const count = settled.value.data().count;
  $el.textContent = count.toLocaleString();
  $el.classList.toggle('omega-count--warn', count > 0);
}

// ============================================
// Signups Trend (14 daily counts → bar chart)
// ============================================
async function loadSignupsTrend() {
  const { collection, query, where, getCountFromServer } = await import('firebase/firestore');
  const db = omega.firebaseFirestore;

  const DAYS = 14;
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const buckets = Array.from({ length: DAYS }, (_, i) => {
    const start = new Date(startOfToday.getTime() - (DAYS - 1 - i) * dayMs);
    return {
      label: start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      startUNIX: Math.floor(start.getTime() / 1000),
      endUNIX: Math.floor((start.getTime() + dayMs) / 1000),
    };
  });

  const counts = await Promise.all(buckets.map((bucket) =>
    getCountFromServer(query(
      collection(db, 'users'),
      where('metadata.created.timestampUNIX', '>=', bucket.startUNIX),
      where('metadata.created.timestampUNIX', '<', bucket.endUNIX),
    )).then((snap) => snap.data().count).catch(() => 0)
  ));

  await renderSignupsChart(buckets.map((b) => b.label), counts);
}

// ============================================
// Subscriber Data (for charts)
// ============================================
async function loadSubscriberData() {
  const { collection, query, where, getCountFromServer } = await import('firebase/firestore');
  const db = omega.firebaseFirestore;

  // Get product list from _config.yml (available instantly via omega.config)
  const products = getProducts().filter((p) => p.id !== 'basic');
  const frequencyIds = [...new Set(products.flatMap((p) => Object.keys(p.prices || {})))];

  // Run count queries for each product × frequency in parallel
  const countQueries = products.flatMap((product) =>
    frequencyIds.map((freq) =>
      getCountFromServer(query(
        collection(db, 'users'),
        where('subscription.status', '==', 'active'),
        where('subscription.product.id', '==', product.id),
        where('subscription.payment.frequency', '==', freq),
      )).then((snap) => ({ planId: product.id, frequency: freq, count: snap.data().count }))
    )
  );

  const results = await Promise.all(countQueries);

  // Build chart data from counts
  const plans = {};

  results.forEach(({ planId, count }) => {
    if (count === 0) {
      return;
    }

    plans[planId] = (plans[planId] || 0) + count;
  });

  // Calculate MRR from counts × product prices
  const MONTHS_PER_FREQUENCY = { daily: 1 / 30, weekly: 1 / 4, monthly: 1, annually: 12 };
  let mrr = 0;
  let totalSubscribers = 0;

  results.forEach(({ planId, frequency, count }) => {
    if (count === 0) {
      return;
    }

    const product = products.find((p) => p.id === planId);
    const priceEntry = product?.prices?.[frequency];
    const price = typeof priceEntry === 'object' ? (priceEntry?.amount || 0) : Number(priceEntry) || 0;
    const months = MONTHS_PER_FREQUENCY[frequency] || 1;

    mrr += (price / months) * count;
    totalSubscribers += count;
  });

  // Set MRR stat card
  const $mrr = document.getElementById('stat-mrr');
  if ($mrr) {
    $mrr.textContent = `$${Math.round(mrr).toLocaleString()}`;
  }
  const $mrrCount = document.getElementById('stat-mrr-count');
  if ($mrrCount) {
    $mrrCount.textContent = `${totalSubscribers.toLocaleString()} subscriber${totalSubscribers === 1 ? '' : 's'}`;
  }

  await renderPlanChart(plans);
}

// ============================================
// Charts
// ============================================
// Both charts go through the framework's chart helper
// (core/js/libs/charts.js): it owns the lazy Chart.js chunk, the token reads,
// and the four builders, so this page never names the library (#74).

async function renderPlanChart(plans) {
  const $loading = document.getElementById('chart-plans-loading');
  const $canvas = document.getElementById('chart-plans');
  if (!$canvas) {
    return;
  }

  const labels = Object.keys(plans);
  const values = Object.values(plans);

  if (labels.length === 0) {
    if ($loading) {
      $loading.innerHTML = '<span class="text-muted">No subscription data</span>';
    }
    return;
  }

  if (!await loadCharts()) {
    if ($loading) {
      $loading.innerHTML = '<span class="text-muted">Chart library unavailable</span>';
    }
    return;
  }

  if ($loading) {
    $loading.classList.add('d-none');
  }
  $canvas.parentElement.classList.remove('d-none');

  doughnutChart('chart-plans', {
    labels: labels.map(capitalize),
    values,
    colors: PLAN_HUES.slice(0, labels.length),
  });
}

async function renderSignupsChart(labels, values) {
  const $loading = document.getElementById('chart-signups-loading');
  const $canvas = document.getElementById('chart-signups');
  if (!$canvas) {
    return;
  }

  if (!await loadCharts()) {
    if ($loading) {
      $loading.innerHTML = '<span class="text-muted">Chart library unavailable</span>';
    }
    return;
  }

  if ($loading) {
    $loading.classList.add('d-none');
  }
  $canvas.parentElement.classList.remove('d-none');

  barChart('chart-signups', { labels, values, label: 'Signups' });
}

// ============================================
// Content (reads the site's own JSON feed — what's actually live)
// ============================================
async function loadContent() {
  const $loading = document.getElementById('content-loading');
  const $empty = document.getElementById('content-empty');
  const $list = document.getElementById('content-list');
  const $footer = document.getElementById('content-footer');
  const escape = omega.utilities().escapeHTML;

  const response = await fetch('/feeds/posts.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Feed returned ${response.status}`);
  }

  const feed = await response.json();
  const items = (Array.isArray(feed?.items) ? feed.items : [])
    .slice()
    .sort((a, b) => new Date(b.date_published || 0) - new Date(a.date_published || 0));

  if ($loading) {
    $loading.classList.add('d-none');
  }

  if (items.length === 0) {
    if ($empty) $empty.classList.remove('d-none');
    return;
  }

  if ($list) {
    $list.classList.remove('d-none');
    $list.innerHTML = items.slice(0, 3).map((item) => {
      const url = item.url || item.id || '';
      const pathname = url ? new URL(url, window.location.origin).pathname : '';
      const published = item.date_published ? formatTimeAgo(new Date(item.date_published).getTime()) : '';
      const editorHref = `/admin/posts/editor?post=${encodeURIComponent(url)}`;

      return `
        <div class="omega-activity__row align-items-center">
          <div class="omega-activity__body">
            <div class="omega-activity__title text-truncate"><a href="${escape(editorHref)}" class="text-decoration-none">${escape(item.title || 'Untitled')}</a></div>
            <p class="omega-activity__desc font-monospace text-truncate">${escape(pathname)}</p>
          </div>
          <span class="omega-activity__time">${escape(published)}</span>
        </div>
      `;
    }).join('');
  }

  if ($footer) {
    $footer.classList.remove('d-none');
    $footer.textContent = `${items.length} post${items.length === 1 ? '' : 's'} in the live feed`;
  }
}

// ============================================
// Recent Users Table
// ============================================
async function loadRecentUsers() {
  const $loading = document.getElementById('recent-users-loading');
  const $empty = document.getElementById('recent-users-empty');
  const $table = document.getElementById('recent-users-table');
  const $tbody = document.getElementById('recent-users-tbody');

  const firestore = omega.firestore();
  const snapshot = await firestore.collection('users')
    .orderBy('metadata.created.timestampUNIX', 'desc')
    .limit(10)
    .get();

  if ($loading) {
    $loading.classList.add('d-none');
  }

  if (snapshot.empty) {
    if ($empty) {
      $empty.classList.remove('d-none');
    }
    return;
  }

  if ($table) {
    $table.classList.remove('d-none');
  }

  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    const email = data?.auth?.email || 'Unknown';
    const plan = data?.subscription?.product?.id || 'basic';
    const created = data?.metadata?.created?.timestampUNIX;
    const timeAgo = created ? formatTimeAgo(created * 1000) : 'Unknown';

    const isPaid = plan !== 'basic';
    const $row = document.createElement('tr');
    $row.innerHTML = `
      <td class="text-truncate" style="max-width: 200px;">${omega.utilities().escapeHTML(email)}</td>
      <td><span class="omega-chip${isPaid ? ' omega-chip--accent' : ''}">${omega.utilities().escapeHTML(capitalize(plan))}</span></td>
      <td class="text-muted small">${omega.utilities().escapeHTML(timeAgo)}</td>
    `;
    $tbody.appendChild($row);
  });
}

// ============================================
// Recent Orders Table
// ============================================
async function loadRecentOrders() {
  const $loading = document.getElementById('recent-orders-loading');
  const $empty = document.getElementById('recent-orders-empty');
  const $table = document.getElementById('recent-orders-table');
  const $tbody = document.getElementById('recent-orders-tbody');

  const firestore = omega.firestore();
  const snapshot = await firestore.collection('payments-orders')
    .orderBy('metadata.created.timestampUNIX', 'desc')
    .limit(10)
    .get();

  if ($loading) {
    $loading.classList.add('d-none');
  }

  if (snapshot.empty) {
    if ($empty) {
      $empty.classList.remove('d-none');
    }
    return;
  }

  if ($table) {
    $table.classList.remove('d-none');
  }

  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    const orderId = doc.id;
    const product = data?.productId || 'Unknown';
    const processor = data?.processor || 'Unknown';
    const created = data?.metadata?.created?.timestampUNIX;
    const timeAgo = created ? formatTimeAgo(created * 1000) : 'Unknown';

    const $row = document.createElement('tr');
    $row.innerHTML = `
      <td class="font-monospace small text-truncate" style="max-width: 120px;" title="${omega.utilities().escapeHTML(orderId)}">${omega.utilities().escapeHTML(orderId)}</td>
      <td><span class="omega-chip omega-chip--accent">${omega.utilities().escapeHTML(capitalize(product))}</span></td>
      <td class="small">${omega.utilities().escapeHTML(capitalize(processor))}</td>
      <td class="text-muted small">${omega.utilities().escapeHTML(timeAgo)}</td>
    `;
    $tbody.appendChild($row);
  });
}

// ============================================
// Admin Tools (Cron + Backup)
// ============================================
function initTools() {
  document.querySelectorAll('.btn-run-cron').forEach(($btn) => {
    $btn.addEventListener('click', () => runCron($btn));
  });

  const $backupBtn = document.getElementById('btn-run-backup');
  if ($backupBtn) {
    $backupBtn.addEventListener('click', runBackup);
  }
}

async function runCron($btn) {
  const cronId = $btn.dataset.cronId;
  const $text = $btn.querySelector('.btn-run-cron-text');
  const $result = document.getElementById('cron-result');
  const originalText = $text?.textContent;

  $btn.disabled = true;
  if ($text) $text.textContent = 'Running...';

  try {
    await omega.request(`/omega/admin/cron`, {
      method: 'POST',
      timeout: 5 * 60 * 1000,
      response: 'text',
      tries: 1,
      log: true,
      body: { id: cronId },
    });

    if ($result) {
      $result.classList.remove('d-none');
      $result.innerHTML = `<div class="alert alert-success small mb-0 py-2">Cron <strong>${omega.utilities().escapeHTML(cronId)}</strong> completed successfully</div>`;
    }
  } catch (error) {
    console.error(`Cron ${cronId} failed:`, error);
    if ($result) {
      $result.classList.remove('d-none');
      $result.innerHTML = `<div class="alert alert-danger small mb-0 py-2">Cron <strong>${omega.utilities().escapeHTML(cronId)}</strong> failed: ${omega.utilities().escapeHTML(error.message || 'Unknown error')}</div>`;
    }
  }

  $btn.disabled = false;
  if ($text) $text.textContent = originalText;
}

async function runBackup() {
  const $btn = document.getElementById('btn-run-backup');
  const $text = document.getElementById('btn-run-backup-text');
  const $result = document.getElementById('backup-result');

  if (!confirm('Start a Firestore backup? This may take a few minutes.')) {
    return;
  }

  if ($btn) $btn.disabled = true;
  if ($text) $text.textContent = 'Running...';

  try {
    await omega.request(`/omega/admin/backup`, {
      method: 'POST',
      timeout: 5 * 60 * 1000,
      tries: 1,
      log: true,
      body: {},
    });

    if ($result) {
      $result.classList.remove('d-none');
      $result.innerHTML = `<div class="alert alert-success small mb-0 py-2">Backup started successfully</div>`;
    }
  } catch (error) {
    console.error('Backup failed:', error);
    if ($result) {
      $result.classList.remove('d-none');
      $result.innerHTML = `<div class="alert alert-danger small mb-0 py-2">Backup failed: ${omega.utilities().escapeHTML(error.message || 'Unknown error')}</div>`;
    }
  }

  if ($btn) $btn.disabled = false;
  if ($text) $text.textContent = 'Run backup';
}
