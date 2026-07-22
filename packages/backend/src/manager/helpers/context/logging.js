/**
 * RouteContext logging — tagged, level-aware logging for one request.
 *
 * Every level in LOG_LEVELS becomes a ctx method (ctx.log/warn/error/info/debug/
 * notice/critical/emergency). Console in any non-production environment; the
 * Firebase Cloud logger in production for levels console lacks.
 */

const LOG_LEVELS = {
  error: 'error',
  warn: 'warn',
  info: 'info',
  debug: 'debug',
  log: 'log',
  notice: 'NOTICE',
  critical: 'CRITICAL',
  emergency: 'EMERGENCY',
};

const methods = {
  _log() {
    const self = this;
    const logs = [...arguments];
    const prefix = self.logPrefix ? ` ${self.logPrefix}:` : ':';

    // Prepend log prefix log string
    logs.unshift(`[${new Date().toISOString()}] ${self.tag}${prefix}`);

    // Get the log level
    const level = logs[1];

    // Pass along arguments to console.log
    if (LOG_LEVELS[level]) {
      logs.splice(1, 1);

      // Determine how to log. Console for any non-production environment (development OR
      // testing); the Firebase Cloud logger only in production.
      if (level in console) {
        console[level].apply(console, logs);
      } else if (!self.isProduction()) {
        console.log.apply(console, logs);
      } else {
        self.ref.functions.logger.write({
          severity: LOG_LEVELS[level].toUpperCase(),
          message: logs,
        });
      }

      // Write with wonderful-log
      if (self.Manager?.libraries?.logger?.[level]) {
        self.Manager?.libraries?.logger?.[level](...logs);
      }
    } else {
      console.log.apply(console, logs);
    }
  },

  setLogPrefix(s) {
    const self = this;

    self.logPrefix = s;

    return self;
  },

  clearLogPrefix() {
    const self = this;

    self.logPrefix = '';

    return self;
  },

  getLogPrefix() {
    return this.logPrefix;
  },
};

// One method per level, defined ONCE at module load (the legacy constructor
// re-defined these on every instantiation)
Object.keys(LOG_LEVELS).forEach((level) => {
  methods[level] = function () {
    const self = this;
    const args = Array.prototype.slice.call(arguments);

    args.unshift(level);
    self._log.apply(self, args);
  };
});

module.exports = { methods, LOG_LEVELS };
