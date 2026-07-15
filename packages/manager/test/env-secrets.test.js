// Tests for src/lib/env-secrets.js (cp114) — the service secret gate:
// present → proceed; missing + non-interactive → skip with a
// machine-readable missingEnv list; missing + interactive → masked ask,
// brand-.env writeback, process.env export, proceed. Plus the run-summary
// 🔑 aggregation those skips feed.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { setPromptStreams } = require('@omega.js/devkit/prompt');
const { ensureEnvSecrets } = require('../src/lib/env-secrets.js');

const VAR = 'OMEGA_TEST_FAKE_SECRET';
const VAR2 = 'OMEGA_TEST_FAKE_SECRET_TWO';

function withStreams(isTTY, fn) {
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = isTTY;
  output.isTTY = isTTY;
  setPromptStreams({ input, output });
  try {
    return fn();
  } finally {
    setPromptStreams(null);
  }
}

function cleanup(...vars) {
  for (const name of vars) delete process.env[name];
}

test('env-secrets: everything present → proceed (null), nothing asked', async () => {
  process.env[VAR] = 'already-set';
  try {
    const gate = await ensureEnvSecrets({ brandRoot: '/nope', options: {} }, [{ name: VAR }], {
      prompt: { password: () => { throw new Error('must not prompt'); } },
    });
    assert.equal(gate, null);
  } finally {
    cleanup(VAR);
  }
});

test('env-secrets: missing + non-interactive → skip with the missingEnv list', async () => {
  cleanup(VAR, VAR2);
  const gate = await withStreams(false, () =>
    ensureEnvSecrets({ brandRoot: '/nope', options: {} }, [{ name: VAR }, { name: VAR2 }]));

  assert.equal(gate.skip, true);
  assert.match(gate.reason, new RegExp(`${VAR}, ${VAR2}`));
  assert.match(gate.reason, /rerun interactively/);
  assert.deepEqual(gate.missingEnv, [VAR, VAR2]);
});

test('env-secrets: dry-run never asks even on a TTY', async () => {
  cleanup(VAR);
  const gate = await withStreams(true, () =>
    ensureEnvSecrets({ brandRoot: '/nope', options: { dryRun: true } }, [{ name: VAR }], {
      prompt: { password: () => { throw new Error('must not prompt'); } },
    }));

  assert.equal(gate.skip, true);
  assert.deepEqual(gate.missingEnv, [VAR]);
});

test('env-secrets: interactive ask saves to the brand .env, exports, proceeds', async () => {
  cleanup(VAR, VAR2);
  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-env-'));
  fs.writeFileSync(path.join(brandRoot, '.env'), 'EXISTING_KEY="keep-me"\n');

  const asked = [];
  try {
    const gate = await withStreams(true, () =>
      ensureEnvSecrets({ brandRoot, options: {} }, [{ name: VAR, label: 'Fake token' }, { name: VAR2 }], {
        prompt: { password: async ({ message }) => { asked.push(message); return `pasted-${asked.length}  `; } },
      }));

    assert.equal(gate, null);
    assert.deepEqual(asked, [`Paste ${VAR}:`, `Paste ${VAR2}:`]);
    // trimmed, exported for THIS run
    assert.equal(process.env[VAR], 'pasted-1');
    assert.equal(process.env[VAR2], 'pasted-2');
    // persisted for every future run, existing content intact
    const env = fs.readFileSync(path.join(brandRoot, '.env'), 'utf8');
    assert.match(env, /EXISTING_KEY="keep-me"/);
    assert.match(env, new RegExp(`${VAR}="pasted-1"`));
    assert.match(env, new RegExp(`${VAR2}="pasted-2"`));
  } finally {
    cleanup(VAR, VAR2);
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('env-secrets: a url\'d secret walks the user to the exact mint page before the paste', async () => {
  cleanup(VAR);
  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-env-'));

  const events = [];
  try {
    const gate = await withStreams(true, () =>
      ensureEnvSecrets({ brandRoot, options: {} }, [{ name: VAR, label: 'Fake token', url: 'https://example.com/mint' }], {
        prompt: {
          pressEnterToOpen: async (url, label) => { events.push(['open', url, label]); return true; },
          password: async () => { events.push(['paste']); return 'v'; },
        },
      }));

    assert.equal(gate, null);
    // Guide first (the exact page), paste second
    assert.deepEqual(events, [['open', 'https://example.com/mint', 'the Fake token page'], ['paste']]);
    assert.equal(process.env[VAR], 'v');
  } finally {
    cleanup(VAR);
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('env-secrets: empty paste → skip (no writeback, no export)', async () => {
  cleanup(VAR);
  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-env-'));
  try {
    const gate = await withStreams(true, () =>
      ensureEnvSecrets({ brandRoot, options: {} }, [{ name: VAR }], {
        prompt: { password: async () => '   ' },
      }));

    assert.equal(gate.skip, true);
    assert.deepEqual(gate.missingEnv, [VAR]);
    assert.equal(process.env[VAR], undefined);
    assert.equal(fs.existsSync(path.join(brandRoot, '.env')), false);
  } finally {
    cleanup(VAR);
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('run-summary: skipped-for-secrets services aggregate into the 🔑 section', async () => {
  const { RunSummary } = require('../src/lib/run-summary.js');

  const summary = new RunSummary();
  summary.add('brand-a', 'Brand A', 'cloudflare', { status: 'skipped', reason: 'missing CLOUDFLARE_TOKEN', missingEnv: ['CLOUDFLARE_TOKEN'] });
  summary.add('brand-a', 'Brand A', 'domain', { status: 'skipped', reason: 'missing NAMECHEAP…', missingEnv: ['NAMECHEAP_USERNAME', 'NAMECHEAP_API_KEY'] });
  summary.add('brand-a', 'Brand A', 'github', { status: 'success' });

  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    summary.printSummary();
  } finally {
    console.log = original;
  }

  const text = lines.join('\n');
  assert.match(text, /Missing secrets/);
  assert.match(text, /cloudflare: CLOUDFLARE_TOKEN/);
  assert.match(text, /domain: NAMECHEAP_USERNAME, NAMECHEAP_API_KEY/);
  assert.match(text, /--service=cloudflare/);
  assert.match(text, /--service=domain/);
});
