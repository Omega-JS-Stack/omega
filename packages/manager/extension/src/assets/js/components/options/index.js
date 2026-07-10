// ============================================
// Options Component
// ============================================

// Import Browser Extension Manager
import Manager from '@omega.js/extension/options';

// Create instance
const manager = new Manager();

// Initialize
manager.initialize()
.then(() => {
  // Shortcuts
  const { extension, messenger, logger, omega } = manager;

  // Add your project-specific options logic here
  // ...

  // Log the initialization
  logger.log('Options initialized!');
});
