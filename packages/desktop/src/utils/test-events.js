// The ONE prefix a desktop test harness writes before each JSON event line on
// stdout (test/harness/main-entry.js, test/harness/boot-entry.js,
// utils/boot-harness.js) and each runner reads back (test/runners/electron.js,
// test/runners/boot.js).
const TEST_EVENT_PREFIX = '__OMEGA_TEST__';

module.exports = { TEST_EVENT_PREFIX };
