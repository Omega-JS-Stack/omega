/**
 * The shared wall-clock formatter behind the manage walk's per-service lines
 * and the run summary's total.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { formatDuration } = require('../src/lib/duration.js');

module.exports = defineCases({
  type: 'group',
  description: 'duration',
  tests: [
    {
      name: 'formatDuration: sub-second stays in milliseconds',
      run: (ctx) => {
        ctx.expect(formatDuration(0)).toBe('0ms');
        ctx.expect(formatDuration(340)).toBe('340ms');
        ctx.expect(formatDuration(999.4)).toBe('999ms');
      },
    },

    {
      name: 'formatDuration: seconds, minutes, hours',
      run: (ctx) => {
        ctx.expect(formatDuration(1000)).toBe('1s');
        ctx.expect(formatDuration(14_200)).toBe('14s');
        ctx.expect(formatDuration(94_000)).toBe('1m 34s');
        ctx.expect(formatDuration(3_600_000)).toBe('1h 0m 0s');
        ctx.expect(formatDuration(3_723_000)).toBe('1h 2m 3s');
      },
    },
  ],
});
