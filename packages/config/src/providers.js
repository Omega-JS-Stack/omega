/**
 * The `role.providers.<provider>` shape (#425) — every role names its vendors
 * the same way, so "which provider did the brand pick?" is ONE question with
 * one answer here instead of a hand-rolled read per service.
 *
 * The tri-state is unchanged, it just moved into key presence:
 *   - no `providers` block, or an empty one → nothing chosen (the role's
 *     service skips, exactly what a null `provider` used to mean)
 *   - `{ namecheap: {…} }`                  → chosen, with its settings
 *   - `{ namecheap: false }`                → deliberately disabled
 *
 * Roles that can only ever have one live provider (domain's registrar,
 * translation's engine, devlog's writer) read the chosen one through this;
 * roles that run several at once (payment, analytics) iterate the block
 * themselves — presence per vendor is the whole gate there.
 */

/**
 * The chosen provider key in a `providers` block.
 *
 * @param {object} [providers] - A role's `providers` map
 * @returns {string|null} - The provider name, or null when none is chosen
 */
function chosenProvider(providers) {
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) {
    return null;
  }

  return Object.keys(providers).find((name) => providers[name] !== false) || null;
}

module.exports = { chosenProvider };
