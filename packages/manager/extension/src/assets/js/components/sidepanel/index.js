// ============================================
// Sidepanel Component
// ============================================
// Default functionality for the sidepanel view

// Import Browser Extension Manager
import Manager from '@omega.js/extension/sidepanel';

// Create instance
const manager = new Manager();

// Initialize
manager.initialize()
.then(() => {
  // Shortcuts
  const { extension, messenger, logger, omega } = manager;

  // Add your sidepanel-specific JavaScript here
  logger.log('Sidepanel initialized!');
});
