/**
 * `omega build` at a brand root — compile every target, each in its own
 * framework's hands (#603): the web site, the backend's staged dist, the
 * desktop bundles, the extension's gulp lane, and a custom target's own
 * `build` script.
 *
 *   omega build                     → every target, backend first
 *   omega build --target=web        → one target (target key or dir name)
 *   omega build --target=web,api    → explicit set
 *
 * The walk, the order and the loud skip are the shared brand-root fan-out
 * (lib/verb-fanout.js); this file is the verb. Targets are independent: a
 * failing one never stops the rest, and any failure exits 1.
 */
const { runVerbFanout } = require('../lib/verb-fanout.js');

module.exports = async (options = {}, deps = {}) => runVerbFanout('build', options, deps);
