/**
 * Every byte a call writes to stdout and to stderr, held apart and kept off
 * the terminal; the real writers come back before it returns or throws.
 */

/**
 * @param {Function} fn - The call to capture; sync or async.
 * @returns {Promise<{ stdout: string, stderr: string }>} What each stream received.
 */
async function captureOutput(fn) {
  const written = { stdout: [], stderr: [] };
  const out = process.stdout.write;
  const err = process.stderr.write;

  process.stdout.write = (chunk) => { written.stdout.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { written.stderr.push(String(chunk)); return true; };

  try {
    await fn();
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }

  return { stdout: written.stdout.join(''), stderr: written.stderr.join('') };
}

module.exports = { captureOutput };
