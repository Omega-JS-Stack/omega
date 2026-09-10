const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = ({ user }) => f.object({
  uid: f.string({ default: user?.auth?.uid, required: false }),
  limit: f.number({ default: 25, required: false, min: 1, max: 100 }),
});
