/**
 * The `pubsub` ctx extra of the backend `emulator` layer: fires a scheduled
 * function by publishing to its schedule topic on the run's Pub/Sub emulator.
 */

/**
 * Create PubSub helper for triggering scheduled functions
 * @param {object} config - The test config (`emulatorPorts`, `cloud.config.projectId`)
 * @returns {object} The helper
 */
function createPubSubHelper(config) {
  // The port the RUNNING emulator resolved, never the classic 8085. Anything
  // else on the machine holding 8085 bumps this stack's Pub/Sub emulator off
  // it, and a hardcoded endpoint then published into whatever owns that port:
  // the scheduled function never fired here, and the case sat out its waitFor.
  const pubsubPort = config.emulatorPorts?.pubsub;

  return {
    /**
     * Trigger a Firebase scheduled function via PubSub
     * @param {string} functionName - The function name (e.g., 'omega_cronDaily')
     * @returns {Promise<string>} The message ID
     */
    async trigger(functionName) {
      if (!pubsubPort) {
        throw new Error(`Cannot trigger ${functionName}: the test config carries no resolved Pub/Sub port (emulatorPorts.pubsub)`);
      }

      const { PubSub } = require('@google-cloud/pubsub');
      const pubsub = new PubSub({
        projectId: config.cloud?.config?.projectId,
        apiEndpoint: `127.0.0.1:${pubsubPort}`,
      });

      const topicName = `firebase-schedule-${functionName}`;

      // Get or create the topic (emulator may not have it yet)
      let topic = pubsub.topic(topicName);
      const [exists] = await topic.exists();

      if (!exists) {
        [topic] = await pubsub.createTopic(topicName);
      }

      const messageId = await topic.publishMessage({ json: {} });
      return messageId;
    },
  };
}

module.exports = { createPubSubHelper };
