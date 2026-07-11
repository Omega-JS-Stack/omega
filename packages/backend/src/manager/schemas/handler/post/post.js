/**
 * Schema for POST /handler/post
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  url: f.string({ default: undefined, required: true }),
  title: f.string({ default: undefined, required: true }),
  invoiceEmail: f.string({ default: undefined }),
  invoicePrice: f.number({ default: undefined }),
  invoiceNote: f.string({ default: '' }),
  sendNotification: f.boolean({ default: true }),
});
