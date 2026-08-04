#!/usr/bin/env node
/**
 * A BROKEN upstream for the spawn-deadline and refresh-deadline tests: it
 * writes garbage to stdout and never answers initialize, so a client.connect()
 * against it never settles on its own. That is the shape that used to wedge an
 * upstream for a whole session.
 *
 * Every start appends a line to the file named by HANG_MARKER, which is how
 * the test proves a second call spawned a FRESH child instead of awaiting the
 * stuck one. Extra argv is accepted and ignored: refresh-deadline.test.js
 * passes a unique tag argument as its pgrep handle for child-liveness checks.
 */

const fs = require('node:fs');

if (process.env.HANG_MARKER) fs.appendFileSync(process.env.HANG_MARKER, 'started\n');

// Not JSON-RPC: the client's read buffer can never make a message of it.
process.stdout.write('hello from a server that does not speak MCP\n');

// Stay alive without ever replying. Nothing else holds the loop open, so the
// router's close() (which ends our stdin) still terminates us promptly.
process.stdin.resume();
