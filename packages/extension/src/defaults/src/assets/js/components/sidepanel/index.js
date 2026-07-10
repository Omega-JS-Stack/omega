// ============================================
// Sidepanel Component
// ============================================
// Default functionality for the sidepanel view

// Import OMEGA Extension
import Manager from '@omegajs/extension/sidepanel';

// Create instance
const manager = new Manager();

// Initialize
manager.initialize()
.then(() => {
  // Shortcuts
  const { extension, messenger, logger, webManager } = manager;

  // Add your sidepanel-specific JavaScript here
  logger.log('Sidepanel initialized!');
});
