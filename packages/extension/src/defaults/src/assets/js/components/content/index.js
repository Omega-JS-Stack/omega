// ============================================
// Content Script Component
// ============================================

// Import OMEGA Extension
import Manager from '@omegajs/extension/content';

// Create instance
const manager = new Manager();

// Initialize
manager.initialize()
.then(() => {
  // Shortcuts
  const { extension, messenger, logger } = manager;

  // Add your project-specific content script logic here
  // ...

  // Log the initialization
  logger.log('Content script initialized!');
});
