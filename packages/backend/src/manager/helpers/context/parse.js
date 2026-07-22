/**
 * RouteContext request parsing — tolerant JSON5 body/query parsing, request-URL
 * reconstruction, and multipart/form-data uploads (busboy).
 */

const path = require('path');

let JSON5;

// Tolerant parse: JSON5 when it parses, the raw input otherwise
function tryParse(input) {
  JSON5 = JSON5 || require('json5');

  try {
    return JSON5.parse(input);
  } catch (e) {
    return input;
  }
}

// Reconstruct the request's public URL. "req.originalUrl" does NOT carry the
// path in all cases (like when calling https://us-central1-{id}.cloudfunctions.net/fn)
function tryUrl(self) {
  const req = self.ref.req;
  const Manager = self.Manager;
  const projectType = Manager?.options?.projectType;

  try {
    const protocol = req.protocol;
    const host = req.get('host');
    const forwardedHost = req.get('x-forwarded-host');
    const reqPath = req.path;
    const functionsUrl = Manager.getFunctionsUrl();

    if (projectType === 'firebase') {
      // Non-production (development OR testing) reconstructs the URL from the local
      // functions URL; production uses the request host.
      if (!self.isProduction()) {
        return forwardedHost
          ? `${protocol}://${forwardedHost}${reqPath}`
          : `${functionsUrl}/${self.meta.name}`;
      } else {
        return forwardedHost
          ? `${protocol}://${forwardedHost}${reqPath}`
          : `${protocol}://${host}/${self.meta.name}`;
      }
    } else if (projectType === 'custom') {
      return `${protocol}://${host}${reqPath}`;
    }

    return '';
  } catch (e) {
    return '';
  }
}

const methods = {
  /**
   * Parses a 'multipart/form-data' upload request
   * https://cloud.google.com/functions/docs/writing/http#multipart_data
   */
  parseMultipartFormData(options) {
    const self = this;
    return new Promise(function (resolve, reject) {
      if (!self.initialized) {
        return reject(new Error('Cannot run .parseMultipartFormData() until .init() has been called'));
      }
      const existingData = self.request.multipartData;
      const getFields = existingData?.fields || {};
      const getFiles = existingData?.files || {};

      // If there are already fields or files, return them
      if (Object.keys(getFields).length + Object.keys(getFiles).length > 0) {
        return resolve(existingData);
      }

      // Set options
      options = options || {};

      // Set headers
      const fs = require('fs');
      const req = self.ref.req;

      // Node.js doesn't have a built-in multipart/form-data parsing library.
      // Instead, we can use the 'busboy' library from NPM to parse these requests.
      const busboy = require('busboy');
      const jetpack = require('fs-jetpack');

      options.headers = options.headers || req.headers;
      options.limits = options.limits || {};

      // https://github.com/mscdex/busboy
      const bb = busboy({
        headers: options.headers,
        limits: options.limits,
      });

      // This object will accumulate all the fields, keyed by their name
      const fields = {};

      // This object will accumulate all the uploaded files, keyed by their name.
      const uploads = {};

      // This code will process each non-file field in the form.
      bb.on('field', (fieldname, val) => {
        fields[fieldname] = val;
      });

      const fileWrites = [];

      // This code will process each file uploaded.
      bb.on('file', (fieldname, file, info) => {
        // Note: os.tmpdir() points to an in-memory file system on GCF
        // Thus, any files in it must fit in the instance's memory.
        jetpack.dir(self.tmpdir);

        const filename = info.filename;
        const filepath = path.join(self.tmpdir, filename);
        uploads[fieldname] = filepath;
        const writeStream = fs.createWriteStream(filepath);
        file.pipe(writeStream);

        // File was processed by Busboy; wait for it to be written.
        // Note: GCF may not persist saved files across invocations.
        // Persistent files must be kept in other locations
        // (such as Cloud Storage buckets).
        const promise = new Promise((resolve, reject) => {
          file.on('end', () => {
            writeStream.end();
          });
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
        });
        fileWrites.push(promise);
      });

      // Triggered once all uploaded files are processed by Busboy.
      // We still need to wait for the disk writes (saves) to complete.
      bb.on('finish', async () => {
        await Promise.all(fileWrites);

        self.request.multipartData = {
          fields: fields,
          files: uploads,
        };

        return resolve(self.request.multipartData);
      });

      // rawBody is present on GCF/Firebase requests; piping covers custom servers
      if (req.rawBody) {
        return bb.end(req.rawBody);
      } else {
        return req.pipe(bb);
      }
    });
  },
};

module.exports = { methods, tryParse, tryUrl };
