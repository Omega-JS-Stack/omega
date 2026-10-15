/**
 * mapLimited: the one bounded pool. Never more than `size` workers in flight,
 * results in the items' order whatever order they finish in, every item at
 * once when the size passes the length, and a worker's rejection is the call's,
 * after which no new item starts.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { mapLimited } = require('@omega.js/devkit/map-limited');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A worker that counts how many of its calls are in flight, keeping the peak. */
function trackedWorker(ms) {
  const stats = { inFlight: 0, peak: 0 };
  const worker = async (item) => {
    stats.inFlight++;
    stats.peak = Math.max(stats.peak, stats.inFlight);
    await wait(ms);
    stats.inFlight--;
    return item;
  };
  return { stats, worker };
}

module.exports = defineCases({
  type: 'group',
  description: 'map-limited',
  tests: [
    {
      name: '20 items at size 4: never more than 4 in flight, and the pool fills to 4',
      run: async (ctx) => {
        const items = Array.from({ length: 20 }, (_, i) => i);
        const { stats, worker } = trackedWorker(5);

        await mapLimited(items, 4, worker);

        ctx.expect(stats.peak, 'the in-flight peak').toBe(4);
        ctx.expect(stats.inFlight, 'nothing left in flight once the call resolves').toBe(0);
      },
    },

    {
      name: 'later items finish first: the results still sit in the items\' order',
      run: async (ctx) => {
        const items = [1, 2, 3, 4, 5];
        const finished = [];

        const results = await mapLimited(items, 5, async (item) => {
          await wait((6 - item) * 5);
          finished.push(item);
          return `r${item}`;
        });

        ctx.expect(finished, 'the later items did finish first').toEqual([5, 4, 3, 2, 1]);
        ctx.expect(results, 'results by item position, not completion').toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
      },
    },

    {
      name: 'a size past the length runs every item at once',
      run: async (ctx) => {
        const items = ['a', 'b', 'c', 'd', 'e', 'f'];
        const { stats, worker } = trackedWorker(5);

        const results = await mapLimited(items, 50, worker);

        ctx.expect(stats.peak, 'the in-flight peak is the whole list').toBe(6);
        ctx.expect(results).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
      },
    },

    {
      name: 'a rejecting worker rejects the whole call with that error',
      run: async (ctx) => {
        const items = [1, 2, 3, 4, 5, 6];

        const pending = mapLimited(items, 2, async (item) => {
          await wait(2);
          if (item === 3) throw new Error('worker failed on 3');
          return item;
        });

        await ctx.expect(pending).rejects.toThrow('worker failed on 3');
      },
    },

    {
      name: 'a-rejection-stops-later-items-from-starting',
      run: async (ctx) => {
        const items = Array.from({ length: 20 }, (_, i) => i);
        const started = new Set();

        const pending = mapLimited(items, 2, async (item) => {
          started.add(item);
          if (item === 1) {
            await wait(5);
            throw new Error('worker failed on 1');
          }
          await wait(20);
          return item;
        });

        await ctx.expect(pending).rejects.toThrow('worker failed on 1');
        await wait(60);

        ctx.expect([...started].sort((a, b) => a - b), 'only the two items in flight at the rejection ever started').toEqual([0, 1]);
      },
    },
  ],
});
