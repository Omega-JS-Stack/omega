/**
 * The `firestore` ctx extra of the backend `emulator` layer: direct document
 * access through the run's firebase-admin, for a suite to read, write and
 * verify what a route did.
 */

/**
 * Create Firestore helper for direct database access
 * @param {object} admin - The run's firebase-admin, pointed at the emulator
 * @returns {object} The helper
 */
function createFirestoreHelper(admin) {
  const db = admin.firestore();

  return {
    /**
     * Get a document
     * @param {string} docPath - Document path (e.g., 'users/abc123')
     * @returns {Promise<object|null>} Document data or null
     */
    async get(docPath) {
      const doc = await db.doc(docPath).get();
      return doc.exists ? doc.data() : null;
    },

    /**
     * Check if a document exists
     * @param {string} docPath - Document path
     * @returns {Promise<boolean>}
     */
    async exists(docPath) {
      const doc = await db.doc(docPath).get();
      return doc.exists;
    },

    /**
     * Set a document
     * @param {string} docPath - Document path
     * @param {object} data - Data to set
     * @param {object} options - Firestore set options
     */
    async set(docPath, data, options) {
      await db.doc(docPath).set(data, options || {});
    },

    /**
     * Delete a document
     * @param {string} docPath - Document path
     */
    async delete(docPath) {
      await db.doc(docPath).delete();
    },

    /**
     * Query a collection
     * @param {string} collectionPath - Collection path
     * @returns {object} Firestore collection reference
     */
    collection(collectionPath) {
      return db.collection(collectionPath);
    },
  };
}

module.exports = { createFirestoreHelper };
