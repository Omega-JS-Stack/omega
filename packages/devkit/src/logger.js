// Build-time logger — timestamped, name-scoped console output for CLI commands, gulp
// tasks, and test runners. `new Logger('setup')` then logger.log/error/warn/info.
//
// NOT for app/runtime logging — frameworks with runtime logging needs (e.g. desktop's
// Electron file-transport logger-lite) keep their own.

// Libraries
const chalk = require('chalk').default;

// Logger class
function Logger(name) {
  const self = this;
  self.name = name;
}

// Make methods that log to console with the name and time: [xx:xx:xx] 'name': message
['log', 'error', 'warn', 'info'].forEach((method) => {
  Logger.prototype[method] = function () {
    const time = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour:   '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    let color;
    switch (method) {
      case 'warn':
        color = chalk.yellow;
        break;
      case 'error':
        color = chalk.red;
        break;
      default:
        color = (text) => text;
    }

    const args = [`[${chalk.magenta(time)}] '${chalk.cyan(this.name)}':`, ...Array.from(arguments).map((arg) => {
      if (typeof arg === 'string') {
        return color(arg);
      }
      if (arg instanceof Error) {
        return color(arg.stack);
      }
      return arg;
    })];

    console[method].apply(console, args);
  };
});

// Export chalk as format
Logger.prototype.format = chalk;

module.exports = Logger;
