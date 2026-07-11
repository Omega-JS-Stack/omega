const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = ({ user }) => f.object({
  uid: f.string({ default: user?.auth?.uid, required: false }),
  provider: f.string({ required: true }),
});
