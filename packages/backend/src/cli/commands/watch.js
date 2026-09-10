const BaseCommand = require('./base-command');
const path = require('path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const { commandOnPath } = require('@omega.js/devkit/command-path');
const { spawnOnPath } = require('../utils/spawn-shell');

/**
 * A path as a JS string literal, safe inside the `node -e "…"` script below.
 *
 * `JSON.stringify` does the escaping — a Windows path is full of backslashes, and
 * hand-written quotes turned `C:\\dist\\trigger.js` into `C:distrigger.js` the
 * moment node parsed it. Its DOUBLE quotes then get swapped for single ones,
 * because the literal lives inside the shell's own `"…"` wrapper and a double
 * quote there would close the script early.
 *
 * @param {string} value - The path
 * @returns {string} A single-quoted JS string literal
 */
function jsPath(value) {
  return `'${JSON.stringify(value).slice(1, -1).replace(/'/g, "\\'")}'`;
}

/**
 * The nodemon `--exec` line BOTH watch lanes run when a framework source file changes.
 *
 * Firebase only reloads on a CONTENT change — not a create, not a bare mtime bump —
 * so the trigger file is REWRITTEN, never `touch`ed (which was the wrong semantics
 * here as well as a Unix binary the host shell may not have). It is a `node -e`
 * one-liner because nodemon hands the exec to whatever shell the host has, and node
 * is the one interpreter every host running this is guaranteed to own.
 *
 * Three steps, in order: 1) ensure the file exists, 2) let the FS settle, 3) write new
 * content. The settle wait is an in-process `Atomics.wait` — a `setTimeout` would not
 * block the write that has to follow it, and `sleep` is a Unix binary.
 *
 * The <log>.reset sentinels ride along so a parent serve/emulator command rolls its log
 * file cleanly on every hot reload (mirrors the emulator log-roll pattern the test
 * runner uses). Best-effort: with no parent watching, the file is harmless and the next
 * boot's stale-sentinel sweep clears it.
 *
 * @param {object} options
 * @param {string} options.triggerFile - The file Firebase watches for content changes
 * @param {string[]} options.resetPaths - <log>.reset sentinels to drop alongside it
 * @param {string} options.message - What this lane prints once the trigger is written
 * @returns {string} The shell line for nodemon's --exec
 */
function reloadTriggerExec({ triggerFile, resetPaths, message }) {
  const sentinels = resetPaths.map((resetPath) => `try{fs.writeFileSync(${jsPath(resetPath)},'');}catch(e){}`).join('');
  const script = `var f=${jsPath(triggerFile)},fs=require('fs');`
    + `if(!fs.existsSync(f)){fs.writeFileSync(f,'// init');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);}`
    + `fs.writeFileSync(f,'// '+Date.now());`
    + sentinels;

  return `node -e "${script}" && echo "${message}"`;
}

class WatchCommand extends BaseCommand {
  /**
   * Get watch configuration (shared between execute and startBackground)
   */
  getConfig() {
    const projectDir = this.main.firebaseProjectPath;
    const functionsDir = path.join(projectDir, 'dist');
    const bemDir = path.resolve(__dirname, '..', '..', '..');
    const bemSrcDir = path.join(bemDir, 'src');
    const triggerFile = path.join(functionsDir, 'omega-reload-trigger.js');

    return { projectDir, functionsDir, bemDir, bemSrcDir, triggerFile };
  }

  /**
   * Is nodemon installed? An EXISTENCE check only — what the probe resolved is
   * never what gets spawned (see spawnOnPath).
   *
   * @returns {boolean}
   */
  hasNodemon() {
    return !!commandOnPath('nodemon');
  }

  /**
   * Start watcher in background (called from other commands)
   */
  startBackground() {
    const config = this.getConfig();

    if (!this.hasNodemon()) {
      this.log(chalk.gray('  (@omega.js/backend watch disabled - install nodemon globally to enable)\n'));
      return null;
    }

    // Registry installs ship dist/ only — the framework hot-reload watch is a
    // linked-framework dev convenience, meaningless without src/
    if (!jetpack.exists(config.bemSrcDir)) {
      this.log(chalk.gray('  (@omega.js/backend framework watch skipped — no src/ in a registry install)\n'));
      return null;
    }

    this.log(chalk.gray(`  @omega.js/backend watch: ${config.bemSrcDir}\n`));

    // Create trigger file if it doesn't exist
    if (!jetpack.exists(config.triggerFile)) {
      jetpack.write(config.triggerFile, `// @omega.js/backend reload trigger\n`);
    }

    // Use nodemon to watch the @omega.js/backend src directory and rewrite the trigger
    // file on changes (reloadTriggerExec owns what that line does and why).
    // --on-change-only: only run exec when files change, not on initial startup
    // --delay 1: debounce multiple rapid changes into one trigger
    const devLogResetPath = this.getTempPath('dev.log.reset');
    const emulatorLogResetPath = this.getTempPath('emulator.log.reset');
    const nodemon = spawnOnPath('nodemon', [
      '--on-change-only',
      '--delay', '1',
      '--watch', config.bemSrcDir,
      '--ext', 'js,json',
      '--exec', reloadTriggerExec({
        triggerFile: config.triggerFile,
        resetPaths: [devLogResetPath, emulatorLogResetPath],
        message: '  [@omega.js/backend] Triggered hot reload',
      }),
    ], {
      stdio: 'inherit',
      detached: false,
      cwd: config.bemDir,
    });

    return nodemon;
  }

  /**
   * Interactive execute (bem watch)
   */
  async execute() {
    const config = this.getConfig();

    if (!this.hasNodemon()) {
      this.logWarning('\n  Warning: nodemon is not installed globally.');
      this.log(chalk.gray('  Install it with: npm install -g nodemon\n'));
      return;
    }

    // Same registry-install guard as the background lane
    if (!jetpack.exists(config.bemSrcDir)) {
      this.log(chalk.gray('\n  (@omega.js/backend framework watch skipped — no src/ in a registry install)\n'));
      return;
    }

    this.log(chalk.cyan('\n  @omega.js/backend Watch Mode\n'));
    this.log(chalk.gray(`  Watching: ${config.bemSrcDir}`));
    this.log(chalk.gray(`  Trigger:  ${config.triggerFile}\n`));
    this.log(chalk.gray('  When @omega.js/backend source files change, this will trigger Firebase emulator hot reload.'));
    this.log(chalk.gray('  Press Ctrl+C to stop watching.\n'));

    // Create trigger file if it doesn't exist
    if (!jetpack.exists(config.triggerFile)) {
      jetpack.write(config.triggerFile, `// @omega.js/backend reload trigger\n`);
    }

    // The same trigger rewrite the background lane runs, with this lane's own line.
    const devLogResetPath = this.getTempPath('dev.log.reset');
    const emulatorLogResetPath = this.getTempPath('emulator.log.reset');
    const nodemon = spawnOnPath('nodemon', [
      '--watch', config.bemSrcDir,
      '--ext', 'js,json',
      '--exec', reloadTriggerExec({
        triggerFile: config.triggerFile,
        resetPaths: [devLogResetPath, emulatorLogResetPath],
        message: '  → Triggered hot reload',
      }),
    ], {
      stdio: 'inherit',
      cwd: config.bemDir,
    });

    nodemon.on('error', (error) => {
      this.logError(`  Nodemon error: ${error.message}`);
    });

    nodemon.on('close', (code) => {
      if (code !== 0 && code !== null) {
        this.logError(`  Nodemon exited with code ${code}`);
      }
    });

    // Keep the process running
    await new Promise(() => {});
  }
}

// Static, alongside EmulatorCommand's precedent — the exec line is pure, so a
// test builds it for a Windows path without a watcher or a nodemon.
WatchCommand.reloadTriggerExec = reloadTriggerExec;

module.exports = WatchCommand;
