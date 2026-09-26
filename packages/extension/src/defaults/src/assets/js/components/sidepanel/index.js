// ============================================
// Sidepanel Component
// ============================================
// Default functionality for the sidepanel view

// Import OMEGA Extension
import omega from '@omega.js/extension/sidepanel';

// Initialize
omega.initialize()
.then(() => {
  // Shortcuts
  const { extension, messenger, logger } = omega;

  // Add your sidepanel-specific JavaScript here
  logger.log('Sidepanel initialized!');
});
