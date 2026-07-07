/**
 * prng.js — seeded deterministic PRNG (mulberry32) + sampling helpers.
 *
 * The corpus generator must be byte-reproducible: same seed → identical tree.
 * Never use Math.random() or Date.now() in corpus generation.
 */

/**
 * Create a seeded mulberry32 generator.
 * @param {number} seed - 32-bit integer seed
 * @returns {object} rng with float/int/pick/picks/chance methods
 */
function createRng(seed) {
  let state = seed >>> 0;

  const float = () => {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Integer in [min, max] inclusive
  const int = (min, max) => min + Math.floor(float() * (max - min + 1));

  // One element from an array
  const pick = (arr) => arr[int(0, arr.length - 1)];

  // N distinct elements from an array (n clamped to arr.length)
  const picks = (arr, n) => {
    const pool = [...arr];
    const out = [];
    while (out.length < Math.min(n, arr.length)) {
      out.push(pool.splice(int(0, pool.length - 1), 1)[0]);
    }
    return out;
  };

  // True with probability p
  const chance = (p) => float() < p;

  return { float, int, pick, picks, chance };
}

module.exports = { createRng };
