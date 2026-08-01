/**
 * collections.js — the collection-lookup omega_ tags (member, post).
 *
 * Ported from jekyll-uj-powertools lib/tags/{member,post}.rb. Collection
 * access is injected: the adapter provides `ctx.site.getCollection(name)`
 * returning an array of docs shaped `{ id, url, data }` (Jekyll doc parity —
 * `id` like '/team/ian' or '/posts/2024-01-01-slug', `data` = frontmatter).
 * The Ruby's image-tag property re-parsed a {% omega_image %} template; here it
 * calls the shared buildImageHtml() directly — same output, no re-parse.
 */

// Libraries
const { resolveVariable, parseArguments, parseOptions, isQuoted, stripQuotes } = require('../variable-resolver.js');
const { buildImageHtml } = require('./media.js');

// {% omega_member member_id, "property" %} — look up a team member doc
const omegaMember = {
  block: false,
  render(ctx, markup) {
    const args = parseArguments(markup);
    const memberInput = args[0];
    const property = stripQuotes(args[1] || "'name'");

    const memberId = isQuoted(memberInput)
      ? stripQuotes(memberInput)
      : resolveMemberId(ctx, memberInput);
    if (!memberId) return '';

    const team = ctx.site.getCollection('team') || [];
    const member = team.find((doc) => String(doc.id).includes(String(memberId)));
    if (!member) return '';

    const memberData = member.data.member || {};

    switch (property) {
      case 'name':
        return memberData.name || '';
      case 'url': {
        const siteUrl = ctx.site.config.url || '';
        return siteUrl + member.url;
      }
      case 'path':
        return member.url;
      case 'image':
        return memberImagePath(member);
      case 'image-tag': {
        const options = parseOptions(args.slice(2), null);
        if (!options.alt && memberData.name) options.alt = memberData.name;
        return buildImageHtml(memberImagePath(member), options);
      }
      default:
        return memberData[property] || member.data[property] || '';
    }
  },
};

function memberImagePath(member) {
  // Explicit member.image wins (external URL or any asset path — sample
  // members and CDN-hosted portraits); the team-assets convention stands
  const memberData = (member.data && member.data.member) || {};
  if (memberData.image) return memberData.image;

  const cleanId = String(member.id).replace('/team/', '');
  return `/assets/images/team/${cleanId}/profile.jpg`;
}

function resolveMemberId(ctx, memberInput) {
  if (!memberInput) {
    const page = ctx.page;
    if (!page) return null;

    if (page.post && page.post.member) return page.post.member;
    if (page.member && page.member.name) return page.id;
    return null;
  }
  return resolveVariable(ctx.lookup, memberInput);
}

// {% omega_post post_id, "property" %} — look up a post doc across collections
const omegaPost = {
  block: false,
  render(ctx, markup) {
    const args = parseArguments(markup);
    const postInput = args[0];
    const property = stripQuotes(args[1] || "'title'");

    const postId = isQuoted(postInput)
      ? stripQuotes(postInput)
      : resolvePostId(ctx, postInput);
    if (!postId) return '';

    const post = findPost(ctx.site, postId);
    if (!post) return '';

    switch (property) {
      case 'title':
        return (post.data.post && post.data.post.title) || post.data.title || '';
      case 'description':
        return (post.data.post && post.data.post.description) || post.data.description || post.data.excerpt || '';
      case 'url': {
        const siteUrl = ctx.site.config.url || '';
        return siteUrl + post.url;
      }
      case 'path':
        return post.url;
      case 'date':
        return formatPostDate(post.data.date);
      case 'author':
        return (post.data.post && post.data.post.author) || post.data.author || '';
      case 'category':
        return post.data.category || (post.data.categories && post.data.categories[0]) || '';
      case 'categories':
        return [].concat(post.data.categories || []).join(', ');
      case 'tags':
        return [].concat(post.data.tags || []).join(', ');
      case 'id':
        return post.id;
      case 'image':
        return postImagePath(post);
      case 'image-tag': {
        const src = postImagePath(post);
        if (!src) return ''; // image: false — deliberately no media

        const options = parseOptions(args.slice(2), ctx.lookup);
        if (!options.alt) {
          const defaultAlt = (post.data.post && post.data.post.title) || post.data.title;
          if (defaultAlt) options.alt = defaultAlt;
        }
        return buildImageHtml(src, options);
      }
      default:
        return (post.data.post && post.data.post[property]) || post.data[property] || '';
    }
  },
};

function formatPostDate(date) {
  if (!date) return '';
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function postImagePath(post) {
  // Media contract (same as memberImagePath + the classy includes): an
  // explicit post.image wins (external URL or any asset path — the sample
  // posts carry remote heroes), `image: false` means DELIBERATELY no media
  // (empty — image-tag renders nothing), and the blog-assets convention
  // stands otherwise.
  const postData = (post.data && post.data.post) || {};
  if (postData.image) return postData.image;
  if (postData.image === false) return '';

  const customId = postData.id || String(post.id).replace(/^\/(\w+)\//, '');
  const cleanId = String(post.id).replace(/^\/(\w+)\//, '');
  const slug = cleanId.replace(/^\d{4}-\d{2}-\d{2}-/, '');
  return `/assets/images/blog/post-${customId}/${slug}.jpg`;
}

function resolvePostId(ctx, postInput) {
  if (!postInput) {
    const page = ctx.page;
    if (!page) return null;

    if (page.post || page.collection === 'posts') return page.id;
    return null;
  }
  return resolveVariable(ctx.lookup, postInput);
}

function findPost(site, postId) {
  const idClean = String(postId).trim();
  const matches = (doc) =>
    doc.id === idClean
    || String(doc.id).includes(idClean)
    || (doc.data.post && String(doc.data.post.id) === idClean);

  const posts = site.getCollection('posts') || [];
  const found = posts.find(matches);
  if (found) return found;

  for (const name of site.getCollectionNames()) {
    if (name === 'posts') continue;
    const doc = (site.getCollection(name) || []).find((d) => matches(d) && d.data.post);
    if (doc) return doc;
  }

  return null;
}

module.exports = { omegaMember, omegaPost };
