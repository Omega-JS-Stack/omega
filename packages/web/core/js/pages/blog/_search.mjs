/**
 * Blog search ranking and index loading — the pure half of the blog page
 * module: index in, ranked matches out. No DOM, no client import, so it is
 * unit-testable on its own (test/blog-search.test.js imports this file
 * directly — the .mjs extension is what lets node import it from the
 * CommonJS test lane).
 */

/**
 * Rank the index against a query: every whitespace-separated token must match
 * somewhere (title, description or taxonomy), and a title hit outranks a body
 * hit. Newest-first survives within a rank because the index is already sorted.
 * @param {object[]} entries - the loaded index
 * @param {string} query - the raw query string
 * @returns {object[]} matching entries, best first
 */
export function search(entries, query) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return [];
  }

  const scored = [];
  entries.forEach((entry, i) => {
    const title = (entry.title || '').toLowerCase();
    const taxonomy = [...(entry.categories || []), ...(entry.tags || [])].join(' ').toLowerCase();
    const rest = `${(entry.desc || '').toLowerCase()} ${taxonomy}`;

    let score = 0;
    const matchesAll = tokens.every((token) => {
      if (title.includes(token)) {
        score += 2;
        return true;
      }
      if (rest.includes(token)) {
        score += 1;
        return true;
      }
      return false;
    });

    if (matchesAll) {
      scored.push({ entry, score, i });
    }
  });

  return scored
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((hit) => hit.entry);
}

/**
 * The lazy index loader: fetch the build-emitted index ONCE and hand the same
 * entries to every later query. A failed load (404, offline, a body that isn't
 * JSON) is NOT cached — search stays broken only for the attempt that failed,
 * and the next keystroke tries again — and it resolves null instead of
 * rejecting, so the page renders its unavailable state rather than throwing.
 * @param {string} url - the index url
 * @param {object} logger - the page's tagged logger
 * @returns {function(): Promise<object[]|null>} load()
 */
export function createIndexLoader(url, logger) {
  let pending = null;

  return function load() {
    if (!pending) {
      pending = fetch(url)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`${url} responded ${response.status}`);
          }
          return response.json();
        })
        .then((entries) => {
          logger.log(`Loaded ${entries.length} posts`);
          return entries;
        })
        .catch((e) => {
          // Drop the failed attempt so a later search re-fetches
          pending = null;
          logger.error(`Could not load ${url}`, e);
          return null;
        });
    }

    return pending;
  };
}

/**
 * Format an index date. The index carries a plain YYYY-MM-DD; formatting in
 * UTC keeps the rendered date the AUTHORED date for every reader, never a
 * timezone-shifted neighbour of it.
 * @param {string} date - YYYY-MM-DD
 * @returns {string} e.g. "Jan 15, 2024"
 */
export function formatDate(date) {
  if (!date) {
    return '';
  }

  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
