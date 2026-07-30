// Runtime logger — the extension's own lineage (service worker, popup, options,
// content scripts). Prints the ONE identity tag, `[@omega.js/extension:<name>]`,
// with NO timestamp: devtools stamps runtime lines already
// ([#12](https://github.com/Omega-JS-Stack/omega/issues/12)). The build-time twin
// (lib/logger.js → @omega.js/devkit/logger) is the one that prefixes [HH:MM:SS].

// Libraries

// The package segment — this file IS @omega.js/extension, so it is a literal.
const PACKAGE = '@omega.js/extension';

// Logger class
function Logger(name) {
  const self = this;

  // Properties
  self.name = name;
}

// Loop through log, error, warn, info, and debug and make methods that log to console with the tag [@omega.js/extension:name] message
// Setup logger
['log', 'error', 'warn', 'info', 'debug'].forEach(method => {
  Logger.prototype[method] = function () {
    const self = this;

    // Add prefix
    const args = [`[${PACKAGE}:${self.name}]`, ...Array.from(arguments)];

    // Call the original console method
    console[method].apply(console, args);
  };
});

// Export
module.exports = Logger;
