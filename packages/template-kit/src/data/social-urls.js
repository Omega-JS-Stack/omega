/**
 * social-urls.js — social platform => profile URL pattern (%s = handle).
 *
 * Machine-extracted verbatim from jekyll-uj-powertools lib/tags/social.rb
 * (SOCIAL_URLS) — do not hand-edit; regenerate from the Ruby source.
 */

const SOCIAL_URLS = {
  "facebook": "https://facebook.com/%s",
  "twitter": "https://twitter.com/%s",
  "linkedin": "https://linkedin.com/in/%s",
  "youtube": "https://youtube.com/@%s",
  "instagram": "https://instagram.com/%s",
  "tumblr": "https://%s.tumblr.com",
  "slack": "https://%s.slack.com",
  "discord": "https://discord.gg/%s",
  "github": "https://github.com/%s",
  "dev": "https://dev.to/%s",
  "tiktok": "https://tiktok.com/@%s",
  "twitch": "https://twitch.tv/%s",
  "soundcloud": "https://soundcloud.com/%s",
  "spotify": "https://open.spotify.com/user/%s",
  "mixcloud": "https://mixcloud.com/%s",
};

module.exports = { SOCIAL_URLS };
