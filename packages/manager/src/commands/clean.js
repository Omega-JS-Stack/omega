/**
 * `omega clean` at a brand root — wipe every target's build output, each in
 * its own framework's hands (#603): the frameworks' own `omega clean`, and a
 * custom target's own `clean` script.
 *
 *   omega clean                     → every target
 *   omega clean --target=web        → one target (target key or dir name)
 *   omega clean --target=web,api    → explicit set
 *
 * The walk, the order and the loud skip are the shared brand-root fan-out
 * (lib/verb-fanout.js); this file is the verb. Targets are independent: a
 * failing one never stops the rest, and any failure exits 1.
 */
const { runVerbFanout } = require('../lib/verb-fanout.js');

module.exports = async (options = {}, deps = {}) => runVerbFanout('clean', options, deps);
