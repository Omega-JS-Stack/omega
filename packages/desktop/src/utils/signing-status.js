// signing-status: logs whether a PACKAGED app is code-signed, and by whom, so
// runtime.log answers "did this build ship signed?" without a terminal. Fire and
// forget: the checks run async and only ever log. An unpackaged (dev or test)
// boot has nothing signed to report, so it skips.

/**
 * Log this app's signing status (packaged apps only).
 * @param {object} logger - the main process's logger.
 */
function logSigningStatus(logger) {
  try {
    if (!require('electron').app.isPackaged) {
      return;
    }

    const { execFile } = require('child_process');

    if (process.platform === 'darwin') {
      const appIndex = process.execPath.indexOf('.app');
      if (appIndex === -1) throw new Error('no .app in execPath');
      const appPath = process.execPath.substring(0, appIndex + 4);
      execFile('codesign', ['--verify', '--deep', '--strict', appPath], (err) => {
        if (err) {
          logger.warn(`signing: NOT signed (${err.message.split('\n')[0]})`);
          return;
        }
        execFile('codesign', ['-dv', appPath], { encoding: 'utf8' }, (e2, stdout, stderr) => {
          const authority = (stderr || '').match(/Authority=(.+)/);
          const adhoc = (stderr || '').includes('Signature=adhoc');
          const label = adhoc ? 'ad-hoc' : (authority ? authority[1] : 'unknown');
          logger.log(`signing: signed (${label})`);
        });
      });
    } else if (process.platform === 'win32') {
      execFile('powershell', ['-NoProfile', '-Command', `(Get-AuthenticodeSignature '${process.execPath}').Status`], { encoding: 'utf8' }, (err, stdout) => {
        const status = (stdout || '').trim();
        if (err || status === 'NotSigned') {
          logger.warn('signing: NOT signed');
        } else {
          logger.log(`signing: signed (${status})`);
        }
      });
    } else {
      logger.log('signing: n/a (Linux has no OS-level code signing)');
    }
  } catch (e) {
    logger.warn(`signing: check failed (${e.message})`);
  }
}

module.exports = logSigningStatus;
