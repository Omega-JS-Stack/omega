// Celebration animation for confirmation page
import webManager from 'web-manager';

// Trigger confetti celebration
export async function triggerCelebration() {
  try {
    await webManager.dom().loadScript({
      src: 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js'
    });

    // Center burst
    window.confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#5b6fff', '#8b5cf6', '#22d3ee', '#34d399', '#fb923c'],
    });

    // Left side burst
    setTimeout(() => {
      window.confetti({
        particleCount: 50,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ['#5b6fff', '#8b5cf6', '#22d3ee'],
      });
    }, 250);

    // Right side burst
    setTimeout(() => {
      window.confetti({
        particleCount: 50,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ['#34d399', '#fb923c', '#5b6fff'],
      });
    }, 400);
  } catch (error) {
    console.log('Confetti library failed to load:', error);
  }
}
