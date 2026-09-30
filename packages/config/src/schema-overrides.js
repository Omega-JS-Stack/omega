/**
 * Per-target rules for what a brand hands a framework verbatim: the desktop
 * install knobs electron-builder takes, and the documented override blocks
 * whose shape belongs to someone else (electron-builder, Electron, the MCP
 * client), where a rule types the block and never the keys inside it.
 */

// A platform's install knobs beside its `formats`, handed to electron-builder
const knob = (path, type, description) => ({ path: `platforms.${path}`, type, required: false, description });

const DESKTOP = [
  knob('mac.arch', 'array|string', 'The mac architectures built (`universal`, `x64`, `arm64`).'),
  knob('mac.entitlements', 'object|string', 'The mac hardened-runtime entitlements (a map, or a plist path).'),
  knob('mac.mas.enabled', 'boolean', 'Mac App Store distribution: reserved, not implemented yet (the audit warns when true).'),
  knob('mac.mas.provisioningProfile', 'string', 'The Mac App Store provisioning profile path (reserved).'),
  knob('mac.mas.entitlements', 'string', 'The Mac App Store entitlements plist (reserved).'),
  knob('mac.mas.entitlementsInherit', 'string', 'The Mac App Store inherited entitlements plist (reserved).'),
  knob('windows.arch', 'array|string', 'The Windows architectures built (`x64`, `ia32`, `arm64`).'),
  knob('windows.oneClick', 'boolean', 'NSIS one-click install (no wizard).'),
  knob('windows.desktopShortcut', 'boolean', 'NSIS creates a desktop shortcut.'),
  knob('windows.startMenuShortcut', 'boolean', 'NSIS creates a Start-menu shortcut.'),
  knob('windows.runAfterFinish', 'boolean', 'NSIS launches the app when the install finishes.'),
  knob('windows.perMachine', 'boolean', 'NSIS installs for every user rather than the current one.'),
  knob('windows.signing.cloud', 'object', 'The cloud signing provider and its options, for the `cloud` signing strategy.'),
  knob('linux.arch', 'array|string', 'The Linux architectures built (`x64`, `arm64`).'),
  {
    path:        'electronBuilder',
    type:        'object',
    required:    false,
    description: "Merged over the generated electron-builder config as the LAST layer (build-config.js), for the rare knob the framework defaults do not cover. Any electron-builder key.",
  },
  {
    path:        'fileAssociations',
    type:        'array',
    required:    false,
    description: "The file types the packaged app registers for ([{ ext, name, role, icon }]), handed to electron-builder's fileAssociations as written.",
  },
  {
    path:        'protocols',
    type:        'array',
    required:    false,
    description: "The URL schemes the packaged app registers for ([{ name, schemes }]), handed to electron-builder's protocols as written.",
  },
  {
    path:        'windows',
    type:        'object',
    required:    false,
    description: 'Per-window BrowserWindow options keyed by window name (`windows.main.width`); the window manager merges each over its own defaults, and a call-site override still wins.',
  },
  {
    path:        'cdp',
    type:        'object',
    required:    false,
    description: 'The desktop cdp command\'s settings. `cdp.readySignal` is the URL substring of the view whose load marks boot complete, for an app that finishes after its first paint.',
  },
];

const BACKEND = [
  {
    path:        'mcp.authUrl',
    type:        'string',
    required:    false,
    match:       /^https?:\/\//,
    description: "Overrides the consumer auth URL the backend's MCP OAuth flow sends a client to; unset derives `<website url>/token` (docs/backend/mcp.md).",
  },
];

module.exports = { OVERRIDE_RULES: { desktop: DESKTOP, backend: BACKEND } };
