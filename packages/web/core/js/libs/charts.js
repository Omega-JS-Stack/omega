// Charting — the framework's Chart.js, drawn in the theme's own colors.
//
// The dependency is the FRAMEWORK's: chart.js is a dependency of
// @omega.js/web, never a CDN load at runtime (Ian 2026-07-27), and a page
// reaches it ONLY through this module. Consumers import these helpers and
// never name the library, so its version and delivery stay ours to change.
//
// It is still lazy: the import below is dynamic, and the bundle is ESM with
// splitting (src/assets.js), so Chart.js lands in its own chunk that a page
// fetches the moment it asks for a chart — a page with no chart pays nothing.
// Same idiom as the admin dashboard's `await import('firebase/firestore')`.
//
// The colors come off the token sheet (docs/shared/theming.md), which is what
// makes a chart follow the brand ramp and dark mode without knowing either
// exists — and reading the CATEGORICAL ramp (--omega-chart-1…6) is what makes
// a series and its `.omega-badge-tone` chip the same color for the same thing.

// Element ids are authored — a chart is drawn into a slot the page wrote — so
// the slot never escapes, it REFUSES anything that is not a plain id.
const ID_SHAPE = /^[a-z][\w-]*$/i;

// The chart library, once it is here. Set by loadCharts, read by every draw.
let Chart = null;
let pending = null;

/**
 * Load Chart.js once. Idempotent and safe to call on every poll.
 *
 * The one cost of a split chunk: it is a network fetch, so a page loaded
 * offline has no charts. Every chart sits beside the same numbers in a table
 * or a statgrid, and `chartSlot` says so in place of the canvas — nothing
 * becomes unreadable, and nothing goes blank.
 *
 * @returns {Promise<boolean>} whether Chart.js is available
 */
export async function loadCharts() {
  if (Chart) {
    return true;
  }

  if (!pending) {
    pending = (async () => {
      try {
        // chart.js/auto registers every controller, scale and element, so a
        // caller never names the parts of a chart type it wants.
        const module = await import('chart.js/auto');
        Chart = module.default;
        return true;
      } catch (e) {
        pending = null; // a later poll may find the network back
        console.warn('Failed to load Chart.js:', e);
        return false;
      }
    })();
  }

  return pending;
}

/**
 * Whether a chart can be drawn right now — synchronous, for render paths.
 * @returns {boolean}
 */
export const chartsReady = () => Boolean(Chart);

/**
 * The theme's chart colors, read off :root.
 *
 * Fallbacks run token → Bootstrap variable → hardcoded, so a surface that
 * carries neither sheet still draws something legible.
 *
 * @returns {{text: string, grid: string, accent: string, palette: string[]}}
 */
export function chartColors() {
  const style = getComputedStyle(document.documentElement);
  const token = (name) => style.getPropertyValue(name).trim();
  const accent = token('--omega-accent') || '#2563eb';
  const series = (slot, fallback) => token(`--omega-chart-${slot}`) || fallback;

  return {
    text: token('--omega-ink-muted') || token('--bs-body-color') || '#6c757d',
    grid: token('--omega-line') || token('--bs-border-color') || '#dee2e6',
    accent,
    palette: [
      series(1, accent),
      series(2, '#0f8fa9'),
      series(3, '#7a45b5'),
      series(4, '#b0416a'),
      series(5, '#a06a08'),
      series(6, '#6a7f2b'),
    ],
  };
}

/**
 * Resolve a `var(--token)` string against :root — Chart.js needs a real color.
 * @param {string} value - a color, or a var() reference to one
 * @returns {string} a color Chart.js can paint with
 */
export function resolveColor(value) {
  const match = /^var\((--[\w-]+)\)$/.exec(String(value || ''));
  if (!match) {
    return value;
  }

  return getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim() || chartColors().accent;
}

/**
 * The markup a chart is drawn into. A canvas has no intrinsic height, so the
 * box carries it. When the library did not load, the slot says that instead
 * of leaving a hole — the figures it would have drawn are always beside it.
 *
 * `series` is the data the chart will draw, stamped onto the box: a live page
 * only redraws charts when `swap` wrote (@omega.js/client/modules/live-page),
 * and a canvas carries no data of its own, so without the stamp a data-only
 * change leaves the old picture standing.
 *
 * @param {string} id - the canvas id the draw call will name
 * @param {number} [height] - the box height in px
 * @param {Array<number>} [series] - the values the chart will draw
 * @returns {string} markup
 */
export function chartSlot(id, height = 220, series = []) {
  // An id is authored, never user input — a bad one is a programmer error.
  if (!ID_SHAPE.test(id)) {
    throw new Error(`[charts] chartSlot: "${id}" is not a usable element id`);
  }

  if (!chartsReady()) {
    return '<p class="classy-micro text-body-secondary mb-0">chart library unavailable — the figures are in the table</p>';
  }

  return `<div style="position: relative; height: ${Number(height)}px;" data-series="${series.map(Number).join(',')}"><canvas id="${id}"></canvas></div>`;
}

