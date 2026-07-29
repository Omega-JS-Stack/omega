/**
 * Settings
 *
 */
// const jetpack = require('fs-jetpack');
const path = require('path');
const _ = require('lodash');
const moment = require('moment');
const { isZodSchema, resolveZodSchema, buildSchemaMap } = require('./schema-zod.js');
const { iterateSchema, resolveSchema, enforceEnums } = require('./schema-engine.js');


function Settings(m) {
  const self = this;

  self.Manager = m;

  self.settings = null;
}

Settings.prototype.resolve = function (ctx, schema, settings, options) {
  const self = this;

  // Shortcuts
  const Manager = self.Manager;

  // Set settings
  schema = schema || undefined;
  settings = settings || {};

  // Set options
  options = options || {};
  options.dir = typeof options.dir === 'undefined' ? `${Manager.cwd}/schemas` : options.dir;
  options.schema = typeof options.schema === 'undefined' ? undefined : options.schema;
  options.user = options.user || ctx.request.user;
  options.checkRequired = typeof options.checkRequired === 'undefined' ? true : options.checkRequired;

  // Load schema if not provided and schema is defined in options
  // console.log('----schema:', schema);
  // console.log('----settings:', settings);
  // console.log('----options.dir:', options.dir);
  // console.log('----options.schema:', options.schema);
  if (
    typeof schema === 'undefined'
    && typeof options.schema !== 'undefined'
  ) {
    // Try to load method-specific schema first, then fallback to main schema
    const method = (ctx?.request?.method || '').toLowerCase();
    const methodFile = `${method}.js`;
    const schemaFile = options.schema.replace('.js', '');

    const methodSchemaPath = path.resolve(options.dir, `${schemaFile}/${methodFile}`);
    const indexSchemaPath = path.resolve(options.dir, `${schemaFile}/index.js`);

    // Helper: only fall back when THIS specific file is missing.
    // If the file exists but throws (syntax error, runtime error, a broken
    // require of its own) we re-throw so the real problem surfaces instead of
    // being masked by a misleading fallback.
    // The decision is STRUCTURAL, not textual: err.requireStack[0] is the
    // module that ISSUED the failing require. THIS file issues it only when
    // the schema file itself cannot be resolved; once the schema file loads,
    // any resolution failure inside it is issued by the schema file (or one
    // of its own dependencies) and must surface. A message match cannot tell
    // these apart — Node's "Require stack:" names the schema file in both.
    const isMissingModule = (err) => err
      && err.code === 'MODULE_NOT_FOUND'
      && Array.isArray(err.requireStack)
      && err.requireStack[0] === __filename;

    try {
      schema = loadSchema(ctx, methodSchemaPath);
      ctx.log(`Settings.resolve(): Loaded method-specific schema: ${schemaFile}/${methodFile}`);
    } catch (methodErr) {
      if (!isMissingModule(methodErr)) {
        throw methodErr;
      }

      try {
        schema = loadSchema(ctx, indexSchemaPath);
        ctx.log(`Settings.resolve(): Method-specific schema not found, using main schema fallback`);
      } catch (indexErr) {
        if (!isMissingModule(indexErr)) {
          throw indexErr;
        }
        throw ctx.report(
          `No schema for ${method.toUpperCase()} request: expected ${schemaFile}/${methodFile} or ${schemaFile}/index.js`,
          {code: 500},
        );
      }
    }
  }

  // If schema is not an object, throw an error
  if (!schema || typeof schema !== 'object') {
    throw ctx.report(`Invalid schema provided`, {code: 400});
  }

  // Zod branch: a schema module may export a zod schema (fields builders for
  // powertools-parity semantics, raw zod for zod-native) — see helpers/schema-zod.js
  if (isZodSchema(schema)) {
    self.settings = resolveZodSchema(ctx, schema, settings, options);
    self.schema = buildSchemaMap(schema);

    return self.settings;
  }

  // Declarative engine (shared pipeline in helpers/schema-engine.js)
  const resolvedSchema = {};
  const enumPaths = [];

  // Required walk — BEFORE resolution, against the RAW input, so defaults never mask
  // a missing required key. A key counts as missing when undefined or ''
  // (null/0/false pass). Also builds the per-field map the middleware sanitize
  // pass reads.
  iterateSchema(schema, (path, schemaNode) => {
    const originalValue = _.get(settings, path);

    // Check if this node is marked as required
    let isRequired = false;
    if (typeof schemaNode.required === 'function') {
      isRequired = schemaNode.required(ctx, settings, options);
    } else if (typeof schemaNode.required === 'boolean') {
      isRequired = schemaNode.required;
    }

    // If the key is required and the original value is missing, throw an error
    if (options.checkRequired && isRequired && (typeof originalValue === 'undefined' || originalValue === '')) {
      throw ctx.report(`Required key {${path}} is missing in settings`, {code: 400});
    }

    const resolvedNode = {
      types: schemaNode.types || [],
      required: isRequired,
      available: typeof schemaNode.available === 'undefined' ? true : schemaNode.available,
      min: typeof schemaNode.min === 'undefined' ? undefined : schemaNode.min,
      max: typeof schemaNode.max === 'undefined' ? undefined : schemaNode.max,
      sanitize: typeof schemaNode.sanitize === 'undefined' ? true : schemaNode.sanitize,
    }

    // Collect enum-carrying fields for post-resolution enforcement
    if (Array.isArray(schemaNode.enum)) {
      enumPaths.push({ path: path, allowed: schemaNode.enum });
    }

    // Update schema
    _.set(resolvedSchema, path, resolvedNode);
  });

  // Resolve settings (defaults, coercion, min/max, forced value, clean — per leaf)
  self.settings = resolveSchema(settings, schema);

  // Enforce enums (sent values checked post-coercion; absent fields pass)
  enforceEnums(ctx, settings, self.settings, enumPaths);

  // Set schema
  self.schema = resolvedSchema;

  // Resolve
  return self.settings;
};

Settings.prototype.constant = function (name, options) {
  const self = this;
  const Manager = self.Manager;

  options = options || {};
  options.date = typeof options.date === 'undefined' ? moment() : moment(options.date);

  if (name === 'timestamp') {
    return {
      types: ['string'],
      value: undefined,
      default: options.date.toISOString(),
    }
  } else if (name === 'timestampUNIX') {
    return {
      types: ['number'],
      value: undefined,
      default: options.date.unix(),
    }
  } else if (name === 'timestampFULL') {
    return {
      timestamp: self.constant('timestamp', options),
      timestampUNIX: self.constant('timestampUNIX', options),
    }
  }
};

function loadSchema(ctx, schemaPath) {
  // Build context object with everything the schema might need
  const context = {
    ctx: ctx,
    user: ctx.getUser(),
    data: ctx.request.data,
    method: ctx.request.method,
    headers: ctx.request.headers,
    geolocation: ctx.request.geolocation,
    client: ctx.request.client,
  };

  // Load schema - the schema function returns a flat object directly
  // Plan-based adjustments are handled inside the schema function itself
  return require(schemaPath)(context);
}

module.exports = Settings;
