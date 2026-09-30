// Unit tests for src/merge-line-files.js — the OMEGA marker-section merge protocol.
// Mirrors the coverage of EM's build-layer suite (which now tests through its shim).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeLineBasedFiles, normalizeEnvLine, hasSectionMarkers, getCustomSection, sectionMarkers, DEFAULT_MARKER, CUSTOM_MARKER } = require('../src/merge-line-files');

test('preserves user value in default section across merges (and quotes it)', () => {
  const existing = `${DEFAULT_MARKER}\nGH_TOKEN=ghp_secret123\nBACKEND_MANAGER_KEY=\n\n${CUSTOM_MARKER}\n`;
  const incoming = `${DEFAULT_MARKER}\nGH_TOKEN=""\nBACKEND_MANAGER_KEY=""\n\n${CUSTOM_MARKER}\n`;
  const merged = mergeLineBasedFiles(existing, incoming, '.env');
  assert.match(merged, /GH_TOKEN="ghp_secret123"/);
});

test('adds new framework default keys the user does not have', () => {
  const existing = `${DEFAULT_MARKER}\nOLD_KEY="kept"\n${CUSTOM_MARKER}\n`;
  const incoming = `${DEFAULT_MARKER}\nOLD_KEY=""\nNEW_KEY=""\n${CUSTOM_MARKER}\n`;
  const merged = mergeLineBasedFiles(existing, incoming, '.env');
  assert.match(merged, /OLD_KEY="kept"/);
  assert.match(merged, /NEW_KEY=""/);
});

test('.env: a VALUED retired default-section key migrates to the custom section', () => {
  const existing = `${DEFAULT_MARKER}\nFRAMEWORK_KEY=""\nUSER_KEY="mine"\n${CUSTOM_MARKER}\n`;
  const incoming = `${DEFAULT_MARKER}\nFRAMEWORK_KEY=""\n${CUSTOM_MARKER}\n`;
  const merged = mergeLineBasedFiles(existing, incoming, '.env');
  const customPart = merged.slice(merged.indexOf(CUSTOM_MARKER));
  assert.match(customPart, /USER_KEY="mine"/);
});

test('.env: an EMPTY retired default-section key drops instead of migrating (#926)', () => {
  const existing = `${DEFAULT_MARKER}\nFRAMEWORK_KEY=""\nRETIRED_BARE=\nRETIRED_QUOTED=""\nUSER_KEY="mine"\n${CUSTOM_MARKER}\n`;
  const incoming = `${DEFAULT_MARKER}\nFRAMEWORK_KEY=""\n${CUSTOM_MARKER}\n`;
  const merged = mergeLineBasedFiles(existing, incoming, '.env');
  assert.doesNotMatch(merged, /RETIRED_BARE/, 'an empty retired key carries no data to keep');
  assert.doesNotMatch(merged, /RETIRED_QUOTED/);
  assert.match(merged.slice(merged.indexOf(CUSTOM_MARKER)), /USER_KEY="mine"/, 'a valued one still migrates');
});

