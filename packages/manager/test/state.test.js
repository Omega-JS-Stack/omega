// Tests for src/lib/state.js — the .omega/state.json durable store. #148
// removed the pre-cp134 service-name key migration: readState is a bare read,
// so a legacy key (`firebase`, `sentry`, `sendgrid`, `beehiiv`) is ignored and
// its service re-provisions under the role key on the next run.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readState, writeState } = require('../src/lib/state.js');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-state-'));
}

test('state: readState returns the file as written — no key migration', () => {
  const root = tmpdir();
  writeState(root, { firebase: { projectId: 'legacy-id' }, cloud: { projectId: 'new-id' } });

  const state = readState(root);
  assert.deepEqual(state.firebase, { projectId: 'legacy-id' }, 'a legacy service-name key survives verbatim (inert)');
  assert.deepEqual(state.cloud, { projectId: 'new-id' }, 'the role key is read as-is');
  assert.ok(!('monitoring' in state) && !('campaigns' in state) && !('newsletter' in state),
    'nothing mints role keys from legacy ones');
});

test('state: missing file reads as {}', () => {
  assert.deepEqual(readState(tmpdir()), {});
});
