// ============================================
// Popup Component
// ============================================

// Import OMEGA Extension
import Manager from '@omega.js/extension/popup';

// Create instance
const manager = new Manager();

// Initialize
manager.initialize()
.then(() => {
  // Shortcuts
  const { extension, messenger, logger, omega } = manager;

  // Add your project-specific popup logic here
  // ...

  // Log the initialization
  logger.log('Popup initialized!');
});
