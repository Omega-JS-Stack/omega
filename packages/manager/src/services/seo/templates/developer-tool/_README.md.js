/**
 * README.md generator for the developer-tool template — hero with badges,
 * platform download buttons, features, star-history chart, contributing.
 */

// Windows brand icon as a base64 SVG — shields.io renders macOS/Linux from
// its built-in logo set but has no working Windows logo, so it's inlined.
const ICON_WINDOWS = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0NDggNTEyIj48cGF0aCBmaWxsPSJ3aGl0ZSIgZD0iTTAgOTMuN2wxODMuNi0yNS4zIDAgMTc3LjQtMTgzLjYgMCAwLTE1Mi4xek0wIDQxOC4zbDE4My42IDI1LjMgMC0xNzUuMi0xODMuNiAwIDAgMTQ5Ljl6bTIwMy44IDI4bDI0NC4yIDMzLjcgMC0yMTEuNi0yNDQuMiAwIDAgMTc3Ljl6bTAtMzgwLjZsMCAxODAuMSAyNDQuMiAwIDAtMjEzLjgtMjQ0LjIgMzMuN3oiLz48L3N2Zz4=';

/**
 * Generate README.md from content item + brand data
 *
 * @param {Object} data - { name, org, title, description, features, cta, custom, brand }
 * @returns {string} Generated markdown
 */
module.exports = function generateReadme(data) {
  const { name, org, title, description, features, cta, custom, brand } = data;

  const brandmarkUrl = brand?.images?.brandmark || '';
  const platformUrl = cta?.platform || cta?.url || brand?.url || '';
  const downloadUrl = cta?.url || brand?.url || '';
  const brandUrl = brand?.url || '';
  const brandDescription = brand?.description || '';
  const domain = brandUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const encodedUrl = encodeURIComponent(brandUrl);

  const lines = [];

  // --- Hero ---
  lines.push('<div align="center">');
  lines.push('');
  lines.push(`<img src="${brandmarkUrl}" width="60" alt="${title} Logo">`);
  lines.push('');
  lines.push(`<h1>${title}</h1>`);
  lines.push('');
  lines.push(`<p><strong>Free <a href="${platformUrl}">${title.toLowerCase()}</a></strong> that ${description}</p>`);
  lines.push('');
  lines.push('<p>');
  lines.push(`<a href="${downloadUrl}"><img src="https://img.shields.io/badge/Download-Free-28a745?style=for-the-badge" alt="Download Free"></a>`);
  lines.push('&nbsp;');
  lines.push(`<a href="${platformUrl}"><img src="https://img.shields.io/badge/Website-${domain}-blue?style=for-the-badge" alt="Visit Website"></a>`);
  lines.push('</p>');
  lines.push('');
  lines.push('<p>');
  lines.push(`<a href="https://github.com/${org}/${name}/stargazers"><img src="https://img.shields.io/github/stars/${org}/${name}?style=flat-square&logo=github" alt="Stars"></a>`);
  lines.push(`<a href="https://github.com/${org}/${name}/network/members"><img src="https://img.shields.io/github/forks/${org}/${name}?style=flat-square&logo=github" alt="Forks"></a>`);
  lines.push(`<a href="https://github.com/${org}/${name}/issues"><img src="https://img.shields.io/github/issues/${org}/${name}?style=flat-square" alt="Issues"></a>`);
  lines.push(`<a href="${brandUrl}"><img src="https://img.shields.io/website?url=${encodedUrl}&style=flat-square" alt="Website"></a>`);
  lines.push('</p>');
  lines.push('');
  lines.push('</div>');
  lines.push('');
  lines.push('<br>');
  lines.push('');

  // --- Blockquote ---
  lines.push(`> ${brandDescription}`);
  lines.push('');
  lines.push('<br>');
  lines.push('');

  // --- Getting Started ---
  lines.push('## 🚀 Getting Started');
  lines.push('');
  lines.push('### Option 1: Direct download (recommended)');
  lines.push('');
  lines.push('Download the app for your platform.');
  lines.push('');
  lines.push(`<a href="${downloadUrl}?download=windows"><img src="https://img.shields.io/badge/Windows-0078D4?style=for-the-badge&logo=data:image/svg+xml;base64,${ICON_WINDOWS}" alt="Windows"></a>&nbsp;`);
  lines.push(`<a href="${downloadUrl}?download=macos"><img src="https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white" alt="macOS"></a>&nbsp;`);
  lines.push(`<a href="${downloadUrl}?download=linux"><img src="https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Linux"></a>`);
  lines.push('');
  lines.push('### Option 2: From source');
  lines.push('');
  lines.push('Requires [Node.js](https://nodejs.org) and [Git](https://git-scm.com).');
  lines.push('');
  lines.push('```bash');
  lines.push(`git clone https://github.com/${org}/${name}.git`);
  lines.push(`cd ${name}`);
  lines.push('npm install');
  lines.push('npm start');
  lines.push('```');
  lines.push('');

  // --- Features ---
  if (features?.length) {
    lines.push('## ✨ Features');
    lines.push('');
    for (const feature of features) {
      lines.push(`- ${feature}`);
    }
    lines.push('');
  }

  // --- Custom markdown ---
  if (custom) {
    lines.push(custom);
    lines.push('');
  }

  // --- Star History ---
  lines.push('## ⭐ Star History');
  lines.push('');
  lines.push(`<a href="https://www.star-history.com/#${org}/${name}&Date">`);
  lines.push('  <picture>');
  lines.push(`    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=${org}/${name}&type=Date&theme=dark" />`);
  lines.push(`    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=${org}/${name}&type=Date" />`);
  lines.push(`    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=${org}/${name}&type=Date" width="100%" />`);
  lines.push('  </picture>');
  lines.push('</a>');
  lines.push('');

  // --- Contributing ---
  lines.push('## 🤝 Contributing');
  lines.push('');
  lines.push('Contributions are welcome. Issues, pull requests, feature ideas, documentation, design.');
  lines.push('');
  lines.push('<sub>If this project helped you grow, consider giving it a ⭐</sub>');

  return lines.join('\n');
};
