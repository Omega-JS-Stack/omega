// The notarization TOOLS: submit, staple, and PROVE, in one place
// ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)).
//
// Proof run one shipped an unsigned, unnotarized mac app on a green build
// because every rung assumed instead of checking. These three do the opposite:
// each one reads the tool's own report and throws unless it says the words that
// mean success. A hook that returns without throwing has PROVED its artifact is
// notarized, stapled, and accepted by Gatekeeper.
//
// Both hooks (afterSign for the .app, artifactBuildCompleted for each .dmg) run
// every command through the `run` seam a test replaces with a fake `xcrun` /
// `spctl`; nothing here is global state.

const { spawn } = require('child_process');

// What Gatekeeper is asked about each artifact: an app is EXECUTED, a disk
// image is OPENED, and a DMG's verdict must come from its own signature rather
// than from a quarantine-less filesystem (`--context context:primary-signature`).
const ASSESS_FLAGS = {
  app: '--type execute',
  dmg: '--type open --context context:primary-signature',
};

/**
 * The default command runner: stdout + stderr of a shell command, in the order
 * they arrived, WHATEVER the exit code. These tools write their verdict to the
 * console and exit non-zero when they refuse, so the failure text is the
 * answer, never an exception to lose (a runner that rejects on exit code
 * threw the verdict away with it).
 *
 * @returns {function(string): Promise<string>}
 */
function toolRunner() {
  return (command) => new Promise((resolve) => {
    const child = spawn(command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    child.on('close', () => resolve(output));
  });
}

/**
 * Run a command and hand back its REPORT. A runner that throws (a test's fake)
 * reports its message.
 *
 * @param {function} run - The command runner.
 * @param {string} command - The command.
 * @returns {Promise<string>}
 */
async function report(run, command) {
  try {
    return String(await run(command) || '');
  } catch (e) {
    return String(e.message || '');
  }
}

/**
 * Run a command and require its report to SAY it worked.
 *
 * @param {object} input
 * @param {function} input.run - The command runner.
 * @param {string} input.command - The command.
 * @param {RegExp} input.expect - What success reads like in the tool's report.
 * @param {string} input.what - What failed, for the thrown message.
 * @returns {Promise<string>} The report.
 * @throws {Error} When the report does not say it worked.
 */
async function demand(input) {
  const { run, command, expect, what } = input;
  const output = await report(run, command);

  if (!expect.test(output)) {
    throw new Error(`[notarize] ${what}: ${output.trim() || 'no output'}`);
  }

  return output;
}

/**
 * Submit an artifact to Apple and wait for the verdict. Used for the DMG (the
 * .app rides @electron/notarize's own submit inside the afterSign hook).
 *
 * @param {object} input
 * @param {string} input.filePath - The artifact.
 * @param {object} input.credentials - `{ apiKeyPath, apiKeyId, apiIssuer }`.
 * @param {function} [input.run] - Command runner (test seam).
 * @returns {Promise<string>} notarytool's report.
 */
function submit({ filePath, credentials, run = toolRunner() }) {
  const { apiKeyPath, apiKeyId, apiIssuer } = credentials;

  return demand({
    run,
    command: `xcrun notarytool submit "${filePath}" --key "${apiKeyPath}" --key-id "${apiKeyId}" --issuer "${apiIssuer}" --wait`,
    expect: /status:\s*Accepted/i,
    what: `notarization of ${filePath} was not accepted`,
  });
}

/**
 * Staple the notarization ticket to an artifact and PROVE it took: the staple
 * itself, the stapler's own re-read, and Gatekeeper's assessment. A user's Mac
 * checks exactly this, offline, before it will open the thing.
 *
 * @param {object} input
 * @param {string} input.filePath - The .app or .dmg.
 * @param {'app'|'dmg'} input.kind - Which assessment Gatekeeper is asked for.
 * @param {function} [input.run] - Command runner (test seam).
 * @returns {Promise<void>}
 * @throws {Error} When stapling, validation or the assessment fails.
 */
async function stapleAndProve({ filePath, kind, run = toolRunner() }) {
  await demand({
    run,
    command: `xcrun stapler staple "${filePath}"`,
    expect: /The staple and validate action worked!/i,
    what: `could not staple the notarization ticket to ${filePath}`,
  });

  await demand({
    run,
    command: `xcrun stapler validate "${filePath}"`,
    expect: /The validate action worked!/i,
    what: `${filePath} carries no valid notarization ticket after stapling`,
  });

  await demand({
    run,
    command: `spctl --assess ${ASSESS_FLAGS[kind]} -vv "${filePath}"`,
    expect: /: accepted/i,
    what: `Gatekeeper refused ${filePath}`,
  });
}

module.exports = { submit, stapleAndProve, toolRunner, report, ASSESS_FLAGS };
