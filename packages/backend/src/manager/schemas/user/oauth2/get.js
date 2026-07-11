const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = ({ user }) => f.object({
  uid: f.string({ default: user?.auth?.uid, required: false }),
  provider: f.string({ required: true }),
  action: f.string({ default: 'authorize', enum: ['authorize', 'status'], required: false }),
  redirect: f.boolean({ default: true, required: false }),
  removeInvalidTokens: f.boolean({ default: true, required: false }),
});
