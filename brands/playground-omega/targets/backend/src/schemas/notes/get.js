/**
 * Surface: schema, GET /notes (an optional input with a default)
 * Doc: node_modules/@omega.js/manager/docs/backend/schemas.md
 */
module.exports = () => ({
  limit: { type: 'number', default: 20, min: 1, max: 100 },
});