test('custom section is preserved verbatim (env values normalized to quotes)', () => {
  const existing = `${DEFAULT_MARKER}\nA=""\n${CUSTOM_MARKER}\n# my note\nMY_SECRET=raw value\n`;
  const incoming = `${DEFAULT_MARKER}\nA=""\n${CUSTOM_MARKER}\n`;
  const merged = mergeLineBasedFiles(existing, incoming, '.env');
  assert.match(merged, /# my note/);
  assert.match(merged, /MY_SECRET="raw value"/);
});

test('custom key newly adopted by the framework is promoted UP into default (@omega.js/backend behavior)', () => {
  const existing = `${DEFAULT_MARKER}\n${CUSTOM_MARKER}\nGH_TOKEN="moved"\n`;
  const incoming = `${DEFAULT_MARKER}\nGH_TOKEN=""\n${CUSTOM_MARKER}\n`;
  const merged = mergeLineBasedFiles(existing, incoming, '.env');
  const defaultPart = merged.slice(0, merged.indexOf(CUSTOM_MARKER));
  const customPart = merged.slice(merged.indexOf(CUSTOM_MARKER));
  assert.match(defaultPart, /GH_TOKEN="moved"/);
  assert.doesNotMatch(customPart, /GH_TOKEN/);
  // Promotion is idempotent: the next merge preserves the value from Default.
  const again = mergeLineBasedFiles(merged, incoming, '.env');
  assert.equal(again, merged);
});

test('key present in BOTH sections: default value wins, custom copy is kept (no silent value flip)', () => {
  // dotenv resolves the LAST occurrence, so the effective value was the custom
  // "b". Dropping the custom copy would flip the effective value to "a" — keep it.
  const existing = `${DEFAULT_MARKER}\nGH_TOKEN="a"\n${CUSTOM_MARKER}\nGH_TOKEN="b"\n`;
  const incoming = `${DEFAULT_MARKER}\nGH_TOKEN=""\n${CUSTOM_MARKER}\n`;
  const merged = mergeLineBasedFiles(existing, incoming, '.env');
  const defaultPart = merged.slice(0, merged.indexOf(CUSTOM_MARKER));
  const customPart = merged.slice(merged.indexOf(CUSTOM_MARKER));
  assert.match(defaultPart, /GH_TOKEN="a"/);
  assert.match(customPart, /GH_TOKEN="b"/);
});

test('hasSectionMarkers: true only when both markers present', () => {
  assert.equal(hasSectionMarkers(`${DEFAULT_MARKER}\n${CUSTOM_MARKER}\n`), true);
  assert.equal(hasSectionMarkers(`${DEFAULT_MARKER}\n`), false);
  assert.equal(hasSectionMarkers('KEY=value\n'), false);
  assert.equal(hasSectionMarkers(''), false);
});

test('hasSectionMarkers: both markers must be whole lines, Default before Custom', () => {
  assert.equal(hasSectionMarkers(`  ${DEFAULT_MARKER}\nA=\n${CUSTOM_MARKER}  \n`), true, 'surrounding whitespace is still a whole line');
  assert.equal(hasSectionMarkers(`We split on ${DEFAULT_MARKER} and ${CUSTOM_MARKER} here.\n`), false, 'quoted inline is no marker');
  assert.equal(hasSectionMarkers(`${CUSTOM_MARKER}\n${DEFAULT_MARKER}\n`), false, 'Custom above Default is no marked file');
  const md = sectionMarkers('AGENTS.md');
  assert.equal(hasSectionMarkers(`Quote \`${md.defaultMarker}\` then \`${md.customMarker}\`.\n`, 'AGENTS.md'), false);
});

test('getCustomSection: the Custom marker counts only as a whole line', () => {
  const content = `${DEFAULT_MARKER}\nsee ${CUSTOM_MARKER} inline\n${CUSTOM_MARKER}\nmine\n`;
  assert.equal(getCustomSection(content), '\nmine\n');
});

test('a marked file\'s lines above the Default marker land at the top of Custom, once', () => {
  const md = sectionMarkers('AGENTS.md');
  const incoming = `${md.defaultMarker}\n@node_modules/@omega.js/manager/AGENTS.md\n\n${md.customMarker}\n`;

  const withNotes = `# My Project\n\n${md.defaultMarker}\n@../stale/AGENTS.md\n\n${md.customMarker}\nOur deploy needs the VPN up.\n`;
  const merged = mergeLineBasedFiles(withNotes, incoming, 'AGENTS.md');
  assert.equal(merged, `${incoming}# My Project\n\nOur deploy needs the VPN up.\n`);
  assert.equal(mergeLineBasedFiles(merged, incoming, 'AGENTS.md'), merged, 'a second pass is identical');

  const titleOnly = `# My Project\n${md.defaultMarker}\n@node_modules/@omega.js/manager/AGENTS.md\n\n${md.customMarker}\n`;
  assert.equal(mergeLineBasedFiles(titleOnly, incoming, 'AGENTS.md'), `${incoming}# My Project\n`);

  const gitignore = `my-dir/\n${DEFAULT_MARKER}\nnode_modules/\n\n${CUSTOM_MARKER}\n*.log\n`;
  assert.equal(mergeLineBasedFiles(gitignore, `${DEFAULT_MARKER}\nnode_modules/\n\n${CUSTOM_MARKER}\n`, '.gitignore'), `${DEFAULT_MARKER}\nnode_modules/\n\n${CUSTOM_MARKER}\nmy-dir/\n\n*.log\n`);
});

test('.gitignore: a retired Default-block line DROPS, the Custom section is untouched (#926)', () => {
  const existing = `${DEFAULT_MARKER}\nnode_modules/\nconfig/certs/\n${CUSTOM_MARKER}\n*.log\n`;
  const incoming = `${DEFAULT_MARKER}\nnode_modules/\nconfig/certs/*\n!config/certs/README.md\n${CUSTOM_MARKER}\n`;
  const merged = mergeLineBasedFiles(existing, incoming, '.gitignore');
  const customPart = merged.slice(merged.indexOf(CUSTOM_MARKER));
  assert.doesNotMatch(merged, /^config\/certs\/$/m, 'the retired line leaves the file entirely');
  assert.match(merged, /^config\/certs\/\*$/m);
  assert.match(merged, /^!config\/certs\/README\.md$/m);
  assert.match(customPart, /\*\.log/);
});

test('.gitignore: the new rule is idempotent (second pass identical) (#926)', () => {
  const existing = `${DEFAULT_MARKER}\nnode_modules/\nconfig/certs/\n${CUSTOM_MARKER}\n*.log\n`;
  const incoming = `${DEFAULT_MARKER}\nnode_modules/\nconfig/certs/*\n${CUSTOM_MARKER}\n`;
  const once = mergeLineBasedFiles(existing, incoming, '.gitignore');
  const twice = mergeLineBasedFiles(once, incoming, '.gitignore');
  assert.equal(twice, once);
});

test('merge is idempotent: second pass returns identical content', () => {
  const existing = `${DEFAULT_MARKER}\nKEY=value with spaces\n${CUSTOM_MARKER}\nUSER=x\n`;
  const incoming = `${DEFAULT_MARKER}\nKEY=""\n${CUSTOM_MARKER}\n`;
  const once = mergeLineBasedFiles(existing, incoming, '.env');
  const twice = mergeLineBasedFiles(once, incoming, '.env');
  assert.equal(twice, once);
});

test('pre-marker lines in a legacy file are treated as default section', () => {
  const existing = `LEGACY_KEY="old"\n`;
  const incoming = `${DEFAULT_MARKER}\nLEGACY_KEY=""\nNEW=""\n${CUSTOM_MARKER}\n`;
  const merged = mergeLineBasedFiles(existing, incoming, '.env');
  assert.match(merged, /LEGACY_KEY="old"/);
});

test('normalizeEnvLine: raw wraps, single-quote canonicalizes, empty quotes, double-quote untouched', () => {
  assert.equal(normalizeEnvLine('KEY=raw'), 'KEY="raw"');
  assert.equal(normalizeEnvLine("KEY='single'"), 'KEY="single"');
  assert.equal(normalizeEnvLine('KEY="done"'), 'KEY="done"');
  assert.equal(normalizeEnvLine('KEY='), 'KEY=""');
  assert.equal(normalizeEnvLine('# comment'), '# comment');
  assert.equal(normalizeEnvLine('KEY=has "quote"'), 'KEY="has "quote""', 'dotenv reads an embedded quote verbatim, so it is never escaped');
});

test('placeholder `# KEY=""`: existing SET value keeps its line in default (either section)', () => {
  const existing = `${DEFAULT_MARKER}\nOMEGA_ADMIN_KEY="real-value"\n${CUSTOM_MARKER}\nCUSTOM_TOKEN="user-set"\n`;
  const incoming = `${DEFAULT_MARKER}\n# OMEGA_ADMIN_KEY=""\n# CUSTOM_TOKEN=""\n# NEVER_SET=""\n${CUSTOM_MARKER}\n`;
  const merged = mergeLineBasedFiles(existing, incoming, '.env');

  assert.match(merged, /OMEGA_ADMIN_KEY="real-value"/, 'default-section value survives the placeholder');
  assert.match(merged, /CUSTOM_TOKEN="user-set"/, 'custom-section value is promoted into default');
  assert.doesNotMatch(merged, /# OMEGA_ADMIN_KEY=/, 'no duplicate placeholder for a set key');
  assert.match(merged, /# NEVER_SET=""/, 'unset key stays a commented placeholder');
  const customHalf = merged.slice(merged.indexOf(CUSTOM_MARKER));
  assert.doesNotMatch(customHalf, /CUSTOM_TOKEN/, 'promoted key drops out of custom');
});

test('placeholder `# KEY=""`: existing EMPTY values converge to the placeholder instead of migrating to custom (friction #20)', () => {
  const existing = `${DEFAULT_MARKER}\nOMEGA_ADMIN_KEY=""\nOMEGA_WEBHOOK_KEY=\n${CUSTOM_MARKER}\n`;
  const incoming = `${DEFAULT_MARKER}\n# OMEGA_ADMIN_KEY=""\n# OMEGA_WEBHOOK_KEY=""\n${CUSTOM_MARKER}\n`;
  const merged = mergeLineBasedFiles(existing, incoming, '.env');

  assert.match(merged, /# OMEGA_ADMIN_KEY=""/, 'quoted-empty converges to the placeholder');
  assert.match(merged, /# OMEGA_WEBHOOK_KEY=""/, 'bare-empty converges to the placeholder');
  assert.doesNotMatch(merged, /^OMEGA_ADMIN_KEY=/m, 'the shadowing empty line is gone');
  const customHalf = merged.slice(merged.indexOf(CUSTOM_MARKER));
  assert.doesNotMatch(customHalf, /OMEGA_/, 'empties never migrate into custom');
});

test('placeholder merge is idempotent', () => {
  const existing = `${DEFAULT_MARKER}\nSET_KEY="v"\nEMPTY_KEY=""\n${CUSTOM_MARKER}\nMINE="x"\n`;
  const incoming = `${DEFAULT_MARKER}\n# SET_KEY=""\n# EMPTY_KEY=""\n${CUSTOM_MARKER}\n`;
  const once = mergeLineBasedFiles(existing, incoming, '.env');
  const twice = mergeLineBasedFiles(once, incoming, '.env');
  assert.equal(twice, once);
});

test('placeholder: `# KEY=""` and a bare `# KEY=` are both the framework\'s own, so neither lands in Custom', () => {
  const incoming = `${DEFAULT_MARKER}\n# A=""\n# B=""\n\n${CUSTOM_MARKER}\n`;

  for (const existing of [
    `${DEFAULT_MARKER}\n# A=\n# B=\n\n${CUSTOM_MARKER}\n`,
    '# A=\n# B=""\n# RETIRED=""\n# GONE=\n',
  ]) {
    const merged = mergeLineBasedFiles(existing, incoming, '.env');
    assert.equal(merged, incoming, JSON.stringify(merged));
  }
});

test('getCustomSection: returns everything after the Custom marker, and "" without markers', () => {
  const content = `${DEFAULT_MARKER}\nframework\n${CUSTOM_MARKER}\nmy notes\n`;
  assert.equal(getCustomSection(content), '\nmy notes\n');
  assert.equal(getCustomSection('no markers here'), '');
  assert.equal(getCustomSection(null), '');
});

// ─── One grammar, three comment flavors ──────────────────────────────────────

test('sectionMarkers: markdown takes the HTML-comment flavor of the one grammar, every other file the # flavor', () => {
  assert.deepEqual(sectionMarkers('AGENTS.md'), {
    defaultMarker: '<!-- ========== Default Values ========== -->',
    customMarker: '<!-- ========== Custom Values ========== -->',
  });
  assert.deepEqual(sectionMarkers('.gitignore'), { defaultMarker: DEFAULT_MARKER, customMarker: CUSTOM_MARKER });
  assert.deepEqual(sectionMarkers('.gitattributes'), { defaultMarker: DEFAULT_MARKER, customMarker: CUSTOM_MARKER });
});

test('markdown flavor: the Default section is rewritten, the Custom section kept, a second pass identical', () => {
  const { defaultMarker, customMarker } = sectionMarkers('AGENTS.md');
  const existing = `${defaultMarker}\n@../../stale/AGENTS.md\n\n${customMarker}\n# My notes\n\nKeep ${DEFAULT_MARKER} quoted.\n`;
  const incoming = `${defaultMarker}\n@node_modules/@omega.js/manager/AGENTS.md\n\n${customMarker}\n`;

  const merged = mergeLineBasedFiles(existing, incoming, 'AGENTS.md');
  assert.equal(merged, `${defaultMarker}\n@node_modules/@omega.js/manager/AGENTS.md\n\n${customMarker}\n# My notes\n\nKeep ${DEFAULT_MARKER} quoted.\n`);
  assert.equal(mergeLineBasedFiles(merged, incoming, 'AGENTS.md'), merged);
  assert.equal(hasSectionMarkers(merged, 'AGENTS.md'), true);
  assert.equal(hasSectionMarkers(merged), false, 'the # flavor is a different marker pair');
  assert.equal(getCustomSection(merged, 'AGENTS.md'), `\n# My notes\n\nKeep ${DEFAULT_MARKER} quoted.\n`);
});

// ─── The shipped Custom boilerplate leaves ───────────────────────────────────

test('a marked Custom section that is exactly a shipped boilerplate block strips to its marker', () => {
  const incoming = `${DEFAULT_MARKER}\nnode_modules/\n\n${CUSTOM_MARKER}\n`;
  const generations = [
    `${CUSTOM_MARKER}\n# Add your custom ignore patterns below this line\n# ...\n`,
    `${CUSTOM_MARKER}\n\n# Add your own ignores below. This section is preserved across framework re-syncs.\n`,
    `${CUSTOM_MARKER}\n\n# Add your own ignores below. This section is preserved across \`npx omega setup\` runs.\n`,
    `${CUSTOM_MARKER}\n\n# Add your own ignores below. This section is preserved across \`npx mgr setup\` runs.\n`,
    `${CUSTOM_MARKER}\n# ...\n`,
  ];
  for (const custom of generations) {
    const merged = mergeLineBasedFiles(`${DEFAULT_MARKER}\nnode_modules/\n\n${custom}`, incoming, '.gitignore');
    assert.equal(merged, incoming, JSON.stringify(custom));
  }
});

test('a marked Custom section holding anything beyond the boilerplate stays verbatim on every run', () => {
  const incoming = `${DEFAULT_MARKER}\nnode_modules/\n\n${CUSTOM_MARKER}\n`;
  for (const custom of [
    '# Add your custom ignore patterns below this line\n# ...\nmy-secret-dir/\n',
    '# ...\nmy-secret-dir/\n',
    '# my own ignores\n# ...\n',
  ]) {
    const existing = `${incoming}${custom}`;
    assert.equal(mergeLineBasedFiles(existing, incoming, '.gitignore'), existing, JSON.stringify(custom));
  }

  const md = sectionMarkers('AGENTS.md');
  const agents = `${md.defaultMarker}\n@node_modules/@omega.js/manager/AGENTS.md\n\n${md.customMarker}\n## Project-specific notes\n\nOur deploy needs the VPN up.\n`;
  const agentsIncoming = `${md.defaultMarker}\n@node_modules/@omega.js/manager/AGENTS.md\n\n${md.customMarker}\n`;
  assert.equal(mergeLineBasedFiles(agents, agentsIncoming, 'AGENTS.md'), agents);
});

// ─── The first converge of an unmarked file ──────────────────────────────────

test('unmarked .gitignore: framework lines go to Default, every other line to Custom, nothing duplicated', () => {
  const incoming = `${DEFAULT_MARKER}\n# Dependencies\nnode_modules/\n\n# Secrets\n.env\n.env.*\n\n${CUSTOM_MARKER}\n`;
  const existing = [
    'node_modules/',
    'test/e2e/.logs/',
    '',
    '# An older generation\'s header over framework lines only',
    '.env',
    '',
    '# Secrets',
    '.env.local',
    '',
    '# my own block',
    '*.log',
  ].join('\n');

  const merged = mergeLineBasedFiles(existing, incoming, '.gitignore');
  assert.equal(merged, `${incoming}test/e2e/.logs/\n\n.env.local\n\n# my own block\n*.log\n`);
  assert.equal(mergeLineBasedFiles(merged, incoming, '.gitignore'), merged, 'a second pass is identical');
});

test('unmarked file holding exactly the framework lines converges to the template', () => {
  const incoming = `${DEFAULT_MARKER}\n# Translation caches\ntranslations/** linguist-generated=true\n\n${CUSTOM_MARKER}\n`;
  const existing = '# Translation caches (an older wording)\ntranslations/** linguist-generated=true\n';
  assert.equal(mergeLineBasedFiles(existing, incoming, '.gitattributes'), incoming);
  assert.equal(mergeLineBasedFiles('', incoming, '.gitattributes'), incoming);
});

// ─── .env: the value dotenv reads never changes ──────────────────────────────

const dotenv = require('dotenv');

test('normalizeEnvLine: the double-quoted form never changes the value dotenv reads', () => {
  const lines = [
    'KEY=abc # note',
    'KEY=a\\b',
    'KEY=he said "hi"',
    'KEY=  lead',
    'KEY="x" # c',
    'KEY=a#b',
    "KEY='a\\nb'",
    "KEY='single' # c",
    'KEY=`tick`',
    '  KEY=indented',
    'export KEY=exported',
    'KEY="a\nb"',
  ];
  for (const line of lines) {
    const normalized = normalizeEnvLine(line);
    assert.equal(dotenv.parse(normalized).KEY, dotenv.parse(line).KEY, `${JSON.stringify(line)} -> ${JSON.stringify(normalized)}`);
  }
  assert.equal(normalizeEnvLine('KEY=abc # note'), 'KEY="abc" # note', 'an inline comment stays');
  assert.equal(normalizeEnvLine('KEY=  lead'), 'KEY="lead"');
  assert.equal(normalizeEnvLine("KEY='single' # c"), 'KEY="single" # c');
  assert.equal(normalizeEnvLine("KEY='a\nb'"), 'KEY="a\\nb"', 'a real newline is written as \\n, one line, as envLine writes it');
});

test('.env: a duplicated key keeps the LAST value, the one dotenv reads', () => {
  const incoming = `${DEFAULT_MARKER}\n# A=\nB=""\n${CUSTOM_MARKER}\n`;
  const existing = `${DEFAULT_MARKER}\nA="first"\nA="second"\nB="one"\nB="two"\n${CUSTOM_MARKER}\n`;
  const merged = mergeLineBasedFiles(existing, incoming, '.env');
  assert.deepEqual(dotenv.parse(merged), { A: 'second', B: 'two' });
});

test('.env: a multi-line quoted value survives as one unit, in either section and on a first converge', () => {
  const cert = 'CERT="-----BEGIN KEY-----\nabc=\ndef\n-----END KEY-----"';
  const incoming = `${DEFAULT_MARKER}\n# CERT=\n# KNOWN=\n${CUSTOM_MARKER}\n`;

  for (const existing of [
    `${DEFAULT_MARKER}\n${cert}\nKNOWN="k"\n${CUSTOM_MARKER}\n`,
    `${DEFAULT_MARKER}\nKNOWN="k"\n${CUSTOM_MARKER}\n${cert.replace('CERT', 'MINE')}\n`,
    `${cert.replace('CERT', 'MINE')}\nKNOWN="k"\n`,
  ]) {
    const merged = mergeLineBasedFiles(existing, incoming, '.env');
    assert.deepEqual(dotenv.parse(merged), dotenv.parse(existing), JSON.stringify(merged));
    assert.equal(mergeLineBasedFiles(merged, incoming, '.env'), merged, 'a second pass is identical');
  }
});

test('.env: a value ending in a backslash before its quote closes on its own line when dotenv reads it there', () => {
  const incoming = `${DEFAULT_MARKER}\n# KNOWN=""\n${CUSTOM_MARKER}\n`;
  for (const [existing, neighbour] of [['MINE="x\\"\nB=raw\nOTHER="c"\n', 'B'], ['MINE="x\\"\nKNOWN="k"\nOTHER="c"\n', 'KNOWN']]) {
    const read = dotenv.parse(existing);
    const merged = mergeLineBasedFiles(existing, incoming, '.env');
    assert.deepEqual(dotenv.parse(merged), read, JSON.stringify(merged));
    assert.match(merged, new RegExp(`^${neighbour}="${read[neighbour]}"$`, 'm'), 'the neighbour is its own unit, quoted');
    assert.equal(merged.match(/^#?\s*KNOWN=/gm).length, 1, 'no placeholder beside a set key');
  }

  // A later line closing the quote is the longer read dotenv takes: one unit.
  const spanning = 'MINE="x\\"\nB=raw"\n';
  assert.deepEqual(dotenv.parse(mergeLineBasedFiles(spanning, incoming, '.env')), dotenv.parse(spanning));
});

test('.env first converge: a hand comment directly above an unknown key travels with it into Custom', () => {
  const incoming = `${DEFAULT_MARKER}\n# ── Known ──\n# KNOWN=\n\n${CUSTOM_MARKER}\n`;
  const existing = '# Known\nKNOWN="k"\n\n# my own token, rotated monthly\n# (ask ops)\nMINE="x"\nOTHER="y"\n';
  const merged = mergeLineBasedFiles(existing, incoming, '.env');

  assert.deepEqual(dotenv.parse(merged), dotenv.parse(existing));
  assert.ok(merged.endsWith(`${CUSTOM_MARKER}\n# my own token, rotated monthly\n# (ask ops)\nMINE="x"\nOTHER="y"\n`), merged);
  assert.equal(mergeLineBasedFiles(merged, incoming, '.env'), merged);
});

test('.env first converge: the framework\'s own comment grammar above an unknown key stays behind', () => {
  const incoming = `${DEFAULT_MARKER}\n# ── Known ──\n# KNOWN=\n\n${CUSTOM_MARKER}\n`;
  const existing = '# ── Other keys (not in the canonical groups) ──\n# RETIRED=\n# my note\nMINE="x"\n';
  const merged = mergeLineBasedFiles(existing, incoming, '.env');
  assert.ok(merged.endsWith(`${CUSTOM_MARKER}\n# my note\nMINE="x"\n`), merged);
});

test('.env: an old generated header strips only on an unmarked file\'s first converge', () => {
  const header = '# Acme: brand secrets (gitignored; loaded before every omega run).\n# my note\n';
  const incoming = `${DEFAULT_MARKER}\n# KNOWN=\n\n${CUSTOM_MARKER}\n`;
  assert.equal(mergeLineBasedFiles(header, incoming, '.env'), `${incoming}# my note\n`);

  const marked = `${incoming}${header}`;
  assert.equal(mergeLineBasedFiles(marked, incoming, '.env'), marked, 'a marked Custom section stays verbatim');
  assert.equal(mergeLineBasedFiles(header, `${DEFAULT_MARKER}\nnode_modules/\n\n${CUSTOM_MARKER}\n`, '.gitignore').endsWith(header), true, 'a .gitignore never strips the .env header');
});

test('a shipped block strips only in the file type that shipped it', () => {
  const env = `${DEFAULT_MARKER}\n# KNOWN=\n\n${CUSTOM_MARKER}\n# ...\n`;
  assert.equal(mergeLineBasedFiles(env, `${DEFAULT_MARKER}\n# KNOWN=\n\n${CUSTOM_MARKER}\n`, '.env'), env, 'a .env never shipped `# ...`');

  const gitignore = `${DEFAULT_MARKER}\nnode_modules/\n\n${CUSTOM_MARKER}\n<!-- Add your project-specific notes below this line -->\n`;
  assert.equal(mergeLineBasedFiles(gitignore, `${DEFAULT_MARKER}\nnode_modules/\n\n${CUSTOM_MARKER}\n`, '.gitignore'), gitignore, 'the AGENTS.md block is not a .gitignore one');

  const md = sectionMarkers('AGENTS.md');
  const agents = `${md.defaultMarker}\n@x\n\n${md.customMarker}\n# ...\n`;
  assert.equal(mergeLineBasedFiles(agents, `${md.defaultMarker}\n@x\n\n${md.customMarker}\n`, 'AGENTS.md'), agents, 'nor is `# ...` an AGENTS.md one');
});
