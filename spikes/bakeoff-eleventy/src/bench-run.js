/**
 * Bench harness for the Eleventy candidate:
 * 1. Cold full build ×3 (+1 warmup) via the shared bench harness.
 * 2. Incremental: `eleventy --watch --incremental` (farm layouts), touching a
 *    post, a theme layout, and a theme include, parsing the [11ty] "Wrote …
 *    in …" lines.
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

const TOUCH_TARGETS = [
  ['1 post', path.join(CORPUS, '_posts', '2022')],
  ['1 layout', path.join(ROOT, 'packages', 'web', 'core', '_layouts', 'blueprint', 'index.html')],
  ['1 include', path.join(ROOT, 'packages', 'web', 'themes', 'classy', '_includes', 'frontend', 'sections', 'nav.html')],
];

async function main() {
  // ---- Cold builds
  const cold = bench({
    command: 'node src/build.js',
    runs: 3,
    warmup: 1,
    label: 'eleventy cold full build',
  });
  console.log('\nCOLD:', JSON.stringify(cold));

  // ---- Incremental (watch mode)
  const targets = TOUCH_TARGETS.map(([label, target]) => {
    if (fs.statSync(target).isDirectory()) {
      const first = fs.readdirSync(target).find((name) => name.endsWith('.md'));
      return [label, path.join(target, first)];
    }
    return [label, target];
  });

  const child = spawn('npx', ['@11ty/eleventy', '--watch', '--incremental'], {
    cwd: SPIKE,
    env: { ...process.env },
  });

  let buffer = '';
  const waitForWrote = () =>
    new Promise((resolve, reject) => {
      const onData = (chunk) => {
        buffer += chunk.toString();
        const match = buffer.match(/Wrote (\d+) files? in ([\d.]+) seconds/);
        if (match) {
          buffer = '';
          child.stdout.off('data', onData);
          resolve({ files: Number(match[1]), seconds: Number(match[2]) });
        }
      };
      child.stdout.on('data', onData);
      child.on('exit', (code) => reject(new Error(`eleventy exited ${code}`)));
      setTimeout(() => reject(new Error('timed out waiting for [11ty] Wrote')), 120000);
    });

  const initial = await waitForWrote();
  console.log(`\nwatch initial build: ${initial.seconds}s (${initial.files} files)`);

  const incremental = {};
  for (const [label, target] of targets) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const original = fs.readFileSync(target, 'utf8');
    fs.writeFileSync(target, `${original}\n`);
    try {
      const result = await waitForWrote();
      incremental[label] = result;
      console.log(`touch ${label} (${path.basename(target)}): ${result.seconds}s (${result.files} files)`);
    } finally {
      fs.writeFileSync(target, original);
      await new Promise((resolve) => setTimeout(resolve, 750));
      buffer = '';
    }
  }

  child.kill();
  console.log('\nINCREMENTAL:', JSON.stringify(incremental));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
