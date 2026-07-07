/**
 * Feedback Page JavaScript
 */

// Libraries
import { FormManager } from '__main_assets__/js/libs/form-manager.js';
import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';
import { getPrerenderedIcon } from '__main_assets__/js/libs/prerendered-icons.js';
import webManager from 'web-manager';

// Module
export default () => {
  return new Promise(async function (resolve) {
    // Initialize when DOM is ready
    await webManager.dom().ready();

    setupForm();
    setupRatingButtons();

    // Resolve after initialization
    return resolve();
  });
};

// Setup rating button selection
function setupRatingButtons() {
  const $buttons = document.querySelectorAll('.feedback-rating-btn');

  $buttons.forEach($btn => {
    $btn.addEventListener('click', () => {
      selectRating($btn.dataset.rating);
    });
  });

  // Sync visual state with hidden input (may have been pre-populated by FormManager query params)
  const $ratingInput = document.getElementById('feedback-rating-input');
  if ($ratingInput?.value) {
    selectRating($ratingInput.value);
  }
}

// Select a rating
function selectRating(ratingId) {
  const $buttons = document.querySelectorAll('.feedback-rating-btn');
  const $ratingInput = document.getElementById('feedback-rating-input');

  // Remove active state from all buttons
  $buttons.forEach($b => $b.classList.remove('active'));

  // Set active state on target button
  const $target = document.querySelector(`.feedback-rating-btn[data-rating="${ratingId}"]`);
  if (!$target) {
    return;
  }

  $target.classList.add('active');
  $ratingInput.value = ratingId;
}

// Setup form handling
function setupForm() {
  const formManager = new FormManager('#feedback-form', {
    allowResubmit: false,
    resetOnSuccess: false,
    autoReady: false,
    submittingText: 'Submitting...',
    submittedText: 'Thank you!',
  });

  // Custom validation: require a rating selection
  formManager.on('validation', ({ data, setError }) => {
    if (!data.rating) {
      setError('rating', 'Please select a rating before submitting.');
    }
  });

  formManager.on('submit', async ({ data }) => {
    trackFeedbackSubmit(data.rating);

    const response = await authorizedFetch(`${webManager.getApiUrl()}/backend-manager/user/feedback`, {
      method: 'POST',
      response: 'json',
      timeout: 30000,
      body: {
        rating: data.rating,
        positive: data.positive || '',
        negative: data.negative || '',
        comments: data.comments || '',
      },
    });

    formManager.showSuccess('Thank you for your feedback! Your input helps us improve.');

    // Check if the backend wants us to prompt for a review
    const review = response?.review;
    if (!review?.promptReview || !review?.reviewURL) {
      return;
    }

    showReviewModal(review.reviewURL, data);
  });

  // Wait for auth state before enabling the form
  webManager.auth().listen({ once: true }, () => {
    formManager.ready();
  });
}

// Show the review prompt modal
function showReviewModal(reviewURL, data) {
  const $link = document.getElementById('review-modal-link');
  if (!$link) {
    return;
  }

  // Ensure it's a full URL
  const fullURL = reviewURL.startsWith('http') ? reviewURL : `https://${reviewURL}`;
  $link.href = fullURL;

  // Extract site name for display
  try {
    const siteName = new URL(fullURL).hostname.replace('www.', '');
    $link.innerHTML = `${getPrerenderedIcon('arrow-up-right-from-square', 'me-2')} Post your review on ${webManager.utilities().escapeHTML(siteName)}`;
  } catch (e) {
    // Use default text
  }

  // Populate the copy-paste feedback textarea with positive feedback
  const $feedbackTextarea = document.getElementById('review-modal-feedback');
  if ($feedbackTextarea) {
    const positiveParts = [data.positive, data.comments].filter(v => v && v.trim());
    $feedbackTextarea.value = positiveParts.join('\n\n');
  }

  // Setup copy button
  const $copyBtn = document.getElementById('review-modal-copy');
  if ($copyBtn && $feedbackTextarea) {
    $copyBtn.addEventListener('click', () => {
      webManager.utilities().clipboardCopy($feedbackTextarea.value);
      $copyBtn.innerHTML = `${getPrerenderedIcon('check', 'me-1')} Copied!`;
      setTimeout(() => {
        $copyBtn.innerHTML = `${getPrerenderedIcon('copy', 'me-1')} Copy`;
      }, 2000);
    }, { once: false });
  }

  // Track review prompt shown
  trackReviewPromptShown(fullURL);

  // Show modal
  const $modalElement = document.getElementById('review-modal');
  if (!$modalElement) {
    return;
  }

  const modal = new bootstrap.Modal($modalElement);
  modal.show();

  // Track when user clicks the review link
  $link.addEventListener('click', () => {
    trackReviewClick(fullURL);
  }, { once: true });
}

// Tracking functions
function trackFeedbackSubmit(rating) {
  gtag('event', 'feedback_submitted', {
    feedback_rating: rating,
  });
  fbq('track', 'SubmitApplication', {
    content_name: 'Feedback Form',
    content_category: rating,
  });
  ttq.track('SubmitForm', {
    content_id: 'feedback-form',
    content_type: 'product',
    content_name: 'Feedback Form',
  });
}

function trackReviewPromptShown(url) {
  gtag('event', 'review_prompt_shown', {
    review_url: url,
  });
}

function trackReviewClick(url) {
  gtag('event', 'review_click', {
    review_url: url,
  });
  fbq('track', 'Lead', {
    content_name: 'Review Click',
    content_category: 'review',
  });
  ttq.track('Contact', {
    content_id: 'review-click',
    content_type: 'product',
    content_name: 'Review Click',
  });
}
