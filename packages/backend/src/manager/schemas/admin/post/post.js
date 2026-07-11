/**
 * Schema for POST /admin/post (create)
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  title: f.string({ default: undefined, required: true }),
  url: f.string({ default: undefined, required: true }),
  description: f.string({ default: undefined, required: true }),
  headerImageURL: f.string({ default: undefined, required: true }),
  body: f.string({ default: undefined, required: true }),
  author: f.string({ default: undefined }),
  affiliate: f.string({ default: '' }),
  tags: f.array({ default: [] }),
  categories: f.array({ default: [] }),
  layout: f.string({ default: 'blueprint/blog/post' }),
  date: f.string({ default: undefined }),
  id: f.number({ default: undefined }),
  postPath: f.string({ default: 'guest' }),
  source: f.string({ default: null }),
  githubUser: f.string({ default: undefined }),
  githubRepo: f.string({ default: undefined }),
});
