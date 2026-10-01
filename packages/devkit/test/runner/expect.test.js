// Contract cases for src/test/expect.js, the one assertion every suite gets as ctx.expect.
//
// A check that must FAIL is caught with a plain try/catch, never with the matcher under
// test, so a broken expect cannot pass its own test: a check that passes when it must
// fail throws a plain Error from failure() below.

const jetpack = require('fs-jetpack');
const path = require('node:path');
const defineCases = require('../../src/test/define-cases.js');
const expect = require('../../src/test/expect.js');

const SOURCE_DIR = path.join(__dirname, '..', '..', 'src', 'test');

// Run a check that must fail synchronously; return what it threw.
function failure(check) {
  try {
    check();
  } catch (error) {
    return error;
  }
  throw new Error('expected the check to fail, and it passed');
}

// Run a check that must fail synchronously with an AssertionError; return the error.
function fails(ctx, check) {
  const error = failure(check);
  ctx.expect(error.name).toBe('AssertionError');
  return error;
}

// Await a check that must reject with an AssertionError; return the reason.
async function rejects(ctx, pending) {
  try {
    await pending;
  } catch (error) {
    ctx.expect(error.name).toBe('AssertionError');
    return error;
  }
  throw new Error('expected the check to reject, and it resolved');
}

// An array of length 2 whose index 0 is a hole and index 1 holds 1.
function withHole() {
  const array = new Array(2);
  array[1] = 1;
  return array;
}

class Point {
  constructor() {
    this.x = 1;
  }
}

function throwing(error) {
  return () => {
    throw error;
  };
}

