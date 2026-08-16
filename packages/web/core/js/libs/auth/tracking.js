// Auth analytics — GA4 + Facebook Pixel + TikTok Pixel events for the three
// auth outcomes. The pixel globals (gtag/fbq/ttq) are page-level stubs the
// analytics loader replaces when consented, and a blocker leaves them
// undefined — so every provider is reached through the guarded helper (#306).
import { trackGoogle, trackMeta, trackTikTok } from '__main_assets__/js/libs/analytics.js';

export function trackLogin(method, user) {
  const userId = user.uid;
  const methodName = method.charAt(0).toUpperCase() + method.slice(1);

  // Google Analytics 4
  trackGoogle('event', 'login', {
    method: method,
    user_id: userId,
  });

  // Facebook Pixel
  trackMeta('trackCustom', 'Login', {
    content_name: `Account Login ${methodName}`,
    method: method,
  });

  // TikTok Pixel
  trackTikTok('Login', {
    content_id: `account-login-${method}`,
    content_type: 'product',
    content_name: `Account Login ${methodName}`,
  });
}

export function trackSignup(method, user) {
  const userId = user.uid;
  const methodName = method.charAt(0).toUpperCase() + method.slice(1);

  // Google Analytics 4
  trackGoogle('event', 'sign_up', {
    method: method,
    user_id: userId,
  });

  // Facebook Pixel
  trackMeta('track', 'CompleteRegistration', {
    content_name: `Account Registration ${methodName}`,
    method: method,
  });

  // TikTok Pixel
  trackTikTok('CompleteRegistration', {
    content_id: `account-registration-${method}`,
    content_type: 'product',
    content_name: `Account Registration ${methodName}`,
  });
}

export function trackPasswordReset() {
  // Google Analytics 4
  trackGoogle('event', 'password_reset', {
    method: 'email',
    status: 'success',
  });

  // Facebook Pixel
  trackMeta('trackCustom', 'PasswordReset', {
    method: 'email',
    status: 'success',
  });

  // TikTok Pixel
  trackTikTok('SubmitForm', {
    content_id: 'password-reset',
    content_type: 'product',
    content_name: 'Password Reset',
  });
}
