/**
 * The one bounded pool: run an async worker over a list with at most `size`
 * items in flight, taking them in order, and hand back the results in the
 * items' order, never completion order. A rejection stops the pool from
 * starting later items.
 */

/**
 * Run `worker` over every item with at most `size` in flight.
 * @param {Array} items - The work items, taken in order.
 * @param {number} size - The most in flight at once.
 * @param {Function} worker - `(item) => Promise`.
 * @returns {Promise<Array>} The results, positionally aligned with `items`.
 */
async function mapLimited(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  let failed = false;

  const drain = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await worker(items[index]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(size, items.length) }, drain));

  return results;
}

module.exports = { mapLimited };
