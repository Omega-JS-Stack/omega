/**
 * Schema for PUT /admin/post (edit)
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  url: f.string({ default: undefined, required: true }),
  body: f.string({ default: undefined, required: true }),
  title: f.string({ default: undefined }),
  postPath: f.string({ default: 'guest' }),
  // D13: content-publish implies deploy — false opts out of the build dispatch
  deploy: f.boolean({ default: true, required: false }),
});
