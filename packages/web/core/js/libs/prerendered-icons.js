/**
 * Prerendered Icons Library
 * Retrieves pre-rendered icon HTML from the frontmatter icon system
 */
import omega from '@omega.js/client';

/**
 * Get pre-rendered icon by name from frontmatter icon system.
 * Drop-in replacement for omega_icon in JavaScript contexts.
 *
 * @param {string} iconName - Name of the icon to retrieve (matches data-icon attribute)
 * @param {string} [classes] - CSS classes for the <i> wrapper (e.g. "fa-md me-2"), like omega_icon's second argument.
 * @returns {string} Icon HTML or empty string if not found
 *
 * @example
 * import { getPrerenderedIcon } from '__main_assets__/js/libs/prerendered-icons.js';
 *
 * // No size class
 * getPrerenderedIcon('apple');
 *
 * // With size + classes (same as {% omega_icon "robot", "fa-md me-2" %})
 * getPrerenderedIcon('robot', 'fa-md me-2');
 */
export function getPrerenderedIcon(iconName, classes) {
  const $iconTemplate = document.querySelector(`#prerendered-icons [data-icon="${iconName}"]`);

  if (!$iconTemplate) {
    return '';
  }

  if (!classes) {
    return $iconTemplate.innerHTML;
  }

  return $iconTemplate.innerHTML.replace('class="fa"', `class="fa ${omega.utilities().escapeHTML(classes)}"`);
}