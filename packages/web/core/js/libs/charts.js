// Charting — the framework's TanStack Charts, drawn in the theme's own colors.
//
// The dependency is the FRAMEWORK's: @tanstack/charts is a dependency of
// @omega.js/web, never a CDN load at runtime (Ian 2026-07-27), and a page
// reaches it ONLY through this module. Consumers import these helpers and
// never name the library, so its version and delivery stay ours to change.
//
// It is still lazy: every import below is dynamic, and the bundle is ESM with
// splitting (src/assets.js), so the library lands in chunks that a page
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

// The slot's box height, and the height a draw falls back to when its host
// element has not been laid out yet.
const DEFAULT_HEIGHT = 220;

// The chart library, once it is here. Set by loadCharts, read by every draw.
let lib = null;
let pending = null;

// Every mounted host, by the id it was drawn into. A polled page repaints on
// every feed answer, and an SVG host owns its own DOM, so the previous host
// for an id is destroyed before the next one mounts.
const hosts = new Map();

/**
 * Load TanStack Charts once. Idempotent and safe to call on every poll.
 *
 * The one cost of a split chunk: it is a network fetch, so a page loaded
 * offline has no charts. Every chart sits beside the same numbers in a table
 * or a statgrid, and `chartSlot` says so in place of the host — nothing
 * becomes unreadable, and nothing goes blank.
 *
 * @returns {Promise<boolean>} whether the chart library is available
 */