/** Draw into `id`, replacing whatever chart was there (every poll repaints). */
function draw(id, config) {
  if (!Chart) {
    return null;
  }

  const canvas = document.getElementById(id);
  if (!canvas) {
    return null;
  }

  const existing = Chart.getChart(canvas);
  if (existing) {
    existing.destroy();
  }

  return new Chart(canvas, config);
}

// Charts draw WITHOUT animation, and on a live page that is the difference
// between a chart and a blank pair of axes: a polled page repaints on every
// feed answer, and each repaint destroys the chart and builds it again — so
// an animated chart spends most of its life growing its bars back out of the
// axis from zero. Off, the data is on screen in the first painted frame.
const baseOptions = (colors) => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  plugins: {
    legend: { display: false },
  },
  scales: {
    x: { ticks: { color: colors.text }, grid: { display: false } },
    y: { beginAtZero: true, ticks: { color: colors.text, precision: 0 }, grid: { color: colors.grid } },
  },
});

/**
 * A bar chart. `horizontal` turns it into a ranked-rows shape; the default
 * vertical shape is for a series over time.
 * @param {string} id - the canvas id from `chartSlot`
 * @param {{labels: string[], values: number[], colors?: string[], horizontal?: boolean, label?: string}} data
 * @returns {object|null} the Chart instance, or null when nothing was drawn
 */
export function barChart(id, data) {
  if (!chartsReady()) {
    return null;
  }

  const colors = chartColors();
  const options = baseOptions(colors);

  if (data.horizontal) {
    options.indexAxis = 'y';
    options.scales = {
      x: { beginAtZero: true, ticks: { color: colors.text, precision: 0 }, grid: { color: colors.grid } },
      y: { ticks: { color: colors.text }, grid: { display: false } },
    };
  }

  return draw(id, {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: [{
        label: data.label || '',
        data: data.values,
        backgroundColor: (data.colors || []).length ? data.colors.map(resolveColor) : colors.accent,
        borderRadius: 4,
        maxBarThickness: 28,
      }],
    },
    options,
  });
}

/**
 * A stacked bar chart — one bar per label, one color per series.
 * @param {string} id - the canvas id from `chartSlot`
 * @param {{labels: string[], series: Array<{label: string, values: number[], color?: string}>}} data
 * @returns {object|null} the Chart instance, or null when nothing was drawn
 */
export function stackedBarChart(id, data) {
  if (!chartsReady()) {
    return null;
  }

  const colors = chartColors();
  const options = baseOptions(colors);
  options.plugins.legend = { display: true, position: 'bottom', labels: { color: colors.text, boxWidth: 12 } };
  options.scales.x.stacked = true;
  options.scales.y.stacked = true;

  return draw(id, {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: data.series.map((series, i) => ({
        label: series.label,
        data: series.values,
        backgroundColor: series.color ? resolveColor(series.color) : colors.palette[i % colors.palette.length],
        borderRadius: 3,
        maxBarThickness: 28,
      })),
    },
    options,
  });
}

/**
 * A doughnut — for a split that is a share of one whole.
 * @param {string} id - the canvas id from `chartSlot`
 * @param {{labels: string[], values: number[], colors?: string[]}} data
 * @returns {object|null} the Chart instance, or null when nothing was drawn
 */
export function doughnutChart(id, data) {
  if (!chartsReady()) {
    return null;
  }

  const colors = chartColors();

  return draw(id, {
    type: 'doughnut',
    data: {
      labels: data.labels,
      datasets: [{
        data: data.values,
        backgroundColor: (data.colors || []).length
          ? data.colors.map(resolveColor)
          : colors.palette.slice(0, data.values.length),
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: colors.text, padding: 12, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const sum = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
              return ` ${ctx.label}: ${ctx.parsed.toLocaleString()} (${((ctx.parsed / sum) * 100).toFixed(1)}%)`;
            },
          },
        },
      },
    },
  });
}

/**
 * A line chart over time.
 * @param {string} id - the canvas id from `chartSlot`
 * @param {{labels: string[], series: Array<{label: string, values: number[], color?: string}>}} data
 * @returns {object|null} the Chart instance, or null when nothing was drawn
 */
export function lineChart(id, data) {
  if (!chartsReady()) {
    return null;
  }

  const colors = chartColors();
  const options = baseOptions(colors);
  options.plugins.legend = { display: data.series.length > 1, position: 'bottom', labels: { color: colors.text, boxWidth: 12 } };

  return draw(id, {
    type: 'line',
    data: {
      labels: data.labels,
      datasets: data.series.map((series, i) => {
        const color = series.color ? resolveColor(series.color) : colors.palette[i % colors.palette.length];

        return {
          label: series.label,
          data: series.values,
          borderColor: color,
          backgroundColor: color,
          fill: false,
          tension: 0.3,
          pointRadius: 2,
        };
      }),
    },
    options,
  });
}
