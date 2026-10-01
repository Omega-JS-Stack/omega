/**
 * expect(actual, message?): the one assertion library every OMEGA test layer uses.
 * A failed check throws an Error named `AssertionError`; the runner catches it.
 *
 * This file has NO `require` call: desktop and extension inline its source text into
 * an Electron window and a Chrome service worker, where it must stand alone.
 */

// The closure keeps every helper private, so an inliner's scope gains only `expect`.
const expect = (function () {
  // A global or sticky regex keeps lastIndex between calls; a fresh copy never does.
  function matches(regex, text) {
    return new RegExp(regex.source, regex.flags).test(text);
  }
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const tagOf = (v) => Object.prototype.toString.call(v);

  function bytesOf(v) {
    return v instanceof ArrayBuffer
      ? new Uint8Array(v)
      : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }

  function equalBytes(a, b) {
    const x = bytesOf(a);
    const y = bytesOf(b);
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i += 1) {
      if (x[i] !== y[i]) return false;
    }
    return true;
  }

  function ownKeys(obj) {
    const symbols = Object.getOwnPropertySymbols(obj)
      .filter((s) => Object.prototype.propertyIsEnumerable.call(obj, s));
    return [...Object.keys(obj), ...symbols];
  }

  function equalKeys(a, b, path) {
    const ka = ownKeys(a);
    const kb = ownKeys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => hasOwn(b, k) && equals(a[k], b[k], path));
  }

  function equalArrays(a, b, path) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      const inA = i in a;
      if (inA !== (i in b)) return false;
      if (inA && !equals(a[i], b[i], path)) return false;
    }
    return true;
  }

  // Pair the members `rest` (one side's leftovers) one to one with `pool` (the
  // other's): each pairing claims a distinct member. Equality is an equivalence,
  // so a greedy first match never blocks a pairing that exists.
  function pairDistinct(rest, pool, match) {
    if (rest.length !== pool.length) return false;
    const claimed = new Set();
    return rest.every((item) => {
      const index = pool.findIndex((other, i) => !claimed.has(i) && match(item, other));
      if (index === -1) return false;
      claimed.add(index);
      return true;
    });
  }

  function equalMaps(a, b, path) {
    if (a.size !== b.size) return false;
    const rest = [];
    for (const [key, value] of a) {
      if (!b.has(key)) rest.push([key, value]);
      else if (!equals(value, b.get(key), path)) return false;
    }
    const pool = [...b].filter(([key]) => !a.has(key));
    return pairDistinct(rest, pool, (x, y) => equals(x[0], y[0], path) && equals(x[1], y[1], path));
  }

  function equalSets(a, b, path) {
    if (a.size !== b.size) return false;
    const rest = [...a].filter((item) => !b.has(item));
    const pool = [...b].filter((item) => !a.has(item));
    return pairDistinct(rest, pool, (x, y) => equals(x, y, path));
  }

  const isBoxed = (v) => v instanceof Number || v instanceof String || v instanceof Boolean
    || v instanceof BigInt || v instanceof Symbol;

  // Strict deep equality. `path` holds only the pairs on the current recursion
  // path: a pair met again there is a cycle and compares as equal, and every pair
  // leaves on return, so a failed trial comparison leaves no trace.
  function equals(a, b, path = []) {
    if (Object.is(a, b)) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    if (tagOf(a) !== tagOf(b)) return false;
    if (path.some(([x, y]) => x === a && y === b)) return true;

    path.push([a, b]);
    try {
      return equalObjects(a, b, path);
    } finally {
      path.pop();
    }
  }

  function equalObjects(a, b, path) {
    if (a instanceof Date) return Object.is(a.getTime(), b.getTime());
    if (a instanceof RegExp) return a.source === b.source && a.flags === b.flags;
    if (a instanceof ArrayBuffer || ArrayBuffer.isView(a)) return equalBytes(a, b);
    if (a instanceof Map) return equalMaps(a, b, path);
    if (a instanceof Set) return equalSets(a, b, path);
    if (isBoxed(a) && !Object.is(a.valueOf(), b.valueOf())) return false;
    if (a instanceof Error && (a.name !== b.name || a.message !== b.message)) return false;
    if (Array.isArray(a)) return equalArrays(a, b, path);
    return equalKeys(a, b, path);
  }

  function fmt(v) {
    if (typeof v === 'string') return JSON.stringify(v);
    if (v === undefined) return 'undefined';
    if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
    if (typeof v === 'bigint') return `${v}n`;
    if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`;
    if (typeof v === 'symbol') return String(v);
    try {
      return JSON.stringify(v);
    } catch (e) {
      return String(v);
    }
  }

  function assertionError(text, message) {
    const err = new Error(message ? `${message}: ${text}` : text);
    err.name = 'AssertionError';
    return err;
  }

  function isThenable(v) {
    return v !== null && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';
  }

  function thrownMessage(thrown) {
    return thrown !== null && typeof thrown === 'object' && 'message' in thrown
      ? String(thrown.message)
      : String(thrown);
  }

  // Each key of an object matcher is checked on the thrown value: a RegExp is
  // tested, anything else compares by strict deep equality.
  function matchesObject(thrown, matcher) {
    if (thrown === null || typeof thrown !== 'object') return false;
    return Object.keys(matcher).every((key) => (matcher[key] instanceof RegExp
      ? matches(matcher[key], String(thrown[key]))
      : equals(thrown[key], matcher[key])));
  }

  // A matcher of an unlisted type is a usage mistake, never a pass.
  function assertThrowMatcher(matcher) {
    if (matcher === undefined || typeof matcher === 'string' || typeof matcher === 'function') return;
    if (matcher !== null && typeof matcher === 'object') return;
    throw new TypeError(`toThrow: the matcher must be a string, a RegExp, an Error class, a validator function or an object (got ${fmt(matcher)})`);
  }

  // The verdict on one thrown (or not thrown) value: `[passed, text]`.
  function judgeThrow(threw, thrown, matcher, not) {
    if (!threw) return [false, `expected function ${not}to throw`];
    const got = thrownMessage(thrown);
    if (matcher instanceof RegExp) {
      return [matches(matcher, got), `expected thrown message ${not}to match ${matcher} (got: ${got})`];
    }
    if (typeof matcher === 'string') {
      return [got.includes(matcher), `expected thrown message ${not}to contain "${matcher}" (got: ${got})`];
    }
    if (matcher === Error || (typeof matcher === 'function' && matcher.prototype instanceof Error)) {
      return [thrown instanceof matcher, `expected thrown error ${not}to be instance of ${matcher.name} (got: ${got})`];
    }
    // Any other function is a validator: only a `true` return passes, and its own throw propagates.
    if (typeof matcher === 'function') {
      return [matcher(thrown) === true, `expected thrown error ${not}to satisfy ${matcher.name || 'the validator'} (got: ${got})`];
    }
    if (matcher !== null && typeof matcher === 'object') {
      return [matchesObject(thrown, matcher), `expected thrown error ${not}to match ${fmt(matcher)} (got: ${got})`];
    }
    return [true, `expected function ${not}to throw (got: ${got})`];
  }

  function walkPath(actual, path) {
    const keys = Array.isArray(path) ? path : String(path).split('.');
    let current = actual;
    for (const key of keys) {
      if (current === null || current === undefined || !(key in Object(current))) {
        return { found: false };
      }
      current = current[key];
    }
    return { found: true, value: current };
  }

  function buildMatchers(actual, negated, message) {
    const not = negated ? 'not ' : '';

    function check(cond, text) {
      if (negated ? cond : !cond) throw assertionError(text, message);
    }

    return {
      toBe(expected) {
        check(Object.is(actual, expected), `expected ${fmt(actual)} ${not}to be ${fmt(expected)}`);
      },
      toEqual(expected) {
        check(equals(actual, expected), `expected ${fmt(actual)} ${not}to deeply equal ${fmt(expected)}`);
      },
      toBeTruthy() {
        check(!!actual, `expected ${fmt(actual)} ${not}to be truthy`);
      },
      toBeFalsy() {
        check(!actual, `expected ${fmt(actual)} ${not}to be falsy`);
      },
      toBeDefined() {
        check(actual !== undefined, `expected ${fmt(actual)} ${not}to be defined`);
      },
      toBeUndefined() {
        check(actual === undefined, `expected ${fmt(actual)} ${not}to be undefined`);
      },
      toBeNull() {
        check(actual === null, `expected ${fmt(actual)} ${not}to be null`);
      },
      toContain(item) {
        const has = Array.isArray(actual)
          ? actual.includes(item)
          : (typeof actual === 'string' && actual.includes(item));
        check(has, `expected ${fmt(actual)} ${not}to contain ${fmt(item)}`);
      },
      toHaveProperty(path, ...value) {
        const hit = walkPath(actual, path);
        const shown = Array.isArray(path) ? fmt(path) : `"${path}"`;
        if (value.length === 0) {
          check(hit.found, `expected ${fmt(actual)} ${not}to have property ${shown}`);
          return;
        }
        check(
          hit.found && Object.is(hit.value, value[0]),
          `expected ${fmt(actual)} ${not}to have property ${shown} of ${fmt(value[0])}${hit.found ? ` (got: ${fmt(hit.value)})` : ''}`,
        );
      },
      toMatch(regex) {
        const hit = regex instanceof RegExp ? matches(regex, actual) : String(actual).includes(regex);
        check(hit, `expected ${fmt(actual)} ${not}to match ${regex instanceof RegExp ? regex : fmt(regex)}`);
      },
      toBeInstanceOf(cls) {
        check(actual instanceof cls, `expected value ${not}to be instance of ${cls.name}`);
      },
      toBeGreaterThan(n) {
        check(actual > n, `expected ${fmt(actual)} ${not}to be > ${n}`);
      },
      toBeGreaterThanOrEqual(n) {
        check(actual >= n, `expected ${fmt(actual)} ${not}to be >= ${n}`);
      },
      toBeLessThan(n) {
        check(actual < n, `expected ${fmt(actual)} ${not}to be < ${n}`);
      },
      toBeLessThanOrEqual(n) {
        check(actual <= n, `expected ${fmt(actual)} ${not}to be <= ${n}`);
      },
      toBeTypeOf(type) {
        const is = type === 'array' ? Array.isArray(actual) : typeof actual === type;
        check(is, `expected ${fmt(actual)} ${not}to be of type ${type}`);
      },
      toBeSuccess() {
        check(actual != null && !!actual.success, `expected response ${not}to be a success (got: ${fmt(actual)})`);
      },
      toBeError(status) {
        const failed = actual != null && !actual.success;
        const statusOk = status === undefined || (failed && actual.status === status);
        const wanted = status === undefined ? '' : ` with status ${status}`;
        check(failed && statusOk, `expected response ${not}to be an error${wanted} (got: ${fmt(actual)})`);
      },
      toThrow(matcher) {
        assertThrowMatcher(matcher);
        if (typeof actual !== 'function') {
          throw assertionError(`expected a function to call, got ${fmt(actual)}`, message);
        }
        let returned;
        try {
          returned = actual();
        } catch (e) {
          return check(...judgeThrow(true, e, matcher, not));
        }
        if (!isThenable(returned)) return check(...judgeThrow(false, undefined, matcher, not));
        return Promise.resolve(returned).then(
          () => check(...judgeThrow(false, undefined, matcher, not)),
          (e) => check(...judgeThrow(true, e, matcher, not)),
        );
      },
    };
  }

  // `.rejects`: every matcher awaits the promise, fails when it fulfils, and
  // otherwise applies to the rejection reason (`toThrow` judges it as a thrown error).
  function buildRejects(actual, negated, message) {
    const names = Object.keys(buildMatchers(undefined, negated, message));
    const matchers = {};
    for (const name of names) {
      matchers[name] = async (...args) => {
        let rejected = false;
        let reason;
        let value;
        try {
          value = await actual;
        } catch (e) {
          rejected = true;
          reason = e;
        }
        // Checked once the promise settles, so its rejection is always handled.
        if (name === 'toThrow') assertThrowMatcher(args[0]);
        if (!rejected) {
          throw assertionError(`expected promise to reject (it fulfilled with ${fmt(value)})`, message);
        }
        if (name === 'toThrow') {
          const [passed, text] = judgeThrow(true, reason, args[0], negated ? 'not ' : '');
          if (negated ? passed : !passed) throw assertionError(text, message);
          return;
        }
        buildMatchers(reason, negated, message)[name](...args);
      };
    }
    return matchers;
  }

  function expect(actual, message) {
    const matchers = buildMatchers(actual, false, message);
    matchers.not = buildMatchers(actual, true, message);
    matchers.rejects = buildRejects(actual, false, message);
    matchers.rejects.not = buildRejects(actual, true, message);
    return matchers;
  }

  expect.fail = (message) => {
    throw assertionError(message);
  };

  return expect;
})();

// An inliner reaches `expect` as a local; only a CommonJS loader has `module`.
if (typeof module !== 'undefined') {
  module.exports = expect;
}
