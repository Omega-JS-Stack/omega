/**
 * Contact Page JavaScript
 */

// Libraries
import { FormManager } from '__main_assets__/js/libs/form-manager.js';
import fetch from 'wonderful-fetch';
import webManager from 'web-manager';

// Module
export default () => {
  return new Promise(async function (resolve) {
    // Initialize when DOM is ready
    await webManager.dom().ready();

    setupForm();
    setupFormScrolling();

    // Resolve after initialization
    return resolve();
  });
};

// Setup form handling
function setupForm() {
  const formManager = new FormManager('#contact-form', {
    allowResubmit: false,
    resetOnSuccess: true,
  });

  // Track honeypot triggers (spam detection)
  formManager.on('honeypot', () => {
    trackContactSpam();
  });

  formManager.on('submit', async ({ data }) => {
    const slapformId = webManager.config.brand.contact['slapform-form-id'];

    console.log('Contact form submission:', data);

    // Check if slapformId is missing
    if (!slapformId) {
      webManager.sentry().captureException(new Error('Contact form is not configured - missing slapform ID'));
      throw new Error('Contact form is not configured properly. Please try again later.');
    }

    trackContactFormSubmit(data.subject || 'general');

    // Prepare data for API
    const requestData = {
      first_name: data.first_name,
      last_name: data.last_name,
      email: data.email,
      company: data.company || '',
      subject: data.subject,
      message: data.message,
      uid: data.uid || '',
    };

    // Get API endpoint from site config or use default
    const apiEndpoint = `https://api.slapform.com/${slapformId}`;

    try {
      // Send request using wonderful-fetch
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        body: requestData,
        response: 'json',
        cacheBreaker: false,
        timeout: 30000,
      });

      console.log('Contact form submitted successfully:', response);

      formManager.showSuccess('Thank you for your message! We\'ll get back to you within 24 hours.');
    } catch (error) {
      console.error('Contact form submission failed:', error);

      // Only capture technical errors to Sentry (network, timeout, API errors)
      if (error.message?.includes('network') || error.message?.includes('timeout') || !error.message?.includes('Failed')) {
        webManager.sentry().captureException(new Error('Contact form submission error', { cause: error }));
      }

      // Show user-friendly error message
      let errorMessage = 'An error occurred while sending your message. ';

      if (error.message?.includes('network')) {
        errorMessage += 'Please check your internet connection and try again.';
      } else if (error.message?.includes('timeout')) {
        errorMessage += 'The request timed out. Please try again.';
      } else if (error.message?.includes('Failed')) {
        errorMessage = error.message;
      } else {
        errorMessage += 'Please try again or contact us directly.';
      }

      throw new Error(errorMessage);
    }
  });
}

// Setup smooth scrolling to form and chat handler
function setupFormScrolling() {
  const $contactLinks = document.querySelectorAll('a[href="#form"], a[href="#chat"]');

  $contactLinks.forEach($link => {
    $link.addEventListener('click', (e) => {
      e.preventDefault();

      const href = $link.getAttribute('href');

      if (href === '#chat') {
        // Open chat window
        try {
          webManager._chatsy?.open();
        } catch (error) {
          webManager.sentry().captureException(new Error('Error opening chat', { cause: error }));
          webManager.utilities().showNotification('Chat is currently unavailable. Please try again later.', 'danger');
        }
        return;
      }

      if (href === '#form') {
        const $formSection = document.getElementById('form');
        if (!$formSection) {
          return;
        }

        // Smooth scroll to the form section
        $formSection.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });

        // Focus the first input after scroll completes
        const focusFirstInput = () => {
          const $firstInput = document.querySelector('#contact-form input');
          if (!$firstInput) {
            return;
          }

          $firstInput.focus();
          // Don't select text on mobile devices
          if (!('ontouchstart' in window) && $firstInput.select) {
            $firstInput.select();
          }
        };

        // Try focusing immediately and after scroll animation
        focusFirstInput();
        setTimeout(focusFirstInput, 800);
      }
    });
  });
}

// Tracking functions
function trackContactSpam() {
  gtag('event', 'contact_form_spam', {
    content_type: 'honeypot',
  });
}

function trackContactFormSubmit(subject) {
  gtag('event', 'generate_lead', {
    lead_source: 'contact_form',
    subject: subject,
  });
  fbq('track', 'Lead', {
    content_name: 'Contact Form',
    content_category: subject,
  });
  ttq.track('Contact', {
    content_id: 'contact-form',
    content_type: 'product',
    content_name: 'Contact Form',
  });
}
