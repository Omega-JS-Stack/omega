/**
 * RouteContext logging — tagged, level-aware logging for one request.
 *
 * Every level in LOG_LEVELS becomes a ctx method (ctx.log/warn/error/info/debug/
 * notice/critical/emergency). Console in any non-production environment; the
 * Firebase Cloud logger in production for levels console lacks.
 *
 * Every line opens with the ONE identity tag, `[@omega.js/backend:<module>]`
 * ([#121](https://github.com/Omega-JS-Stack/omega/issues/121)) — the module
 * segment is the invocation's function name, which the ctx already knows. The
 * invocation id and any log prefix follow the tag.
 *
 * In PRODUCTION the tag stands alone: Cloud Logging stamps every entry, so a
 * hand-written time would be a second one. Outside production nothing stamps a
 * plain local run (dist scripts, node CLIs), so the line opens with a short local
 * time bracket instead — `[HH:MM:SS] [@omega.js/backend:<module>] ...`, the same
 * shape the devkit's build-time logger prints
 * ([#130](https://github.com/Omega-JS-Stack/omega/issues/130)).
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

// The ONE identity tag. The module segment is the function name the ctx resolved
// at init (options.functionName || FUNCTION_TARGET || 'manager').
function identityTag(ctx) {
  return `[@omega.js/backend:${ctx.meta?.name || 'unnamed'}]`;
}

// The local time bracket that opens a line outside production, or '' in production
// where Cloud Logging stamps the entry. The emulator is NOT carved out: its `>`
// functions prefix carries no time (verified against live emulator output), so
// emulator lines want the stamp like any other local run. This is the ONE place ctx
// console output is built (wonderful-log writes to file only), so stamping here
// covers every level.
function localTimestamp(ctx) {
  if (ctx.isProduction()) {
    return '';
  }

  const time = new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return `[${time}] `;
}

const methods = {
  _log() {
    const self = this;
    const logs = [...arguments];
    const prefix = self.logPrefix ? ` ${self.logPrefix}:` : ':';

    // Prepend the local time bracket (outside production only), the identity tag,
    // the invocation id, and the log prefix
    logs.unshift(`${localTimestamp(self)}${identityTag(self)} ${self.id}${prefix}`);

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
