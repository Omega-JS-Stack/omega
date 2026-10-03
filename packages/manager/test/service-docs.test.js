// Tests for the service-docs parity (#645): every folder under src/services/
// carries a docs/manager/<service>.md, and every service doc names a service
// that exists. Both directions, because either half alone rots — a new service
// with no doc is undocumented, and a doc for a service that was renamed or
// removed is a lie the map keeps linking at.
//
// The docs live in the MONOREPO's docs/manager/ (the SSOT); prepare vendors
// them into the package at publish time, so this reads the source tree.

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const path = require('node:path');

const SERVICES_DIR = path.resolve(__dirname, '..', 'src', 'services');
const DOCS_DIR = path.resolve(__dirname, '..', '..', '..', 'docs', 'manager');

// Docs in docs/manager/ that are not a service's: the map itself, and the two
// guides for the rungs around a brand, and the migration playbook (#149).
// Everything else must name a service.
const NON_SERVICE_DOCS = new Set(['index', 'brand', 'company', 'migration']);

function serviceNames() {
  return fs.readdirSync(SERVICES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function serviceDocNames() {
  return fs.readdirSync(DOCS_DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.slice(0, -3))
    .filter((name) => !NON_SERVICE_DOCS.has(name))
    .sort();
}

module.exports = defineCases({
  type: 'group',
  description: 'service-docs',
  tests: [
    {
      name: 'every service folder has a docs/manager/<service>.md',
      run: (ctx) => {
        const missing = serviceNames().filter((service) => !fs.existsSync(path.join(DOCS_DIR, `${service}.md`)));

        ctx.expect(missing, `services with no doc: ${missing.join(', ')}`).toEqual([]);
      },
    },

    {
      name: 'every service doc names a service that exists',
      run: (ctx) => {
        const services = new Set(serviceNames());
        const orphans = serviceDocNames().filter((doc) => !services.has(doc));

        ctx.expect(orphans, `docs naming no service: ${orphans.join(', ')}`).toEqual([]);
      },
    },
  ],
});
