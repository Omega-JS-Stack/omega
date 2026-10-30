/**
 * The ONE home of the return-path rule: whether a value is a path on this
 * site. @omega.js/backend refuses a connect's `returnUrl` with it, and
 * @omega.js/web's connections callback runs it again before navigating, since
 * that is the code that hands a value off the wire to `location`.
 */

/**
 * Whether a value is a path on this site. Every shape that could name another
 * origin is out: an absolute URL, a protocol-relative `//host`, a backslash
 * (browsers read `/\host` as `//host`), a `javascript:` scheme, and any
 * whitespace a parser might strip on the way to one of those. A query and a
 * hash are fine.
 *
 * @param {*} value - The candidate
 * @returns {boolean} True when it is a path on this site
 */
export function isSitePath(value) {
  return typeof value === 'string'
    && value.startsWith('/')
    && !value.startsWith('//')
    && !value.includes('\\')
    && !/\s/.test(value);
}
