/**
 * events: the one envelope an in-app case event travels in (one stdout or
 * console line), `reportEvery`, which settles a whole row with one outcome
 * when its driver cannot run it, and the tracker every app driver reads its
 * events through.
 */
const defineCases = require('../../src/test/define-cases.js');
const { normalizeSpec } = require('../../src/test/run-case.js');
const { eventLine, parseEventLine, reportEvery, createEventTracker } = require('../../src/test/events.js');

const FILE = '/fixtures/events-subject.test.js';
const EVENT = { id: `${FILE}#0`, name: 'first case', status: 'pass', durationMs: 3 };
const MALFORMED = '__OMEGA_TEST__{"id":"a#0", "status"';

// Two normalized cases, so the reported events must drop every key but the event's own.
const CASES = normalizeSpec({
  type: 'group',
  tests: [
    { name: 'first case', timeout: 2000, run: (ctx) => ctx.expect(1).toBe(1) },
    { name: 'second case', run: (ctx) => ctx.expect(2).toBe(2) },
  ],
}, { file: FILE }).cases;

async function reported(outcome) {
  const events = [];
  await reportEvery(CASES, (event) => events.push(event), outcome);
  return events;
}

// A tracker over CASES that has read the first case's event.
function trackFirst() {
  const events = [];
  const tracker = createEventTracker((event) => events.push(event));
  tracker.onEvent(parseEventLine(eventLine(EVENT)));
  return { events, tracker };
}

module.exports = defineCases({
  type: 'group',
  description: 'events: the one envelope and a whole-row report',
  tests: [
    {
      name: 'case-179 eventLine is the prefix plus the JSON, and parseEventLine reads it back',
      run: (ctx) => {
        const line = '__OMEGA_TEST__{"id":"/fixtures/events-subject.test.js#0","name":"first case","status":"pass","durationMs":3}';
        ctx.expect(eventLine(EVENT)).toBe(line);
        ctx.expect(parseEventLine(line)).toEqual(EVENT);
      },
    },
    {
      name: 'case-179 parseEventLine is null for a line without the prefix',
      run: (ctx) => {
        ctx.expect(parseEventLine('')).toBeNull();
        ctx.expect(parseEventLine('[main] window ready')).toBeNull();
        ctx.expect(parseEventLine('{"id":"a#0","status":"pass"}')).toBeNull();
      },
    },
    {
      name: 'case-179 a prefixed line whose rest is not JSON parses to a failed event with no id',
      run: (ctx) => {
        const parsed = parseEventLine(MALFORMED);
        ctx.expect(parsed.id).toBeNull();
        ctx.expect(parsed.status).toBe('fail');
        ctx.expect(parsed.error.message).toBeTypeOf('string');
      },
    },
    {
      name: 'case-180 a skip outcome reports every case skipped with the reason, in order',
      run: async (ctx) => {
        ctx.expect(await reported({ status: 'skip', reason: 'no Electron' })).toEqual([
          { id: `${FILE}#0`, name: 'first case', status: 'skip', durationMs: 0, reason: 'no Electron' },
          { id: `${FILE}#1`, name: 'second case', status: 'skip', durationMs: 0, reason: 'no Electron' },
        ]);
      },
    },
    {
      name: 'case-180 a fail outcome reports every case failed with the error as plain data, in order',
      run: async (ctx) => {
        const error = new Error('boom');
        const plain = { name: 'Error', message: 'boom', stack: error.stack };
        ctx.expect(await reported({ status: 'fail', error })).toEqual([
          { id: `${FILE}#0`, name: 'first case', status: 'fail', durationMs: 0, error: plain },
          { id: `${FILE}#1`, name: 'second case', status: 'fail', durationMs: 0, error: plain },
        ]);
      },
    },
    {
      name: 'a malformed line read by parseEventLine fails every case through reportEvery with its parse message and stack',
      run: async (ctx) => {
        const parsed = parseEventLine(MALFORMED);
        const events = await reported({ status: 'fail', error: parsed.error });

        ctx.expect(events.map((event) => event.id)).toEqual([`${FILE}#0`, `${FILE}#1`]);
        for (const event of events) {
          ctx.expect(event.error.message).toContain('a malformed test event line');
          ctx.expect(event.error).toEqual(parsed.error);
        }
      },
    },
    {
      name: 'the tracker reports each event by id and counts it, and keeps a malformed line out of the report',
      run: (ctx) => {
        const { events, tracker } = trackFirst();
        tracker.onEvent(parseEventLine(MALFORMED));

        ctx.expect(events).toEqual([EVENT]);
        ctx.expect([...tracker.reported]).toEqual([`${FILE}#0`]);
      },
    },
    {
      name: 'the tracker settles the unreported cases with the kept malformed error, the reported ones untouched',
      run: (ctx) => {
        const { events, tracker } = trackFirst();
        const malformed = parseEventLine(MALFORMED);
        tracker.onEvent(malformed);
        tracker.onEvent(parseEventLine('__OMEGA_TEST__not json either'));
        tracker.settle(CASES);

        ctx.expect(events).toEqual([
          EVENT,
          { id: `${FILE}#1`, name: 'second case', status: 'fail', durationMs: 0, error: malformed.error },
        ]);
      },
    },
    {
      name: 'the tracker settles the unreported cases with a driver error first, and leaves them unreported with neither',
      run: (ctx) => {
        const quiet = trackFirst();
        quiet.tracker.settle(CASES);
        ctx.expect(quiet.events).toEqual([EVENT]);

        const { events, tracker } = trackFirst();
        tracker.onEvent(parseEventLine(MALFORMED));
        const error = new Error('the page crashed');
        tracker.settle(CASES, error);
        ctx.expect(events).toEqual([
          EVENT,
          { id: `${FILE}#1`, name: 'second case', status: 'fail', durationMs: 0, error: { name: 'Error', message: 'the page crashed', stack: error.stack } },
        ]);
      },
    },
  ],
});
