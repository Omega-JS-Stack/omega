/**
 * Testing-mode email capture — the sink `Transactional.send()` writes to instead
 * of handing an email to SendGrid ([#774](https://github.com/Omega-JS-Stack/omega/issues/774)).
 *
 * Outside extended mode nothing proved an email was sent: every caller gated
 * ITSELF on `ctx.isTesting()`, so a broken welcome email or a broken order
 * receipt failed no test. The gate now lives in the mailer, past `build()` — the
 * brand, the recipients, the template data and the MJML render all run for real,
 * and what would have gone to SendGrid is RECORDED here.
 *
 * ## The store: a JSONL file beside `.temp/test-mode.json`
 *
 * `<projectDir>/.temp/test-emails.jsonl`, one JSON record per line. Chosen over a
 * test-only Firestore collection because a test drives the mailer from three
 * different places and only a file serves all three:
 *   - the emulator's function worker (a route, a trigger, a cron) — another process
 *     entirely from the test runner, which is why an in-memory array cannot work,
 *   - the test-runner process itself (`Manager.Email(ctx).send()` in a case),
 *   - a plain-node case with no emulator at all (the transition handlers, driven
 *     directly) — which has no Firestore to read a `_test/emails` collection out of.
 *
 * It also costs nothing else: no security rules, no index, no seeded cleanup lane,
 * and `.temp/` is already the gitignored transient directory every OMEGA consumer
 * project carries (same home as `test-mode.json`, same resolution).
 *
 * Append-safety across those processes rides on POSIX `O_APPEND`: a single write
 * under `PIPE_BUF` (4096 bytes) lands whole, so two processes appending never
 * interleave a line. `LINE_LIMIT` keeps every record inside that bound by trimming
 * the summary — the one field that can grow.
 *
 * ## Reading it from a test
 *
 *   const capture = require('<dist>/test/utils/email-capture.js');
 *
 *   capture.clearCaptured(Manager);            // before the act
 *   await http.as('...').post('...');          // the act
 *   const sent = capture.readCaptured(Manager); // [{ to, template, subject, summary, sendAt }]
 *
 * `readCaptured()` / `clearCaptured()` are TEST helpers — nothing in the framework's
 * public surface exports them, exactly like `test-mode-file.js`.
 */
const path = require('path');
const jetpack = require('fs-jetpack');

const { TEMP_DIR_NAME } = require('./test-mode-file.js');

const CAPTURE_FILENAME = 'test-emails.jsonl';

// The rendered email's visible text, trimmed to what a test reads it for: the
// order template puts its SUMMARY rows (the product name, the totals) in the first
// few hundred characters, above the fold of every variant.
const SUMMARY_LIMIT = 1000;

// One record must stay inside PIPE_BUF (4096) so the append is atomic against
// another process's. Measured in BYTES, which is what the write syscall counts —
// a summary of emoji and accented characters is longer on disk than in characters.
// Only the summary is trimmable, so it absorbs the overflow.
const LINE_LIMIT = 4000;

/**
 * Resolve the absolute path to the capture file for a given consumer project.
 *
 * @param {string} projectDir - Consumer project root (the directory that contains
 *                              `firebase.json` and the staged `dist/`).
 * @returns {string} Absolute path to `<projectDir>/.temp/test-emails.jsonl`.
 */
function getCaptureFilePath(projectDir) {
  return path.join(projectDir, TEMP_DIR_NAME, CAPTURE_FILENAME);
}

/**
 * Resolve the consumer project root from a booted Manager.
 *
 * `Manager.cwd` is the staged tree the process booted with, and it is
 * `<projectDir>/dist` in BOTH processes — the test runner boots there
 * (src/test/run-tests.js) and so do the emulator's function workers, whose source
 * directory `firebase.json` names is `dist`. So the parent is the project root
 * either way, which is exactly how the test-mode watcher resolves the file it
 * shares with the test command (src/manager/index.js).
 *
 * @param {object} Manager - A booted BackendManager
 * @returns {string} The consumer project root
 */
function resolveProjectDir(Manager) {
  // A Manager that never booted has no project, and a capture written to the
  // wrong directory is worse than none: the reader would see an empty store and
  // report a missing email.
  if (!Manager || !Manager.cwd) {
    throw new Error('email-capture: Manager.cwd is unset — cannot resolve the project the capture store lives under');
  }

  return path.dirname(Manager.cwd);
}

