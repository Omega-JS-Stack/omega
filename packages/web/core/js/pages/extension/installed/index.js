/**
 * Extension Installed Page JavaScript
 */

// Libraries
import webManager from 'web-manager';

// Module
export default () => {
  return new Promise(async function (resolve) {
    // Initialize when DOM is ready
    await webManager.dom().ready();

    setupSlideshow();

    // Resolve after initialization
    return resolve();
  });
};

// Slideshow auto-advance interval (ms)
const SLIDESHOW_INTERVAL = 5000;

// Active slideshow timer
let slideshowTimer = null;

// Setup slideshow
function setupSlideshow() {
  const $slideshow = document.querySelector('.steps-slideshow');

  if (!$slideshow) {
    return;
  }

  initSlideshow($slideshow);
}

// Initialize a slideshow: build dots, show first slide, start auto-advance
function initSlideshow($slideshow) {
  const $slides = $slideshow.querySelectorAll('.step-slide');
  const $dotsContainer = $slideshow.querySelector('.steps-dots');
  const $prevBtn = $slideshow.querySelector('.step-prev');
  const $nextBtn = $slideshow.querySelector('.step-next');
  const totalSteps = $slides.length;

  // Build dots
  $dotsContainer.innerHTML = '';
  for (let i = 0; i < totalSteps; i++) {
    const $dot = document.createElement('button');
    $dot.type = 'button';
    $dot.className = 'step-dot';
    $dot.setAttribute('aria-label', `Step ${i + 1}`);
    $dot.addEventListener('click', () => {
      goToSlide($slideshow, i);
      resetAutoAdvance($slideshow);
    });
    $dotsContainer.appendChild($dot);
  }

  // Show first slide
  goToSlide($slideshow, 0);

  // Nav button handlers
  $prevBtn.addEventListener('click', () => {
    const current = getCurrentSlideIndex($slideshow);
    if (current > 0) {
      goToSlide($slideshow, current - 1);
      resetAutoAdvance($slideshow);
    }
  });

  $nextBtn.addEventListener('click', () => {
    const current = getCurrentSlideIndex($slideshow);
    const $slides = $slideshow.querySelectorAll('.step-slide');
    goToSlide($slideshow, (current + 1) % $slides.length);
    resetAutoAdvance($slideshow);
  });

  // Start auto-advance
  startAutoAdvance($slideshow);
}

// Navigate to a specific slide
function goToSlide($slideshow, index) {
  const $slides = $slideshow.querySelectorAll('.step-slide');
  const $dots = $slideshow.querySelectorAll('.step-dot');
  const $prevBtn = $slideshow.querySelector('.step-prev');

  // Update slides
  $slides.forEach(($slide, i) => {
    $slide.classList.toggle('active', i === index);
  });

  // Update dots
  $dots.forEach(($dot, i) => {
    $dot.classList.toggle('active', i === index);
  });

  // Update nav button states (next always enabled since it loops)
  $prevBtn.disabled = index === 0;

  // Update next button text on last slide
  const $nextBtn = $slideshow.querySelector('.step-next');
  const $nextText = $nextBtn.querySelector('.button-text');
  $nextText.textContent = index === $slides.length - 1 ? 'Restart' : 'Next';
}

// Get current active slide index
function getCurrentSlideIndex($slideshow) {
  const $slides = $slideshow.querySelectorAll('.step-slide');
  for (let i = 0; i < $slides.length; i++) {
    if ($slides[i].classList.contains('active')) {
      return i;
    }
  }
  return 0;
}

// Start auto-advance timer
function startAutoAdvance($slideshow) {
  clearInterval(slideshowTimer);

  slideshowTimer = setInterval(() => {
    const $slides = $slideshow.querySelectorAll('.step-slide');
    const current = getCurrentSlideIndex($slideshow);
    const next = (current + 1) % $slides.length;

    goToSlide($slideshow, next);
  }, SLIDESHOW_INTERVAL);
}

// Reset auto-advance (restart timer after manual interaction)
function resetAutoAdvance($slideshow) {
  startAutoAdvance($slideshow);
}