export async function loadCharts() {
  if (lib) {
    return true;
  }

  if (!pending) {
    pending = (async () => {
      try {
        // The grammar is per-capability: the root carries the Cartesian marks
        // and the DOM host, and polar geometry, the tooltip and each scale sit
        // behind their own subpath. They are fetched together, on the first
        // ask, so a caller never names the parts of a chart type it wants.
        const [charts, polar, tooltip, band, linear, point] = await Promise.all([
          import('@tanstack/charts'),
          import('@tanstack/charts/polar'),
          import('@tanstack/charts/tooltip'),
          import('@tanstack/charts/scales/band'),
          import('@tanstack/charts/scales/linear'),
          import('@tanstack/charts/scales/point'),
        ]);

        lib = { charts, polar, tooltip, band, linear, point };
        return true;
      } catch (e) {
        pending = null; // a later poll may find the network back
        console.warn('Failed to load TanStack Charts:', e);
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
export const chartsReady = () => Boolean(lib);

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
 * Resolve a `var(--token)` string against :root — a chart scale's range is a
 * list of real colors, never a reference to one.
 * @param {string} value - a color, or a var() reference to one
 * @returns {string} a color the chart can paint with
 */
export function resolveColor(value) {
  const match = /^var\((--[\w-]+)\)$/.exec(String(value || ''));
  if (!match) {
    return value;
  }

  return getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim() || chartColors().accent;
}

/**
 * The markup a chart is drawn into. The host element follows its container's
 * width and is told its height, so the box carries that height and the host
 * fills it. When the library did not load, the slot says that instead of
 * leaving a hole — the figures it would have drawn are always beside it.
 *
 * `series` is the data the chart will draw, stamped onto the box: a live page
 * only redraws charts when `swap` wrote (@omega.js/client/modules/live-page),
 * and a host carries no data of its own, so without the stamp a data-only
 * change leaves the old picture standing.
 *
 * @param {string} id - the host element id the draw call will name
 * @param {number} [height] - the box height in px
 * @param {Array<number>} [series] - the values the chart will draw
 * @returns {string} markup
 */
export function chartSlot(id, height = DEFAULT_HEIGHT, series = []) {
  // An id is authored, never user input — a bad one is a programmer error.
  if (!ID_SHAPE.test(id)) {
    throw new Error(`[charts] chartSlot: "${id}" is not a usable element id`);
  }

  if (!chartsReady()) {
    return '<p class="omega-micro text-body-secondary mb-0">chart library unavailable; the figures are in the table</p>';
  }

  return `<div style="position: relative; height: ${Number(height)}px;" data-series="${series.map(Number).join(',')}"><div id="${id}" style="height: 100%;"></div></div>`;
}

// Charts draw WITHOUT animation, and on a live page that is the difference
// between a chart and a blank pair of axes: a polled page repaints on every
// feed answer, and each repaint destroys the host and builds it again — so an
// animated chart spends most of its life growing its bars back out of the
// axis from zero. `svgAnimation` is already off by default; it is said out
// loud because the reason is not obvious from the call site.
const baseDefinition = (colors) => ({
  svgAnimation: false,
  // The theme is how a scene reads the token sheet: axis and legend ink,
  // gridlines, and the categorical ramp every unpainted series falls back to.
  theme: {
    foreground: colors.text,
    muted: colors.text,
    grid: colors.grid,
    palette: colors.palette,
  },
});

/**
 * The unit a chart's data carries, printed in the tooltip AND on the value
 * axis. Plain JSON on purpose: a page whose chart data arrives as data alone
 * can carry it, which is the whole point of it living beside the numbers.
 * @typedef {{prefix?: string, suffix?: string, decimals?: number}} ChartFormat
 */

/**
 * A reading, printed for a person: the number in the reader's own grouping,
 * wrapped in whatever unit the data says it carries. ONE helper, because a
 * tooltip and the axis it is read against must never disagree.
 *
 * @param {number} value - the reading
 * @param {ChartFormat} [format] - the data's own unit
 * @returns {string} the value as the reader sees it
 */
function formatValue(value, format = {}) {
  // Stated decimals are exact — a price says "$7.00", never "$7". Unstated, a
  // count prints as itself and a rate gets at most two places, so neither kind
  // of chart has to declare which one it is.
  const digits = Number.isFinite(format.decimals)
    ? { minimumFractionDigits: format.decimals, maximumFractionDigits: format.decimals }
    : { maximumFractionDigits: 2 };

  return `${format.prefix || ''}${Number(value).toLocaleString(undefined, digits)}${format.suffix || ''}`;
}

// What a hover says. The library's own default names the CHANNELS a mark rode
// in on — "x" and "y" — and a reader wants the thing being read, so every
// builder carries one of these lines instead.
const labelLine = (datum, format) => `${datum.label}: ${formatValue(datum.value, format)}`;
const seriesLine = (datum, format) => `${datum.series} · ${labelLine(datum, format)}`;
// A share of one whole is read as a percentage, so the slice says its own.
// `pie` already resolved each row's `fraction`, so this costs a format.
const shareLine = (datum, format) => `${labelLine(datum, format)} (${(datum.fraction * 100).toFixed(1)}%)`;

/**
 * The tooltip a definition mounts: the author's own line when they passed one,
 * else the builder's, with the value in the data's own unit.
 */
const tooltipFor = (data, line) => ({
  use: lib.tooltip.tooltip,
  format: data.tooltip || ((point) => line(point.datum, data.format)),
});

/** The categorical axis: one band per label, the bar's width its bandwidth. */
const categoryScale = (labels) => ({ scale: () => lib.band.scaleBand().domain(labels).padding(0.16) });

// A chart here counts THINGS — signups, plans, events — and half a signup is
// not a reading. The library's own tick policy is a responsive count, so a
// small domain lands on 0.5; these are the whole-number candidates that
// replace it, on the 1/2/5 ladder so the labels stay round as the data grows.
const NICE_STEPS = [1, 2, 5];

/**
 * Whole-number tick candidates spanning the values, zero always among them.
 *
 * Zero stays in view because a bar's LENGTH is the reading: an axis that
 * omitted the baseline would turn a small difference into a large one (the old
 * `beginAtZero`). A negative reading widens the span downwards rather than
 * falling out of the plot.
 */
function integerTicks(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  const low = Math.min(0, ...numbers);
  const high = Math.max(0, ...numbers);
  // At least 1, so an all-zero series still gets an axis with two ends on it.
  const target = Math.max(1, high - low) / 6;
  // Never below 1: a magnitude under one is where the fractional ticks come from.
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(target)));
  const step = (NICE_STEPS.find((factor) => factor * magnitude >= target) || 10) * magnitude;
  const first = Math.floor(low / step) * step;
  const last = Math.max(first + step, Math.ceil(high / step) * step);
  const ticks = [];

  for (let tick = first; tick <= last; tick += step) {
    ticks.push(tick);
  }

  return ticks;
}

/**
 * The quantitative axis: first tick to last, labelled in whole numbers.
 *
 * The scale is a configured INSTANCE, not a factory, because that is what
 * makes the domain the application's — the axis then ends exactly on its outer
 * ticks instead of on a niced bound the tick candidates do not reach. The
 * format is ours for the same reason the values are: the library's own label
 * formatter prints "0.0, 1.0" once the domain is small enough to need a
 * decimal, and a count has none.
 *
 * @param {Array<number>} values - the numbers the axis has to span
 * @param {ChartFormat} [format] - the data's own unit, so the axis says it too
 */
function valueScale(values, format) {
  const ticks = integerTicks(values);

  return {
    scale: lib.linear.scaleLinear().domain([ticks[0], ticks[ticks.length - 1]]),
    grid: true,
    axis: { ticks: { values: ticks, format: (value) => formatValue(value, format) } },
  };
}

/** What a stacked bar's axis has to span: the total standing at each label. */
const stackTotals = (data) => data.labels.map((_, i) => data.series.reduce(
  (total, series) => total + (Number(series.values[i]) || 0),
  0,
));

/** `{labels, values}` as the rows the marks map their channels out of. */
const valueRows = (data) => data.labels.map((label, i) => ({ label: String(label), value: Number(data.values[i]) }));

/** `{labels, series}` flattened: one row per label per series. */
const seriesRows = (data) => data.series.flatMap((series) => data.labels.map((label, i) => ({
  label: String(label),
  series: String(series.label),
  value: Number(series.values[i]),
})));

/** One paint per series — the author's color, else the next categorical slot. */
const seriesRange = (data, colors) => data.series.map((series, i) => (
  series.color ? resolveColor(series.color) : colors.palette[i % colors.palette.length]
));

function barDefinition(data, colors) {
  const { defineChart, barX, barY } = lib.charts;
  const labels = data.labels.map(String);
  const rows = valueRows(data);
  const paints = (data.colors || []).map(resolveColor);
  // A per-bar palette goes through the chart color scale; one flat color is a
  // paint override, which keeps a single-series bar out of the legend path.
  const paint = paints.length ? { color: 'label' } : { fill: colors.accent };
  const bar = { radius: 4, maxThickness: 28, ...paint };

  return defineChart({
    // `horizontal` is a ranked-rows shape: the categories run down the y axis.
    marks: [data.horizontal
      ? barX(rows, { x: 'value', y: 'label', ...bar })
      : barY(rows, { x: 'label', y: 'value', ...bar })],
    scales: data.horizontal
      ? { x: valueScale(data.values, data.format), y: categoryScale(labels) }
      : { x: categoryScale(labels), y: valueScale(data.values, data.format) },
    ...(paints.length ? { color: { domain: labels, range: paints } } : {}),
    ...baseDefinition(colors),
    tooltip: tooltipFor(data, labelLine),
  });
}

function stackedBarDefinition(data, colors) {
  const { colorLegend, defineChart, barY, stack } = lib.charts;
  const labels = data.labels.map(String);

  return defineChart({
    // Repeated categories stack by default; `stack()` says so at the call site.
    marks: [barY(seriesRows(data), {
      x: 'label',
      y: 'value',
      z: 'series',
      color: 'series',
      layout: stack(),
      radius: 3,
      maxThickness: 28,
    })],
    scales: { x: categoryScale(labels), y: valueScale(stackTotals(data), data.format) },
    color: {
      domain: data.series.map((series) => String(series.label)),
      range: seriesRange(data, colors),
      legend: colorLegend({ placement: 'bottom' }),
    },
    ...baseDefinition(colors),
    tooltip: tooltipFor(data, seriesLine),
  });
}

function doughnutDefinition(data, colors) {
  const { colorLegend, defineChart } = lib.charts;
  const { pie, polar, radialArc } = lib.polar;
  const labels = data.labels.map(String);
  const rows = valueRows(data);
  const range = (data.colors || []).length ? data.colors.map(resolveColor) : colors.palette.slice(0, rows.length);

  return defineChart({
    marks: [polar({
      inset: 8,
      radiusRatio: 0.9,
      // `pie` allocates the values into angles; the arc's inner radius rides
      // the resolved outer one, so the ring holds its proportions on resize.
      marks: [radialArc(pie(rows, { value: 'value' }), {
        innerRadius: ({ radius }) => radius * 0.58,
        color: 'label',
        key: 'label',
      })],
      scales: { angle: null, radius: null },
    })],
    scales: { x: null, y: null },
    color: { domain: labels, range, legend: colorLegend({ placement: 'bottom' }) },
    ...baseDefinition(colors),
    tooltip: tooltipFor(data, shareLine),
  });
}

function lineDefinition(data, colors) {
  const { colorLegend, defineChart, lineY } = lib.charts;

  return defineChart({
    marks: [lineY(seriesRows(data), { x: 'label', y: 'value', z: 'series', color: 'series', points: true })],
    scales: { x: { scale: () => lib.point.scalePoint().padding(0.2) }, y: valueScale(data.series.flatMap((series) => series.values), data.format) },
    color: {
      domain: data.series.map((series) => String(series.label)),
      range: seriesRange(data, colors),
      // One series names itself in the surrounding copy; several need saying.
      ...(data.series.length > 1 ? { legend: colorLegend({ placement: 'bottom' }) } : {}),
    },
    ...baseDefinition(colors),
    tooltip: tooltipFor(data, seriesLine),
  });
}

const DEFINITIONS = {
  bar: barDefinition,
  stacked: stackedBarDefinition,
  doughnut: doughnutDefinition,
  line: lineDefinition,
};

/**
 * The chart definition a builder would draw, without drawing it.
 *
 * A definition is renderer-neutral and DOM-free: it is what `mountChart`
 * mounts in a browser and what `createChartScene` compiles into geometry in
 * node, which is how the four builders are pinned by the package's own suite
 * (`test/dataviz.test.js`) rather than only in a real browser.
 *
 * @param {'bar'|'stacked'|'doughnut'|'line'} kind - which builder's shape
 * @param {object} data - that builder's data argument
 * @returns {object|null} the definition, or null when the library is not here
 */
export function chartDefinition(kind, data) {
  // A kind is authored, never user input — a bad one is a programmer error.
  if (!DEFINITIONS[kind]) {
    throw new Error(`[charts] chartDefinition: "${kind}" is not a chart kind`);
  }

  if (!chartsReady()) {
    return null;
  }

  return DEFINITIONS[kind](data, chartColors());
}

/** Draw into `id`, replacing whatever chart was there (every poll repaints). */
function draw(id, kind, data, ariaLabel) {
  if (!chartsReady()) {
    return null;
  }

  // The previous host goes FIRST, before anything can return early: a slot the
  // page has since removed still owns a live ResizeObserver until it is told
  // otherwise, and nothing else would ever reach it.
  const existing = hosts.get(id);
  if (existing) {
    existing.destroy();
    hosts.delete(id);
  }

  const container = document.getElementById(id);
  if (!container) {
    return null;
  }

  // The host follows its container's WIDTH on its own; the height is ours to
  // give, and the box the slot wrote is where it comes from.
  const host = lib.charts.mountChart(container, {
    definition: chartDefinition(kind, data),
    height: container.clientHeight || DEFAULT_HEIGHT,
    ariaLabel,
  });

  hosts.set(id, host);
  return host;
}

/**
 * A bar chart. `horizontal` turns it into a ranked-rows shape; the default
 * vertical shape is for a series over time.
 *
 * `format` is the data's own unit: it prints in the tooltip and on the value
 * axis, and being JSON it travels with data-only chart data. `tooltip` takes
 * the whole line over instead, and needs a page with JS to pass a function.
 * @param {string} id - the host element id from `chartSlot`
 * @param {{labels: string[], values: number[], colors?: string[], horizontal?: boolean, label?: string, format?: ChartFormat, tooltip?: (point: object) => string}} data
 * @returns {object|null} the chart host, or null when nothing was drawn
 */
export function barChart(id, data) {
  return draw(id, 'bar', data, data.label || 'Bar chart');
}

/**
 * A stacked bar chart — one bar per label, one color per series.
 *
 * `format` is the data's own unit: it prints in the tooltip and on the value
 * axis, and being JSON it travels with data-only chart data. `tooltip` takes
 * the whole line over instead, and needs a page with JS to pass a function.
 * @param {string} id - the host element id from `chartSlot`
 * @param {{labels: string[], series: Array<{label: string, values: number[], color?: string}>, format?: ChartFormat, tooltip?: (point: object) => string}} data
 * @returns {object|null} the chart host, or null when nothing was drawn
 */
export function stackedBarChart(id, data) {
  return draw(id, 'stacked', data, 'Stacked bar chart');
}

/**
 * A doughnut — for a split that is a share of one whole.
 *
 * `format` is the data's own unit, printed in the tooltip beside the slice's
 * share (a doughnut has no axis to carry it), and being JSON it travels with
 * data-only chart data. `tooltip` takes the whole line over instead, and needs
 * a page with JS to pass a function.
 * @param {string} id - the host element id from `chartSlot`
 * @param {{labels: string[], values: number[], colors?: string[], format?: ChartFormat, tooltip?: (point: object) => string}} data
 * @returns {object|null} the chart host, or null when nothing was drawn
 */
export function doughnutChart(id, data) {
  return draw(id, 'doughnut', data, 'Doughnut chart');
}

/**
 * A line chart over time.
 *
 * `format` is the data's own unit: it prints in the tooltip and on the value
 * axis, and being JSON it travels with data-only chart data. `tooltip` takes
 * the whole line over instead, and needs a page with JS to pass a function.
 * @param {string} id - the host element id from `chartSlot`
 * @param {{labels: string[], series: Array<{label: string, values: number[], color?: string}>, format?: ChartFormat, tooltip?: (point: object) => string}} data
 * @returns {object|null} the chart host, or null when nothing was drawn
 */
export function lineChart(id, data) {
  return draw(id, 'line', data, 'Line chart');
}
