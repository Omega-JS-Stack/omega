// Unit tests for src/merge-line-files.js — the OMEGA marker-section merge protocol.
// Mirrors the coverage of EM's build-layer suite (which now tests through its shim).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeLineBasedFiles, normalizeEnvLine, hasSectionMarkers, DEFAULT_MARKER, CUSTOM_MARKER } = require('../src/merge-line-files');

test('preserves user value in default section across merges (and quotes it)', () => {
  const existing = `${DEFAULT_MARKER}\nGH_TOKEN=ghp_secret123\nBACKEND_MANAGER_KEY=\n\n${CUSTOM_MARKER}\n`;
  const incoming = `${DEFAULT_MARKER}\nGH_TOKEN=""\nBACKEND_MANAGER_KEY=""\n\n${CUSTOM_MARKER}\n`;
  const merged = mergeLineBasedFiles(existing, incoming, '.env');
  assert.match(merged, /GH_TOKEN="ghp_secret123"/);
});

test('adds new framework default keys the user does not have', () => {
  const existing = `${DEFAULT_MARKER}\nOLD_KEY="kept"\n${CUSTOM_MARKER}\n`;
  const incoming = `${DEFAULT_MARKER}\nOLD_KEY=""\nNEW_KEY=""\n${CUSTOM_MARKER}\n`;
  const merged = mergeLineBasedFiles(existing, incoming, '.env');
  assert.match(merged, /OLD_KEY="kept"/);
  assert.match(merged, /NEW_KEY=""/);
});

test('migrates user-added default-section keys to the custom section', () => {
  const existing = `${DEFAULT_MARKER}\nFRAMEWORK_KEY=""\nUSER_KEY="mine"\n${CUSTOM_MARKER}\n`;
  const incoming = `${DEFAULT_MARKER}\nFRAMEWORK_KEY=""\n${CUSTOM_MARKER}\n`;
  const merged = mergeLineBasedFiles(existing, incoming, '.env');
  const customPart = merged.slice(merged.indexOf(CUSTOM_MARKER));
  assert.match(customPart, /USER_KEY="mine"/);
});

test('custom section is preserved verbatim (env values normalized to quotes)', () => {
  const existing = `${DEFAULT_MARKER}\nA=""\n${CUSTOM_MARKER}\n# my note\nMY_SECRET=raw value\n`;
  const incoming = `${DEFAULT_MARKER}\nA=""\n${CUSTOM_MARKER}\n`;
  const merged = mergeLineBasedFiles(existing, incoming, '.env');
  assert.match(merged, /# my note/);
  assert.match(merged, /MY_SECRET="raw value"/);
});

test('custom key newly adopted by the framework is promoted UP into default (@omegajs/backend behavior)', () => {
  const existing = `${DEFAULT_MARKER}\n${CUSTOM_MARKER}\nGH_TOKEN="moved"\n`;
  const incoming = `${DEFAULT_MARKER}\nGH_TOKEN=""\n${CUSTOM_MARKER}\n`;
  const merged = mergeLineBasedFiles(existing, incoming, '.env');
  const defaultPart = merged.slice(0, merged.indexOf(CUSTOM_MARKER));
  const customPart = merged.slice(merged.indexOf(CUSTOM_MARKER));
  assert.match(defaultPart, /GH_TOKEN="moved"/);
  assert.doesNotMatch(customPart, /GH_TOKEN/);
  // Promotion is idempotent: the next merge preserves the value from Default.
  const again = mergeLineBasedFiles(merged, incoming, '.env');
  assert.equal(again, merged);
});

test('key present in BOTH sections: default value wins, custom copy is kept (no silent value flip)', () => {
  // dotenv resolves the LAST occurrence, so the effective value was the custom
  // "b". Dropping the custom copy would flip the effective value to "a" — keep it.
  const existing = `${DEFAULT_MARKER}\nGH_TOKEN="a"\n${CUSTOM_MARKER}\nGH_TOKEN="b"\n`;
  const incoming = `${DEFAULT_MARKER}\nGH_TOKEN=""\n${CUSTOM_MARKER}\n`;
  const merged = mergeLineBasedFiles(existing, incoming, '.env');
  const defaultPart = merged.slice(0, merged.indexOf(CUSTOM_MARKER));
  const customPart = merged.slice(merged.indexOf(CUSTOM_MARKER));
  assert.match(defaultPart, /GH_TOKEN="a"/);
  assert.match(customPart, /GH_TOKEN="b"/);
});

test('hasSectionMarkers: true only when both markers present', () => {
  assert.equal(hasSectionMarkers(`${DEFAULT_MARKER}\n${CUSTOM_MARKER}\n`), true);
  assert.equal(hasSectionMarkers(`${DEFAULT_MARKER}\n`), false);
  assert.equal(hasSectionMarkers('KEY=value\n'), false);
  assert.equal(hasSectionMarkers(''), false);
});

test('.gitignore merges line-based: new defaults win, user lines migrate to custom', () => {
  const existing = `${DEFAULT_MARKER}\nnode_modules/\nmy-custom-dir/\n${CUSTOM_MARKER}\n*.log\n`;
  const incoming = `${DEFAULT_MARKER}\nnode_modules/\ndist/\n${CUSTOM_MARKER}\n`;
  const merged = mergeLineBasedFiles(existing, incoming, '.gitignore');
  const customPart = merged.slice(merged.indexOf(CUSTOM_MARKER));
  assert.match(merged, /dist\//);
  assert.match(customPart, /my-custom-dir\//);
  assert.match(customPart, /\*\.log/);
});

test('merge is idempotent: second pass returns identical content', () => {
  const existing = `${DEFAULT_MARKER}\nKEY=value with spaces\n${CUSTOM_MARKER}\nUSER=x\n`;
  const incoming = `${DEFAULT_MARKER}\nKEY=""\n${CUSTOM_MARKER}\n`;
  const once = mergeLineBasedFiles(existing, incoming, '.env');
  const twice = mergeLineBasedFiles(once, incoming, '.env');
  assert.equal(twice, once);
});

test('pre-marker lines in a legacy file are treated as default section', () => {
  const existing = `LEGACY_KEY="old"\n`;
  const incoming = `${DEFAULT_MARKER}\nLEGACY_KEY=""\nNEW=""\n${CUSTOM_MARKER}\n`;
  const merged = mergeLineBasedFiles(existing, incoming, '.env');
  assert.match(merged, /LEGACY_KEY="old"/);
});

test('normalizeEnvLine: raw wraps, single-quote canonicalizes, double-quote and empty untouched', () => {
  assert.equal(normalizeEnvLine('KEY=raw'), 'KEY="raw"');
  assert.equal(normalizeEnvLine("KEY='single'"), 'KEY="single"');
  assert.equal(normalizeEnvLine('KEY="done"'), 'KEY="done"');
  assert.equal(normalizeEnvLine('KEY='), 'KEY=');
  assert.equal(normalizeEnvLine('# comment'), '# comment');
  assert.equal(normalizeEnvLine('KEY=has "quote"'), 'KEY="has \\"quote\\""');
});
