const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const events = [];

before(() => {
  events.push('before');
});

after(() => {
  events.push('after');
  fs.writeFileSync(process.env.CONVERT_EVENTS_FILE, JSON.stringify(events));
});

beforeEach(() => {
  events.push('beforeEach');
});

afterEach(() => {
  events.push('afterEach');
});

test('a', () => {
  events.push('a');
  assert.ok(true);
});

test('b', () => {
  events.push('b');
});
