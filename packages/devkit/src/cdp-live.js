/**
 * cdp-live: settle CDP work on a target, or reject the moment the target
 * crashes. A target killed mid-command reports only `Inspector.targetCrashed`:
 * its session never detaches and the pending command never answers, so every
 * awaited command on a target that can crash runs through this race.
 */

/**
 * Race `work` against the session's `Inspector.targetCrashed`.
 *
 * @param {object} session - Anything with CDP events through `on(name, fn)` / `off(name, fn)`
 *   (a puppeteer CDPSession, the desktop CDP client).
 * @param {Promise} work - The commands in flight on `session`.
 * @param {function(): Error} onCrash - Builds the error a crash rejects with.
 * @returns {Promise} `work`'s outcome, or `onCrash()`'s error.
 */
function whileLive(session, work, onCrash) {
  let listener;
  const crashed = new Promise((_, reject) => {
    listener = () => reject(onCrash());
    session.on('Inspector.targetCrashed', listener);
  });
  return Promise.race([work, crashed]).finally(() => session.off('Inspector.targetCrashed', listener));
}

module.exports = { whileLive };
