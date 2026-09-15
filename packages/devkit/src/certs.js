/**
 * The signing-tree READERS, in one place.
 *
 * There is no delivery here any more
 * ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)): nothing COPIES
 * signing material into a target. The tree is read IN PLACE (company tier
 * first, `signing-tree.js`, #892), and the paths into it are derived once, at
 * the desktop env load, by `signing-env.js`. The copy step and its rule table
 * had two homes for one fact (which file a key points at) and produced the
 * dispersed duplicates a build could silently sign with; the manager's disperse
 * `certs` operation went with it.
 *
 * What remains is what every surface asks the tree: WHERE it is (signingTree)
 * and WHEN what it holds expires (certificateExpiry), so the certificates walk,
 * `validate-certs` and a build all answer with the same date and the same three
 * rungs.
 */
const { signingTree, certsSourceDir } = require('./signing-tree.js');
const { certificateExpiry, EXPIRY_WARN_DAYS } = require('./certificate-expiry.js');

module.exports = { signingTree, certsSourceDir, certificateExpiry, EXPIRY_WARN_DAYS };
