// Build-layer tests for lib/restart-manager/install.js — feed parsing, artifact
// picking, URL building, and the advisory install lock. Pure functions + real
// temp-dir filesystem; no network.

const fs = require('fs');
const os = require('os');
const path = require('path');
const install = require('../../../lib/restart-manager/install.js');

// Realistic electron-builder feed fixtures (shapes match what @omegajs/desktop's release
// pipeline publishes to update-server).
const MAC_YML = [
  'version: 1.2.3',
  'files:',
  '  - url: Restart-Manager-1.2.3-universal-mac.zip',
  '    sha512: abc123==',
  '    size: 123456789',
  '  - url: Restart-Manager-1.2.3.dmg',
  '    sha512: def456==',
  '    size: 234567890',
  'path: Restart-Manager-1.2.3-universal-mac.zip',
  "releaseDate: '2026-07-01T00:00:00.000Z'",
].join('\n');

const WIN_YML = [
  'version: 1.2.3',
  'files:',
  '  - url: Restart-Manager-Setup-1.2.3.exe',
  '    sha512: aaa==',
  '  - url: Restart-Manager-1.2.3-win.zip',
  '    sha512: bbb==',
  'path: Restart-Manager-Setup-1.2.3.exe',
].join('\n');

const LINUX_YML = [
  'version: 1.2.3',
  'files:',
  '  - url: Restart-Manager-1.2.3-x64.AppImage',
  '    sha512: ccc==',
  '  - url: restart-manager_1.2.3_amd64.deb',
  '    sha512: ddd==',
].join('\n');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'restart-manager install machinery (build)',
  tests: [
    {
      name: 'parseFeed extracts version + files from all three platform feeds',
      run: (ctx) => {
        const mac = install.parseFeed(MAC_YML);
        ctx.expect(mac.version).toBe('1.2.3');
        ctx.expect(mac.files.length).toBe(2);
        ctx.expect(mac.files[0].url).toBe('Restart-Manager-1.2.3-universal-mac.zip');

        ctx.expect(install.parseFeed(WIN_YML).files.length).toBe(2);
        ctx.expect(install.parseFeed(LINUX_YML).version).toBe('1.2.3');
      },
    },
    {
      name: 'parseFeed rejects garbage and version-less feeds',
      run: (ctx) => {
        ctx.expect(() => install.parseFeed('[]')).toThrow();
        ctx.expect(() => install.parseFeed('files:\n  - url: x.zip')).toThrow();
      },
    },
    {
      name: 'pickArtifact darwin: arch-specific → universal → plain -mac.zip order',
      run: (ctx) => {
        const universalOnly = install.parseFeed(MAC_YML);
        // No arm64 zip in feed → falls through to universal.
        ctx.expect(install.pickArtifact(universalOnly, 'darwin', 'arm64')).toBe('Restart-Manager-1.2.3-universal-mac.zip');

        const archSplit = {
          version: '2.0.0',
          files: [
            { url: 'RM-2.0.0-arm64-mac.zip' },
            { url: 'RM-2.0.0-x64-mac.zip' },
          ],
        };
        ctx.expect(install.pickArtifact(archSplit, 'darwin', 'arm64')).toBe('RM-2.0.0-arm64-mac.zip');
        ctx.expect(install.pickArtifact(archSplit, 'darwin', 'x64')).toBe('RM-2.0.0-x64-mac.zip');

        const plain = { version: '3.0.0', files: [{ url: 'RM-3.0.0-mac.zip' }] };
        ctx.expect(install.pickArtifact(plain, 'darwin', 'arm64')).toBe('RM-3.0.0-mac.zip');
      },
    },
    {
      name: 'pickArtifact win: the NSIS setup exe (run with /S; enables electron-updater self-updates)',
      run: (ctx) => {
        const feed = install.parseFeed(WIN_YML);
        ctx.expect(install.pickArtifact(feed, 'win32', 'x64')).toBe('Restart-Manager-Setup-1.2.3.exe');
      },
    },
    {
      name: 'pickArtifact linux: the AppImage, never the deb',
      run: (ctx) => {
        const feed = install.parseFeed(LINUX_YML);
        ctx.expect(install.pickArtifact(feed, 'linux', 'x64')).toBe('Restart-Manager-1.2.3-x64.AppImage');
      },
    },
    {
      name: 'pickArtifact: no match throws listing the candidates',
      run: (ctx) => {
        const feed = { version: '1.0.0', files: [{ url: 'Something-1.0.0.dmg' }] };
        let threw = null;
        try { install.pickArtifact(feed, 'darwin', 'arm64'); }
        catch (e) { threw = e; }
        ctx.expect(threw).not.toBe(null);
        ctx.expect(threw.message).toContain('Something-1.0.0.dmg');
      },
    },
    {
      name: 'buildFeedUrl: default github form, url override, trailing-slash tolerance',
      run: (ctx) => {
        const github = install.buildFeedUrl({ owner: 'restart-manager', repo: 'update-server' }, 'darwin');
        ctx.expect(github).toBe('https://github.com/restart-manager/update-server/releases/latest/download/latest-mac.yml');

        ctx.expect(install.buildFeedUrl({ owner: 'o', repo: 'r' }, 'win32').endsWith('/latest.yml')).toBe(true);
        ctx.expect(install.buildFeedUrl({ owner: 'o', repo: 'r' }, 'linux').endsWith('/latest-linux.yml')).toBe(true);

        const mirrored = install.buildFeedUrl({ url: 'https://mirror.example.com/rm/' }, 'darwin');
        ctx.expect(mirrored).toBe('https://mirror.example.com/rm/latest-mac.yml');

        ctx.expect(() => install.buildFeedUrl({ owner: 'o', repo: 'r' }, 'freebsd')).toThrow();
      },
    },
    {
      name: 'buildArtifactUrl URL-encodes artifact names (space survives as %20)',
      run: (ctx) => {
        const url = install.buildArtifactUrl({ owner: 'o', repo: 'r' }, 'Weird Name-1.0.0-mac.zip');
        ctx.expect(url).toBe('https://github.com/o/r/releases/latest/download/Weird%20Name-1.0.0-mac.zip');
      },
    },
    {
      name: 'install lock: wx-create, live holder blocks, dead holder is taken over',
      run: (ctx) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'em-rm-lock-'));
        ctx.state.lockRoot = root;

        // Fresh acquire succeeds; a second acquire while OUR live pid holds it fails.
        ctx.expect(install.acquireInstallLock(root, { pid: process.pid, hostAppId: 'a' })).toBe(true);
        ctx.expect(install.acquireInstallLock(root, { pid: process.pid, hostAppId: 'b' })).toBe(false);

        // Dead holder → takeover (999999 is far above any real pid on the runner).
        fs.writeFileSync(path.join(root, 'install.lock'), JSON.stringify({ pid: 999999, hostAppId: 'ghost', acquiredAt: Date.now() }));
        ctx.expect(install.acquireInstallLock(root, { pid: process.pid, hostAppId: 'c' })).toBe(true);

        // Stale timestamp (even with a live pid) → takeover.
        fs.writeFileSync(path.join(root, 'install.lock'), JSON.stringify({ pid: process.pid, hostAppId: 'old', acquiredAt: Date.now() - 11 * 60 * 1000 }));
        ctx.expect(install.acquireInstallLock(root, { pid: process.pid, hostAppId: 'd' })).toBe(true);

        // Release then re-acquire.
        install.releaseInstallLock(root);
        ctx.expect(install.acquireInstallLock(root, { pid: process.pid, hostAppId: 'e' })).toBe(true);
      },
      cleanup: (ctx) => {
        if (ctx.state.lockRoot) fs.rmSync(ctx.state.lockRoot, { recursive: true, force: true });
      },
    },
    {
      name: 'pidAlive: own pid true, absurd pid false, junk false',
      run: (ctx) => {
        ctx.expect(install.pidAlive(process.pid)).toBe(true);
        ctx.expect(install.pidAlive(999999)).toBe(false);
        ctx.expect(install.pidAlive(0)).toBe(false);
        ctx.expect(install.pidAlive('12')).toBe(false);
      },
    },
  ],
};
