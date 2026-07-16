// Celebration animation for confirmation page
import omega from '@omega.js/client';

// Trigger confetti celebration
export async function triggerCelebration() {
  try {
    await omega.dom().loadScript({
      src: 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js'
    });

    // Center burst
    window.confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      // Brand confetti: ocean accent + a festive hand-mixed set (legacy
      // purple-era palette retired, Ian 2026-07-16)
      colors: ['#2563eb', '#18b7cf', '#21c07c', '#efa312', '#e4572e'],
    });

    // Left side burst
    setTimeout(() => {
      window.confetti({
        particleCount: 50,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ['#2563eb', '#18b7cf', '#21c07c'],
      });
    }, 250);

    // Right side burst
    setTimeout(() => {
      window.confetti({
        particleCount: 50,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ['#21c07c', '#efa312', '#e4572e'],
      });
    }, 400);
  } catch (error) {
    console.log('Confetti library failed to load:', error);
  }
}
