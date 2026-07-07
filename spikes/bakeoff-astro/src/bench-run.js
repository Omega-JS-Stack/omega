/**
 * Bench harness for the Astro candidate:
 * 1. Cold full build ×3 (+1 warmup) via the shared bench harness.
 * 2. Dev-server reload: Astro renders on demand (no incremental static
 *    rebuild — a full `astro build` IS the rebuild story), so the dev
 *    numbers are timed HTTP requests: first render of a post, then
 *    re-request after touching a post / a theme layout / a theme component.
 *
 * Prints RESULTS.md-ready numbers.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { bench } = require('@omegajs/bakeoff-shared/src/bench.js');

const SPIKE = path.resolve(__dirname, '..');
const ROOT = path.resolve(SPIKE, '..', '..');
const CORPUS = path.join(ROOT, 'spikes', 'bakeoff-shared', 'corpus');
const PORT = 4399;

const TOUCH_TARGETS = [
  ['1 post', path.join(CORPUS, '_posts', '2022')],
  ['1 layout', path.join(SPIKE, 'themes', 'classy', 'layouts', 'core', 'base.astro')],
  ['1 component', path.join(SPIKE, 'themes', 'classy', 'components', 'head.astro')],
];

async function main() {
  // ---- Cold builds
  const cold = bench({
    command: 'node src/build.js',
    runs: 3,
    warmup: 1,
    label: 'astro cold full build',
  });
  console.log('\nCOLD:', JSON.stringify(cold));

  // ---- Dev server (on-demand rendering)
  const targets = TOUCH_TARGETS.map(([label, target]) => {
    if (fs.statSync(target).isDirectory()) {
      const first = fs.readdirSync(target).find((name) => name.endsWith('.md'));
      return [label, path.join(target, first)];
    }
    return [label, target];
  });

  const postSlug = path.basename(targets[0][1]).replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
  const postUrl = `http://localhost:${PORT}/blog/${postSlug}/`;

  const child = spawn('npx', ['astro', 'dev', '--port', String(PORT)], {
    cwd: SPIKE,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
  });
  child.stderr.on('data', () => {});
  child.stdout.on('data', () => {});

  const timedGet = async (url) => {
    const t0 = process.hrtime.bigint();
    const response = await fetch(url);
    await response.text();
    if (!response.ok) throw new Error(`${url} → ${response.status}`);
    return Number(process.hrtime.bigint() - t0) / 1e9;
  };

  const waitForServer = async () => {
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        await fetch(`http://localhost:${PORT}/`);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    throw new Error('dev server never came up');
  };

  const t0 = process.hrtime.bigint();
  await waitForServer();
  const startup = Number(process.hrtime.bigint() - t0) / 1e9;
  console.log(`\ndev server up: ${startup.toFixed(2)}s`);

  const first = await timedGet(postUrl);
  console.log(`first post render: ${first.toFixed(2)}s`);

  const reload = {};
  for (const [label, target] of targets) {
    const original = fs.readFileSync(target, 'utf8');
    fs.writeFileSync(target, `${original}\n`);
    try {
      await new Promise((resolve) => setTimeout(resolve, 750));
      reload[label] = await timedGet(postUrl);
      console.log(`touch ${label} (${path.basename(target)}): re-render ${reload[label].toFixed(2)}s`);
    } finally {
      fs.writeFileSync(target, original);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  child.kill();
  console.log('\nDEV:', JSON.stringify({ startup, first, reload }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