/**
 * Whether this send is captured rather than delivered.
 *
 * The ONE gate. Testing mode captures; extended mode (`TEST_EXTENDED_MODE`) is the
 * lane that deliberately sends real mail and is left exactly as it was; production
 * and development always deliver.
 *
 * Read per call (never cached) because the test command flips `TEST_EXTENDED_MODE`
 * on a RUNNING emulator through `.temp/test-mode.json`.
 *
 * A ctx that cannot answer `isTesting()` is a PROGRAMMER error and throws: every
 * real ctx forwards the call to the Manager, and the only other outcome a fallback
 * could produce here is "not testing", i.e. handing a test's email to SendGrid.
 * The gate never fails toward delivering real mail.
 *
 * @param {object} ctx - The route/handler context
 * @returns {boolean}
 */
function isCapturing(ctx) {
  if (!ctx || typeof ctx.isTesting !== 'function') {
    throw new Error('email-capture: ctx has no isTesting() — the capture gate refuses to guess, because guessing wrong delivers real mail');
  }

  return !!ctx.isTesting() && !process.env.TEST_EXTENDED_MODE;
}

/**
 * Reduce rendered email HTML to the visible text a test asserts against.
 *
 * Drops <style>/<head> content, strips tags, decodes the entities the templates
 * emit (`&#128512;`, `&amp;`, `&ndash;`, …) and collapses whitespace — so the
 * product name a template printed as `<strong>Brand Premium</strong>` reads back as
 * `Brand Premium`.
 *
 * @param {string} html - The rendered email body
 * @returns {string} Collapsed visible text, capped at SUMMARY_LIMIT
 */
function summarize(html) {
  if (!html || typeof html !== 'string') {
    return '';
  }

  const text = html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&minus;/g, '−')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

  return text.slice(0, SUMMARY_LIMIT);
}

/**
 * Record one captured email. Called by the mailer's seam, never by a test.
 *
 * @param {object} Manager - The booted Manager whose project owns the store
 * @param {object} options
 * @param {object[]} options.to - The built email's `to` list (`[{ email, name }]`)
 * @param {string} options.template - The template that rendered it (post legacy-name resolution)
 * @param {string} options.subject - The subject line
 * @param {string} options.html - The rendered body, reduced to `summary`
 * @param {number|null} [options.sendAt] - The scheduled UNIX second, or null for "now"
 * @returns {object} The record as written
 */
function recordCaptured(Manager, { to, template, subject, html, sendAt }) {
  const record = {
    to: (to || []).map((entry) => entry.email).filter(Boolean),
    template: template || null,
    subject: subject || null,
    summary: summarize(html),
    sendAt: sendAt || null,
  };

  let line = JSON.stringify(record);

  // Trim the summary — the only growable field — until the line fits the atomic
  // append bound, measured in the bytes the append actually writes.
  while (Buffer.byteLength(line) > LINE_LIMIT && record.summary.length > 0) {
    const excess = Buffer.byteLength(line) - LINE_LIMIT;

    record.summary = record.summary.slice(0, record.summary.length - Math.max(1, Math.min(record.summary.length, excess)));
    line = JSON.stringify(record);
  }

  // Nothing left to trim and still over: the record is over the bound on its
  // envelope alone (a recipient list long enough to fill it). Appending it anyway
  // would tear a concurrent process's line and lose BOTH records, so this is the
  // point to fail at — loudly, naming the send.
  if (Buffer.byteLength(line) > LINE_LIMIT) {
    throw new Error(`email-capture: record for "${record.subject}" is ${Buffer.byteLength(line)} bytes with nothing left to trim, over the ${LINE_LIMIT}-byte atomic-append bound (${record.to.length} recipients)`);
  }

  jetpack.append(getCaptureFilePath(resolveProjectDir(Manager)), `${line}\n`);

  return record;
}

/**
 * Read every captured email, in the order it was sent.
 *
 * @param {object} Manager - The booted Manager whose project owns the store
 * @returns {object[]} `[{ to, template, subject, summary, sendAt }]` — empty when nothing was captured
 */
function readCaptured(Manager) {
  const filePath = getCaptureFilePath(resolveProjectDir(Manager));
  const contents = jetpack.read(filePath, 'utf8');

  if (!contents) {
    return [];
  }

  return contents
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (e) {
        // A torn line means the atomic-append bound above was breached, which no
        // record can do by construction — so it is a defect here, not bad input.
        throw new Error(`email-capture: unparseable record in ${filePath} — ${e.message}`);
      }
    });
}

/**
 * Delete the capture store. A test clears BEFORE the act it is proving, so the
 * records it reads back are its own.
 *
 * @param {object} Manager - The booted Manager whose project owns the store
 */
function clearCaptured(Manager) {
  jetpack.remove(getCaptureFilePath(resolveProjectDir(Manager)));
}

module.exports = {
  CAPTURE_FILENAME,
  SUMMARY_LIMIT,
  LINE_LIMIT,
  getCaptureFilePath,
  resolveProjectDir,
  isCapturing,
  summarize,
  recordCaptured,
  readCaptured,
  clearCaptured,
};
