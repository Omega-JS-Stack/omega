// ============================================
// Offscreen Component
// ============================================
// Persistent offscreen document for background operations
// (WebSocket connections, long-running tasks, etc.)

// Import OMEGA Extension
import omega from '@omega.js/extension/offscreen';

// Initialize
omega.initialize()
.then(() => {
  // Shortcuts
  const { extension, logger } = omega;

  // Add your project-specific offscreen logic here
  // This document is invisible and persists in the background
  // ...

  // Log the initialization
  logger.log('Offscreen initialized!');
});