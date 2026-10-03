/**
 * parseArgv: the one argv parse behind every framework CLI. Real parsing, no
 * mocks: each case is the exact argv line a bin receives, pinned against the
 * shape the CLIs read (the four yargs conveniences node:util.parseArgs does
 * not ship, [#920](https://github.com/Omega-JS-Stack/omega/issues/920)).
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { parseArgv } = require('../src/argv.js');

module.exports = defineCases({
  type: 'group',
  description: 'argv',
  tests: [
    {
      name: 'a kebab flag arrives under BOTH spellings (dozens of reads say options.dryRun)',
      run: (ctx) => {
        const argv = parseArgv(['--dry-run'], { booleans: ['dry-run'] });
        ctx.expect(argv['dry-run']).toBe(true);
        ctx.expect(argv.dryRun).toBe(true);
      },
    },

    {
      name: 'a kebab VALUE flag arrives under both spellings too',
      run: (ctx) => {
        const argv = parseArgv(['--signed-dir', 'release/signed'], {});
        ctx.expect(argv['signed-dir']).toBe('release/signed');
        ctx.expect(argv.signedDir).toBe('release/signed');
      },
    },

    {
      name: '--no-<x> is the flag set false, never a flag of its own',
      run: (ctx) => {
        // The live negations: --no-secrets, --no-seed, --no-merge, --no-https, each
        // read as `<x> !== false` by its consumer.
        const argv = parseArgv(['--no-secrets'], { booleans: ['secrets'] });
        ctx.expect(argv.secrets).toBe(false);
        ctx.expect('no-secrets' in argv, 'the negation spelling never survives as a key').toBe(false);
        ctx.expect('noSecrets' in argv, 'and it never mints a camelCase twin of itself').toBe(false);
      },
    },

    {
      name: '--no-<x> negates an UNDECLARED flag too, and mints the camel twin',
      run: (ctx) => {
        const argv = parseArgv(['--no-dry-run'], {});
        ctx.expect(argv['dry-run']).toBe(false);
        ctx.expect(argv.dryRun).toBe(false);
        ctx.expect('no-dry-run' in argv).toBe(false);
      },
    },

    {
      name: '--no-<x> NEVER takes a value, so the token after it is a positional',
      run: (ctx) => {
        // The live line: the brand root forwards a false boolean as `--no-extended`
        // BEFORE the positionals, so a swallowed token loses the test path itself.
        const declared = parseArgv(['--no-extended', 'build/config'], { booleans: ['extended'] });
        ctx.expect(declared._, 'the path survives the negation').toEqual(['build/config']);
        ctx.expect(declared.extended).toBe(false);

        const undeclared = parseArgv(['--no-foo', 'bar'], {});
        ctx.expect(undeclared._).toEqual(['bar']);
        ctx.expect(undeclared.foo).toBe(false);
      },
    },

    {
      name: '--target=a,b stays one string (the picker splits it, not the parse)',
      run: (ctx) => {
        const argv = parseArgv(['--target=a,b'], {});
        ctx.expect(argv.target).toBe('a,b');
      },
    },

    {
      name: 'an UNDECLARED flag takes the next token as its value, never a positional',
      run: (ctx) => {
        const argv = parseArgv(['deploy', '--only', 'hosting'], {});
        ctx.expect(argv.only, 'nothing has to be declared for a value to survive').toBe('hosting');
        ctx.expect(argv._).toEqual(['deploy']);
      },
    },

    {
      name: 'a forwarded flag the receiving CLI never heard of keeps its value',
      run: (ctx) => {
        // The brand root forwards whatever it does not consume, so the target's own
        // parse is the one that must not drop `--filter foo`.
        const argv = parseArgv(['test', '--filter', 'foo'], {});
        ctx.expect(argv.filter).toBe('foo');
        ctx.expect(argv._).toEqual(['test']);
      },
    },

    {
      name: 'a flag followed by another FLAG is true, and the next flag is its own',
      run: (ctx) => {
        const argv = parseArgv(['test', '--filter', '--extended'], { booleans: ['extended'] });
        ctx.expect(argv.filter, 'a dash-led token is never eaten as a value').toBe(true);
        ctx.expect(argv.extended).toBe(true);
        ctx.expect(argv._).toEqual(['test']);
      },
    },

    {
      name: 'a flag at the END of the line is true',
      run: (ctx) => {
        ctx.expect(parseArgv(['test', '--filter'], {}).filter).toBe(true);
      },
    },

    {
      name: 'a declared boolean never swallows the next token',
      run: (ctx) => {
        const argv = parseArgv(['test', '--extended', 'project:foo'], { booleans: ['extended'] });
        ctx.expect(argv.extended).toBe(true);
        ctx.expect(argv._, 'the scope stays a positional').toEqual(['test', 'project:foo']);
      },
    },

    {
      name: '--flag=value always wins, even for a declared boolean-looking name',
      run: (ctx) => {
        ctx.expect(parseArgv(['--filter=foo bar'], {}).filter).toBe('foo bar');
        ctx.expect(parseArgv(['--signed-dir=release/signed'], {}).signedDir).toBe('release/signed');
      },
    },

    {
      name: 'a multiple accumulates into an array; ONE occurrence stays a string',
      run: (ctx) => {
        const many = parseArgv(['--where', 'a', '--where', 'b'], { multiples: ['where'] });
        ctx.expect(many.where).toEqual(['a', 'b']);

        const one = parseArgv(['--where', 'a'], { multiples: ['where'] });
        ctx.expect(one.where, 'a single clause reads as a string, exactly as the firestore command expects').toBe('a');
      },
    },

    {
      name: 'short flags stay short (-v and -h are the router\'s own surface)',
      run: (ctx) => {
        ctx.expect(parseArgv(['-v'], {}).v).toBe(true);
        ctx.expect(parseArgv(['-h'], {}).h).toBe(true);
      },
    },

    {
      name: 'positionals land at _, in order, after a -- terminator too',
      run: (ctx) => {
        ctx.expect(parseArgv(['test', 'mgr:build/foo'], {})._).toEqual(['test', 'mgr:build/foo']);
        ctx.expect(parseArgv(['--', '--raw', 'x'], {})._).toEqual(['--raw', 'x']);
      },
    },

    {
      name: 'a numeric value stays a STRING (the builtin never coerces; every consumer Number()s it)',
      run: (ctx) => {
        const argv = parseArgv(['--min-age', '0'], {});
        ctx.expect(argv['min-age']).toBe('0');
        ctx.expect(argv.minAge).toBe('0');
      },
    },

    {
      name: 'the value rule is per OCCURRENCE, so one line carries both shapes',
      run: (ctx) => {
        const argv = parseArgv(
          ['sign-windows', '--in', 'release', '--out', 'release/signed', '--verify-only', '--smoke'],
          { booleans: ['smoke'] },
        );
        ctx.expect(argv.in).toBe('release');
        ctx.expect(argv.out).toBe('release/signed');
        ctx.expect(argv.verifyOnly, 'a flag followed by another flag is true').toBe(true);
        ctx.expect(argv.smoke).toBe(true);
        ctx.expect(argv._).toEqual(['sign-windows']);
      },
    },
  ],
});
