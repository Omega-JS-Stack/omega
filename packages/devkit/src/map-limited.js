/**
 * The one bounded pool: run an async worker over a list with at most `size`
 * items in flight, taking them in order, and hand back the results in the
 * items' order, never completion order.
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

  const drain = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(size, items.length) }, drain));

  return results;
}

module.exports = { mapLimited };