module.exports = defineCases({
  type: 'group',
  description: 'expect: the one assertion',
  tests: [
    {
      name: 'case-01 toBe passes on equal and throws an AssertionError on unequal',
      run: (ctx) => {
        expect(1).toBe(1);
        fails(ctx, () => expect(1).toBe(2));
      },
    },

    {
      name: 'case-02 toBe compares by Object.is (NaN equals NaN, 0 is not -0)',
      run: (ctx) => {
        expect(NaN).toBe(NaN);
        fails(ctx, () => expect(0).toBe(-0));
      },
    },

    {
      name: 'case-03 a message prefixes the failure text',
      run: (ctx) => {
        const error = fails(ctx, () => expect(1, 'count').toBe(2));
        ctx.expect(error.message.startsWith('count: ')).toBe(true);
      },
    },

    {
      name: 'case-04 toEqual compares Dates by time',
      run: (ctx) => {
        expect(new Date(1000)).toEqual(new Date(1000));
        fails(ctx, () => expect(new Date(1000)).toEqual(new Date(2000)));
      },
    },

    {
      name: 'case-05 toEqual compares Map, Set, RegExp and typed arrays by content',
      run: (ctx) => {
        expect(new Map([['a', 1]])).toEqual(new Map([['a', 1]]));
        expect(new Set([1, 2])).toEqual(new Set([1, 2]));
        expect(/a+/g).toEqual(/a+/g);
        expect(new Uint8Array([1, 2])).toEqual(new Uint8Array([1, 2]));

        fails(ctx, () => expect(new Map([['a', 1]])).toEqual(new Map([['a', 2]])));
        fails(ctx, () => expect(new Set([1, 2])).toEqual(new Set([1, 3])));
        fails(ctx, () => expect(/a+/g).toEqual(/b+/g));
        fails(ctx, () => expect(/a+/g).toEqual(/a+/i));
        fails(ctx, () => expect(new Uint8Array([1, 2])).toEqual(new Uint8Array([1, 3])));
      },
    },

    {
      name: 'case-06 toEqual counts an undefined value as a key',
      run: (ctx) => {
        fails(ctx, () => expect({ a: undefined }).toEqual({}));
        fails(ctx, () => expect({}).toEqual({ a: undefined }));
      },
    },

    {
      name: 'case-07 toEqual compares prototypes (object versus class instance)',
      run: (ctx) => {
        fails(ctx, () => expect({ x: 1 }).toEqual(new Point()));
        fails(ctx, () => expect(new Point()).toEqual({ x: 1 }));
      },
    },

    {
      name: 'case-08 toEqual returns on two equal cyclic structures',
      run: () => {
        const left = { name: 'node' };
        left.self = left;
        const right = { name: 'node' };
        right.self = right;
        expect(left).toEqual(right);
      },
    },

    {
      name: 'case-09 toHaveProperty follows a dot path',
      run: (ctx) => {
        expect({ a: { b: 1 } }).toHaveProperty('a.b');
        fails(ctx, () => expect({ a: { b: 1 } }).toHaveProperty('a.c'));
      },
    },

    {
      name: 'case-10 toHaveProperty compares a value, and an array path names a dotted key',
      run: (ctx) => {
        expect({ a: { b: 1 } }).toHaveProperty('a.b', 1);
        fails(ctx, () => expect({ a: { b: 1 } }).toHaveProperty('a.b', 2));

        expect({ 'a.b': 1 }).toHaveProperty(['a.b']);
        fails(ctx, () => expect({ 'a.b': 1 }).toHaveProperty('a.b'));
      },
    },

    {
      name: 'case-11 OrEqual comparisons pass at the boundary and throw one past it',
      run: (ctx) => {
        expect(5).toBeGreaterThanOrEqual(5);
        expect(5).toBeLessThanOrEqual(5);
        fails(ctx, () => expect(4).toBeGreaterThanOrEqual(5));
        fails(ctx, () => expect(6).toBeLessThanOrEqual(5));
      },
    },

    {
      name: 'case-12 toBeTypeOf checks typeof, plus array',
      run: (ctx) => {
        expect('text').toBeTypeOf('string');
        expect([1]).toBeTypeOf('array');
        fails(ctx, () => expect('text').toBeTypeOf('object'));
      },
    },

    {
      name: 'case-13 sync toThrow needs no await and returns undefined',
      run: (ctx) => {
        const result = expect(throwing(new Error('boom'))).toThrow();
        ctx.expect(result).toBeUndefined();
      },
    },

    {
      name: 'case-14 sync toThrow on a function that does not throw fails synchronously',
      run: (ctx) => {
        fails(ctx, () => expect(() => 1).toThrow());
      },
    },

    {
      name: 'case-15 toThrow on an async function returns a promise to await',
      run: async (ctx) => {
        await expect(async () => {
          throw new Error('boom');
        }).toThrow();
        await rejects(ctx, expect(async () => 1).toThrow());
      },
    },

    {
      name: 'case-16 toThrow with a string matcher checks a substring of the message',
      run: (ctx) => {
        expect(throwing(new Error('a boom here'))).toThrow('boom');
        fails(ctx, () => expect(throwing(new Error('a boom here'))).toThrow('nope'));
      },
    },

    {
      name: 'case-16 toThrow with a RegExp matcher tests the message',
      run: (ctx) => {
        expect(throwing(new Error('a boom here'))).toThrow(/bo+m/);
        fails(ctx, () => expect(throwing(new Error('a boom here'))).toThrow(/zzz/));
      },
    },

    {
      name: 'case-16 toThrow with a class matcher checks instanceof',
      run: (ctx) => {
        expect(throwing(new TypeError('bad type'))).toThrow(TypeError);
        fails(ctx, () => expect(throwing(new TypeError('bad type'))).toThrow(RangeError));
      },
    },

    {
      name: 'case-16 toThrow with a validator passes when it returns true, called with the error',
      run: (ctx) => {
        const thrown = new Error('a boom here');
        let received = null;
        expect(throwing(thrown)).toThrow((error) => {
          received = error;
          return true;
        });
        ctx.expect(received).toBe(thrown);
      },
    },

    {
      name: 'case-16 toThrow with a validator throws an AssertionError when it returns false',
      run: (ctx) => {
        fails(ctx, () => expect(throwing(new Error('a boom here'))).toThrow(() => false));
      },
    },

    {
      name: 'case-16 toThrow with a validator lets the validator throw through unchanged',
      run: (ctx) => {
        const own = new RangeError('validator broke');
        const error = failure(() => expect(throwing(new Error('a boom here'))).toThrow(() => {
          throw own;
        }));
        ctx.expect(error).toBe(own);
      },
    },

    {
      name: 'case-16 toThrow with an object matcher checks each key',
      run: (ctx) => {
        const make = () => Object.assign(new Error('a boom here'), { code: 'E_X', details: { a: 1 } });

        expect(throwing(make())).toThrow({ code: 'E_X', message: /boom/, details: { a: 1 } });
        fails(ctx, () => expect(throwing(make())).toThrow({ code: 'E_Y' }));
        fails(ctx, () => expect(throwing(make())).toThrow({ message: /zzz/ }));
        fails(ctx, () => expect(throwing(make())).toThrow({ details: { a: 2 } }));
      },
    },

    {
      name: 'case-17 rejects.toThrow passes on a rejecting promise and rejects on a fulfilling one',
      run: async (ctx) => {
        await expect(Promise.reject(new Error('x marks'))).rejects.toThrow(/x/);
        await rejects(ctx, expect(Promise.resolve('fine')).rejects.toThrow(/x/));
      },
    },

    {
      name: 'case-18 not inverts toBe, toEqual, toContain and toThrow',
      run: (ctx) => {
        expect(1).not.toBe(2);
        fails(ctx, () => expect(1).not.toBe(1));

        expect({ a: 1 }).not.toEqual({ a: 2 });
        fails(ctx, () => expect({ a: 1 }).not.toEqual({ a: 1 }));

        expect([1, 2]).not.toContain(3);
        fails(ctx, () => expect([1, 2]).not.toContain(2));
        expect('abc').not.toContain('z');
        fails(ctx, () => expect('abc').not.toContain('b'));

        expect(() => 1).not.toThrow();
        fails(ctx, () => expect(throwing(new Error('boom'))).not.toThrow());
      },
    },

    {
      name: 'case-19 expect.fail throws with the given message',
      run: (ctx) => {
        const error = failure(() => expect.fail('why'));
        ctx.expect(error.message).toBe('why');
      },
    },

    {
      name: 'case-20 toBeSuccess passes on success: true, toBeError throws there',
      run: (ctx) => {
        expect({ success: true }).toBeSuccess();
        fails(ctx, () => expect({ success: true }).toBeError());
      },
    },

    {
      name: 'case-21 toBeError checks the status when given one',
      run: (ctx) => {
        expect({ success: false, status: 401 }).toBeError(401);
        fails(ctx, () => expect({ success: false, status: 401 }).toBeError(403));
      },
    },

    {
      name: 'case-22 expect.js and run-case.js contain no require call',
      run: (ctx) => {
        for (const name of ['expect.js', 'run-case.js']) {
          const source = jetpack.read(path.join(SOURCE_DIR, name));
          ctx.expect(typeof source, `${name} exists`).toBe('string');
          ctx.expect(/\brequire\s*\(/.test(source), `${name} has a require call`).toBe(false);
        }
      },
    },

    {
      name: 'case-69 toEqual tells a hole from a value and from undefined',
      run: (ctx) => {
        fails(ctx, () => expect(withHole()).toEqual([2, 1]));
        fails(ctx, () => expect(withHole()).toEqual([undefined, 1]));
        fails(ctx, () => expect([undefined, 1]).toEqual(withHole()));
        expect(withHole()).toEqual(withHole());
      },
    },

    {
      name: 'case-70 toEqual pairs Set members and Map keys one to one',
      run: (ctx) => {
        fails(ctx, () => expect(new Set([{ x: 1 }, { x: 1 }])).toEqual(new Set([{ x: 1 }, { x: 2 }])));
        fails(ctx, () => expect(new Map([[{ x: 1 }, 'v'], [{ x: 1 }, 'v']]))
          .toEqual(new Map([[{ x: 1 }, 'v'], [{ x: 2 }, 'v']])));
        expect(new Set([{ x: 1 }, { x: 2 }])).toEqual(new Set([{ x: 2 }, { x: 1 }]));
      },
    },

    {
      name: 'case-71 toEqual keeps no trace of a failed trial pairing',
      run: (ctx) => {
        const o = { v: 1 };
        const p = { v: 2 };
        const q = { v: 1 };
        const r = { v: 2 };
        fails(ctx, () => expect([new Set([o, r]), o]).toEqual([new Set([p, q]), p]));
      },
    },

    {
      name: 'case-72 toEqual compares boxed primitives by their value',
      run: (ctx) => {
        fails(ctx, () => expect(new Number(1)).toEqual(new Number(2)));
        fails(ctx, () => expect(new Boolean(true)).toEqual(new Boolean(false)));
        expect(new Number(1)).toEqual(new Number(1));
      },
    },

    {
      name: 'case-73 toEqual compares symbol keys',
      run: (ctx) => {
        const key = Symbol('key');
        fails(ctx, () => expect({ [key]: 1 }).toEqual({ [key]: 2 }));
        expect({ [key]: 1 }).toEqual({ [key]: 1 });
      },
    },

    {
      name: 'case-74 toEqual treats a NaN value as equal to NaN',
      run: () => {
        expect({ a: NaN }).toEqual({ a: NaN });
      },
    },

    {
      name: 'case-75 toEqual tells an own key from an inherited one',
      run: (ctx) => {
        const proto = { a: 1 };
        const own = Object.create(proto);
        own.a = 1;
        const inherits = Object.create(proto);
        fails(ctx, () => expect(own).toEqual(inherits));
        fails(ctx, () => expect(inherits).toEqual(own));
      },
    },

    {
      name: 'case-76 toThrow with a number, null or boolean matcher is a usage error, never a pass',
      run: (ctx) => {
        for (const matcher of [404, null, true]) {
          const error = failure(() => expect(throwing(new Error('boom'))).toThrow(matcher));
          ctx.expect(error.message, String(matcher)).toContain('toThrow');
        }
      },
    },

    {
      name: 'case-77 toThrow with a validator that returns a truthy non-true value throws',
      run: (ctx) => {
        fails(ctx, () => expect(throwing(new Error('boom'))).toThrow(() => 1));
      },
    },

    {
      name: 'case-78 toMatch with a RegExp and with a string',
      run: (ctx) => {
        expect('hello world').toMatch(/wor/);
        fails(ctx, () => expect('hello world').toMatch(/xyz/));
        expect('hello world').toMatch('lo w');
        fails(ctx, () => expect('hello world').toMatch('nope'));
      },
    },

    {
      name: 'case-90 a global or sticky regex matches the same way on every call',
      run: (ctx) => {
        const global = /wor/g;
        expect('hello world').toMatch(global);
        expect('hello world').toMatch(global);
        const boom = /boom/g;
        const thrower = () => { throw new Error('boom'); };
        expect(thrower).toThrow(boom);
        expect(thrower).toThrow(boom);
        expect(thrower).toThrow({ message: boom });
        expect(thrower).toThrow({ message: boom });
        const sticky = /wor/y;
        fails(ctx, () => expect('hello world').toMatch(sticky));
        fails(ctx, () => expect('hello world').toMatch(sticky));
      },
    },

    {
      name: 'case-78 toBeInstanceOf',
      run: (ctx) => {
        expect(new Point()).toBeInstanceOf(Point);
        fails(ctx, () => expect({ x: 1 }).toBeInstanceOf(Point));
      },
    },

    {
      name: 'case-78 toBeTruthy and toBeFalsy',
      run: (ctx) => {
        expect(1).toBeTruthy();
        fails(ctx, () => expect(0).toBeTruthy());
        expect('').toBeFalsy();
        fails(ctx, () => expect('x').toBeFalsy());
      },
    },

    {
      name: 'case-78 toBeDefined, toBeUndefined and toBeNull',
      run: (ctx) => {
        expect(0).toBeDefined();
        fails(ctx, () => expect(undefined).toBeDefined());
        expect(undefined).toBeUndefined();
        fails(ctx, () => expect(null).toBeUndefined());
        expect(null).toBeNull();
        fails(ctx, () => expect(undefined).toBeNull());
      },
    },

    {
      name: 'case-78 toContain on an array and on a string',
      run: (ctx) => {
        expect([1, 2]).toContain(2);
        fails(ctx, () => expect([1, 2]).toContain(3));
        expect('abc').toContain('b');
        fails(ctx, () => expect('abc').toContain('z'));
      },
    },

    {
      name: 'case-78 toBeGreaterThan and toBeLessThan throw at the boundary',
      run: (ctx) => {
        expect(6).toBeGreaterThan(5);
        fails(ctx, () => expect(5).toBeGreaterThan(5));
        expect(4).toBeLessThan(5);
        fails(ctx, () => expect(5).toBeLessThan(5));
      },
    },

    {
      name: 'case-78 toHaveProperty on an inherited key',
      run: (ctx) => {
        const inherits = Object.create({ a: 1 });
        expect(inherits).toHaveProperty('a');
        expect(inherits).toHaveProperty('a', 1);
        fails(ctx, () => expect(inherits).toHaveProperty('a', 2));
        fails(ctx, () => expect(inherits).toHaveProperty('b'));
      },
    },

    {
      name: 'case-78 rejects.toBe checks the rejection reason',
      run: async (ctx) => {
        await expect(Promise.reject('reason')).rejects.toBe('reason');
        await rejects(ctx, expect(Promise.reject('reason')).rejects.toBe('other'));
      },
    },
  ],
});
