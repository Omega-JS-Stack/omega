/**
 * package.json generator for the developer-tool template.
 */

/**
 * Generate package.json from content item + brand data
 *
 * @param {Object} data - { name, org, title, description, cta, topics, brand }
 * @returns {string} Stringified JSON
 */
module.exports = function generatePackageJson(data) {
  const { name, org, title, description, cta, topics, brand } = data;

  const pkg = {
    name: `${org}-${name}`,
    version: '1.0.0',
    description: `${title} ${description}`,
    main: 'src/index.js',
    scripts: {
      start: 'node src/index.js',
    },
    keywords: topics || [],
    author: brand?.name || '',
    license: 'ISC',
    homepage: cta?.platform || cta?.url || brand?.url || '',
    repository: {
      type: 'git',
      url: `git+https://github.com/${org}/${name}.git`,
    },
  };

  return JSON.stringify(pkg, null, 2) + '\n';
};
