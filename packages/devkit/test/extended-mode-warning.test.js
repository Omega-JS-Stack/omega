// Unit tests for src/test/extended-mode-warning.js — the SSOT headline every
// framework prints when TEST_EXTENDED_MODE is on.
//
// The whole point of the shared module is that the WARNING reads identically
// on every surface while each framework supplies its own blast-radius lines,
// so the headline text and the headline-first order are the contract.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeExtendedModeWarning } = require('../src/test/extended-mode-warning');

const HEADLINE = '⚠️⚠️⚠️  WARNING: TEST_EXTENDED_MODE IS TRUE  ⚠️⚠️⚠️';

test('the shared headline leads, framework detail lines follow in order', () => {
  const lines = makeExtendedModeWarning([
    'Real emails will be sent through SendGrid.',
    'Real AI provider calls will be billed.',
  ]);

  assert.deepStrictEqual(lines, [
    HEADLINE,
    'Real emails will be sent through SendGrid.',
    'Real AI provider calls will be billed.',
  ]);
});

test('the headline stands alone when a framework supplies no detail', () => {
  assert.deepStrictEqual(makeExtendedModeWarning([]), [HEADLINE]);
});

test('every framework gets the SAME headline, whatever it passes', () => {
  const web = makeExtendedModeWarning(['web detail']);
  const backend = makeExtendedModeWarning(['backend detail one', 'backend detail two']);

  assert.strictEqual(web[0], backend[0]);
});

test('the caller array is never mutated — a fresh array comes back', () => {
  const detail = ['only line'];
  const lines = makeExtendedModeWarning(detail);

  assert.deepStrictEqual(detail, ['only line']);
  assert.notStrictEqual(lines, detail);
});
