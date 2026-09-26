/**
 * UserService: the process service that makes @omega.js/account's `User` a
 * backend user.
 *
 * `User` is one class on both sides (the browser builds the same shape), and
 * the '$uuid'/'$randomId'/'$apiKey' schema tokens are the one thing only a Node
 * host can fill: the browser injects no generators and those fields resolve to
 * null, because real values always come from the backend. This service assigns
 * them ONCE at boot (`User.generators` is static: one host per process), so
 * every `new User(doc)` anywhere in the backend mints real ids.
 */
const uuid4 = require('uuid').v4;
const UIDGenerator = require('uid-generator');
const { User } = require('../helpers/account.js');

const uidgen = new UIDGenerator(256);

/**
 * The backend's `User` generators, installed on construction.
 */
class UserService {
  /**
   * @param {object} omega - the Omega instance (its `utilities.randomId` mints the 8-char ids).
   */
  constructor(omega) {
    this.omega = omega;

    this.generators = {
      uuid: () => `${uuid4()}`,
      randomId: () => omega.utilities.randomId({ size: 8 }),
      apiKey: () => `${uidgen.generateSync()}`,
    };

    User.generators = this.generators;
  }
}

module.exports = UserService;
