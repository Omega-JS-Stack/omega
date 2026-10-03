/**
 * The Firestore stand-in for the connections route cases: documents answered
 * per PATH, every write RECORDED, the transaction a refresh lease and a
 * tokenize run in, and the `where` query tokenize's uniqueness check runs.
 * With `apply: true` every write also LANDS (merge, update-at-path, delete
 * sentinels) and a query reads the documents, so a case asserts the stored
 * result whatever write form the route used.
 * (Underscore-prefixed: the runner skips _ files in discovery.)
 */

const isDelete = (value) => !!value && typeof value === 'object' && value.methodName === 'FieldValue.delete';
const isPlainObject = (value) => !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

/** A field path as segments: a dotted string, or a FieldPath. */
function segmentsOf(field) {
  if (typeof field === 'string') {
    return field.split('.');
  }

  if (field && Array.isArray(field.segments)) {
    return [...field.segments];
  }

  throw new Error(`The stand-in cannot read this field path: ${String(field)}`);
}

/** An `update(object)` or `update(field, value, ...)` call as `[segments, value]` pairs. */
function updatePairs([first, ...rest]) {
  if (isPlainObject(first)) {
    return Object.entries(first).map(([field, value]) => [segmentsOf(field), value]);
  }

  const flat = [first, ...rest];

  return Array.from({ length: Math.floor(flat.length / 2) }, (_, i) => [segmentsOf(flat[i * 2]), flat[i * 2 + 1]]);
}

/**
 * An update call as the nested payload a set would carry, so a case reads one
 * shape whichever form the route used. An object argument is kept as passed.
 *
 * @param {Array} args - The update call's arguments
 * @returns {object} The payload
 */
function updatePayload(args) {
  if (isPlainObject(args[0])) {
    return args[0];
  }

  const payload = {};

  for (const [segments, value] of updatePairs(args)) {
    const leaf = segments.pop();

    segments.reduce((node, segment) => (node[segment] ??= {}), payload)[leaf] = value;
  }

  return payload;
}

const copy = (value) => (value === undefined ? undefined : structuredClone(value));

/** A merge write: plain objects merge key by key, a delete sentinel removes. */
function mergeInto(target, payload) {
  for (const [key, value] of Object.entries(payload)) {
    if (isDelete(value)) {
      delete target[key];
    } else if (isPlainObject(value)) {
      if (!isPlainObject(target[key])) {
        target[key] = {};
      }

      mergeInto(target[key], value);
    } else {
      target[key] = copy(value);
    }
  }
}

/** An update at one path: the value REPLACES what sat there. */
function writePath(data, segments, value) {
  const leaf = segments[segments.length - 1];
  let node = data;

  for (const segment of segments.slice(0, -1)) {
    if (!isPlainObject(node[segment])) {
      if (isDelete(value)) {
        return;
      }

      node[segment] = {};
    }

    node = node[segment];
  }

  if (isDelete(value)) {
    delete node[leaf];
  } else if (isPlainObject(value)) {
    node[leaf] = {};
    mergeInto(node[leaf], value);
  } else {
    node[leaf] = copy(value);
  }
}

function readPath(data, segments) {
  return segments.reduce((node, segment) => (node && typeof node === 'object' ? node[segment] : undefined), data);
}

/**
 * @param {object} [options]
 * @param {object} [options.docs] - Document data by path (copied first when `apply`)
 * @param {object[]} [options.matches] - What every `where` query answers, when not `apply`
 * @param {boolean} [options.apply] - Land every write and answer queries from the documents
 * @returns {{ admin: object, writes: object[], queries: object[], read: Function }}
 *   `writes` holds `{ verb, path, payload }`, the verb one of `set`, `update`,
 *   `transaction.set`, `transaction.update`; `read(path)` is a copy of a document
 */
function recordingFirestore({ docs: seed = {}, matches = [], apply = false } = {}) {
  const docs = apply ? structuredClone(seed) : seed;
  const writes = [];
  const queries = [];

  const snapshot = (docPath) => ({
    id: docPath.split('/').pop(),
    exists: !!docs[docPath],
    data: () => (apply ? copy(docs[docPath]) : docs[docPath]),
  });

  const set = (verb, docPath, payload, options) => {
    writes.push({ verb, path: docPath, payload });

    if (!apply) {
      return;
    }

    if (!(options && options.merge) || !docs[docPath]) {
      docs[docPath] = options && options.merge ? (docs[docPath] || {}) : {};
    }

    mergeInto(docs[docPath], payload);
  };

  const update = (verb, docPath, args) => {
    if (apply && !docs[docPath]) {
      throw new Error(`NOT_FOUND: no document to update at ${docPath}`);
    }

    writes.push({ verb, path: docPath, payload: updatePayload(args) });

    if (apply) {
      updatePairs(args).forEach(([segments, value]) => writePath(docs[docPath], segments, value));
    }
  };

  const query = (collection, field, value) => ({
    limit: () => query(collection, field, value),
    get: async () => {
      const found = !apply ? matches : Object.keys(docs)
        .filter((docPath) => docPath.startsWith(`${collection}/`))
        .filter((docPath) => readPath(docs[docPath], segmentsOf(field)) === value)
        .map(snapshot);

      return { docs: found, size: found.length, empty: found.length === 0 };
    },
  });

  const firestore = {
    doc: (docPath) => ({
      path: docPath,
      id: docPath.split('/').pop(),
      get: async () => snapshot(docPath),
      set: async (payload, options) => set('set', docPath, payload, options),
      update: async (...args) => update('update', docPath, args),
    }),
    runTransaction: async (fn) => fn({
      get: async (ref) => snapshot(ref.path),
      set: (ref, payload, options) => set('transaction.set', ref.path, payload, options),
      update: (ref, ...args) => update('transaction.update', ref.path, args),
    }),
    collection: (name) => ({
      where: (field, operator, value) => {
        if (apply && operator !== '==') {
          throw new Error(`The stand-in answers only ==, not ${operator}`);
        }

        queries.push({ collection: name, field, operator, value });

        return query(name, field, value);
      },
    }),
  };

  return {
    admin: { firestore: () => firestore },
    writes,
    queries,
    read: (docPath) => copy(docs[docPath]),
  };
}

module.exports = { recordingFirestore, updatePayload };
