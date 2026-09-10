#!/usr/bin/env node
/**
 * The MIDDLE of the depth-2 fixture tree: it starts the LEAF and then goes when
 * its own parent goes. That is what makes the leaf invisible to anything that
 * looked only one level down — by the time a grace period runs, this level is
 * gone and the leaf has been reparented out of every walk.
 *
 * Being reparented IS the signal the root above has died. The leaf lingers on
 * its own, and both levels carry a self-exit so no run can leave one behind.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');

const leaf = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 30000)'], { stdio: 'ignore' });
leaf.unref();

fs.writeFileSync(process.env.DEEP_MARKER, `${JSON.stringify({ mid: process.pid, leaf: leaf.pid })}\n`);

setInterval(() => {
  if (process.ppid === 1) process.exit(0);
}, 100);

setTimeout(() => process.exit(0), 30000);
