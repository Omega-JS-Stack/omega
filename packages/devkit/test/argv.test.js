/**
 * parseArgv: the one argv parse behind every framework CLI. Real parsing, no
 * mocks: each case is the exact argv line a bin receives, pinned against the
 * shape the CLIs read (the four yargs conveniences node:util.parseArgs does
 * not ship, [#920](https://github.com/Omega-JS-Stack/omega/issues/920)).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseArgv } = require('../src/argv.js');

test('a kebab flag arrives under BOTH spellings (dozens of reads say options.dryRun)', () => {
  const argv = parseArgv(['--dry-run'], { booleans: ['dry-run'] });
  assert.equal(argv['dry-run'], true);
  assert.equal(argv.dryRun, true);
});

test('a kebab VALUE flag arrives under both spellings too', () => {
  const argv = parseArgv(['--signed-dir', 'release/signed'], {});
  assert.equal(argv['signed-dir'], 'release/signed');
  assert.equal(argv.signedDir, 'release/signed');
});

test('--no-<x> is the flag set false, never a flag of its own', () => {
  // The live negations: --no-secrets, --no-seed, --no-merge, --no-https, each
  // read as `<x> !== false` by its consumer.
  const argv = parseArgv(['--no-secrets'], { booleans: ['secrets'] });
  assert.equal(argv.secrets, false);
  assert.equal('no-secrets' in argv, false, 'the negation spelling never survives as a key');
  assert.equal('noSecrets' in argv, false, 'and it never mints a camelCase twin of itself');
});

test('--no-<x> negates an UNDECLARED flag too, and mints the camel twin', () => {
  const argv = parseArgv(['--no-dry-run'], {});
  assert.equal(argv['dry-run'], false);
  assert.equal(argv.dryRun, false);
  assert.equal('no-dry-run' in argv, false);
});

test('--no-<x> NEVER takes a value, so the token after it is a positional', () => {
  // The live line: the brand root forwards a false boolean as `--no-extended`
  // BEFORE the positionals, so a swallowed token loses the test path itself.
  const declared = parseArgv(['--no-extended', 'build/config'], { booleans: ['extended'] });
  assert.deepEqual(declared._, ['build/config'], 'the path survives the negation');
  assert.equal(declared.extended, false);

  const undeclared = parseArgv(['--no-foo', 'bar'], {});
  assert.deepEqual(undeclared._, ['bar']);
  assert.equal(undeclared.foo, false);
});

test('--target=a,b stays one string (the picker splits it, not the parse)', () => {
  const argv = parseArgv(['--target=a,b'], {});
  assert.equal(argv.target, 'a,b');
});

test('an UNDECLARED flag takes the next token as its value, never a positional', () => {
  const argv = parseArgv(['deploy', '--only', 'hosting'], {});
  assert.equal(argv.only, 'hosting', 'nothing has to be declared for a value to survive');
  assert.deepEqual(argv._, ['deploy']);
});

test('a forwarded flag the receiving CLI never heard of keeps its value', () => {
  // The brand root forwards whatever it does not consume, so the target's own
  // parse is the one that must not drop `--filter foo`.
  const argv = parseArgv(['test', '--filter', 'foo'], {});
  assert.equal(argv.filter, 'foo');
  assert.deepEqual(argv._, ['test']);
});

test('a flag followed by another FLAG is true, and the next flag is its own', () => {
  const argv = parseArgv(['test', '--filter', '--extended'], { booleans: ['extended'] });
  assert.equal(argv.filter, true, 'a dash-led token is never eaten as a value');
  assert.equal(argv.extended, true);
  assert.deepEqual(argv._, ['test']);
});

test('a flag at the END of the line is true', () => {
  assert.equal(parseArgv(['test', '--filter'], {}).filter, true);
});

test('a declared boolean never swallows the next token', () => {
  const argv = parseArgv(['test', '--extended', 'project:foo'], { booleans: ['extended'] });
  assert.equal(argv.extended, true);
  assert.deepEqual(argv._, ['test', 'project:foo'], 'the scope stays a positional');
});

test('--flag=value always wins, even for a declared boolean-looking name', () => {
  assert.equal(parseArgv(['--filter=foo bar'], {}).filter, 'foo bar');
  assert.equal(parseArgv(['--signed-dir=release/signed'], {}).signedDir, 'release/signed');
});

test('a multiple accumulates into an array; ONE occurrence stays a string', () => {
  const many = parseArgv(['--where', 'a', '--where', 'b'], { multiples: ['where'] });
  assert.deepEqual(many.where, ['a', 'b']);

  const one = parseArgv(['--where', 'a'], { multiples: ['where'] });
  assert.equal(one.where, 'a', 'a single clause reads as a string, exactly as the firestore command expects');
});

test('short flags stay short (-v and -h are the router\'s own surface)', () => {
  assert.equal(parseArgv(['-v'], {}).v, true);
  assert.equal(parseArgv(['-h'], {}).h, true);
});

test('positionals land at _, in order, after a -- terminator too', () => {
  assert.deepEqual(parseArgv(['test', 'mgr:build/foo'], {})._, ['test', 'mgr:build/foo']);
  assert.deepEqual(parseArgv(['--', '--raw', 'x'], {})._, ['--raw', 'x']);
});

test('a numeric value stays a STRING (the builtin never coerces; every consumer Number()s it)', () => {
  const argv = parseArgv(['--min-age', '0'], {});
  assert.equal(argv['min-age'], '0');
  assert.equal(argv.minAge, '0');
});

test('the value rule is per OCCURRENCE, so one line carries both shapes', () => {
  const argv = parseArgv(
    ['sign-windows', '--in', 'release', '--out', 'release/signed', '--verify-only', '--smoke'],
    { booleans: ['smoke'] },
  );
  assert.equal(argv.in, 'release');
  assert.equal(argv.out, 'release/signed');
  assert.equal(argv.verifyOnly, true, 'a flag followed by another flag is true');
  assert.equal(argv.smoke, true);
  assert.deepEqual(argv._, ['sign-windows']);
});
