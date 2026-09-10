/**
 * "How is this run asked to stop?" The ONE list every supervisor registers.
 *
 * A supervisor is any process that owns a child, a watcher or a long-running
 * loop it must unwind before it goes: the backend's emulator and test runner,
 * the manager's `omega dev`, the web dev server, the log tails. Each of them
 * used to hand-type its own subset, and the subsets disagreed. The manager
 * registered SIGINT and SIGTERM only, so a CLOSED TERMINAL (SIGHUP) killed the
 * orchestrator outright and its detached legs, the emulator tree among them,
 * orphaned with their ports ([#629](https://github.com/Omega-JS-Stack/omega/issues/629)).
 *
 * A signal with no listener is not a shutdown: node kills THIS process only,
 * and anything detached below it survives. So all three take the SAME teardown:
 * Ctrl+C (SIGINT), a programmatic stop (a supervisor's own shutdown, `omega
 * dev`'s stop, the journey lane, all SIGTERM), and a closed terminal (SIGHUP).
 *
 * Stdlib-only on purpose: a vendored module must not push a dependency onto
 * its hosts.
 */

/**
 * Every way a run is asked to stop.
 *
 * @type {string[]}
 */
const STOP_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

module.exports = { STOP_SIGNALS };
