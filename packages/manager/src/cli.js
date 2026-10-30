/**
 * The @omega.js/manager CLI dispatcher — devkit's shared router over
 * src/commands/. Every verb is NAMED (#229): `omega manage` walks every
 * service and reconciles the brand to its omega.json5, `omega dev` boots the
 * local stack, and a bare `omega` prints help and touches nothing — a CLI
 * that silently rewrites a brand because it was called with no arguments is
 * the wrong default. `manage` has no alias: one walk, one name. The alias
 * table is devkit's verb registry, never typed here.
 */
const path = require('node:path');

const { createCliRouter } = require('@omega.js/devkit/cli-router');
const { MANAGER } = require('@omega.js/devkit/omega-bin');
const { VERBS } = require('@omega.js/devkit/verbs');
const { passThroughRow, runPassThrough } = require('./lib/verb-passthrough.js');

// Command name → positional/flag aliases, read off every registry row the manager owns.
// A `passThrough` alias stays unclaimed, so it reaches the fallback below.
const ALIASES = Object.fromEntries(VERBS
  .filter((entry) => entry.owners.includes(MANAGER))
  .map((entry) => [entry.name, entry.aliases.filter((alias) => !entry.passThrough.includes(alias))]));

module.exports = createCliRouter({
  commandsDir: path.join(__dirname, 'commands'),
  aliases: ALIASES,
  defaultCommand: 'help',
  // A framework verb the manager keeps no command for runs on the picked targets, raw args forwarded
  fallback: (command) => (passThroughRow(command) ? () => runPassThrough(command, process.argv.slice(2)) : null),
});
