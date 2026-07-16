// Auth analytics — GA4 + Facebook Pixel + TikTok Pixel events for the three
// auth outcomes. The pixel globals (gtag/fbq/ttq) are page-level stubs the
// analytics loader replaces when consented.

export function trackLogin(method, user) {
  const userId = user.uid;
  const methodName = method.charAt(0).toUpperCase() + method.slice(1);

  // Google Analytics 4
  gtag('event', 'login', {
    method: method,
    user_id: userId,
  });

  // Facebook Pixel
  fbq('trackCustom', 'Login', {
    content_name: `Account Login ${methodName}`,
    method: method,
  });

  // TikTok Pixel
  ttq.track('Login', {
    content_id: `account-login-${method}`,
    content_type: 'product',
    content_name: `Account Login ${methodName}`,
  });
}

export function trackSignup(method, user) {
  const userId = user.uid;
  const methodName = method.charAt(0).toUpperCase() + method.slice(1);

  // Google Analytics 4
  gtag('event', 'sign_up', {
    method: method,
    user_id: userId,
  });

  // Facebook Pixel
  fbq('track', 'CompleteRegistration', {
    content_name: `Account Registration ${methodName}`,
    method: method,
  });

  // TikTok Pixel
  ttq.track('CompleteRegistration', {
    content_id: `account-registration-${method}`,
    content_type: 'product',
    content_name: `Account Registration ${methodName}`,
  });
}

export function trackPasswordReset() {
  // Google Analytics 4
  gtag('event', 'password_reset', {
    method: 'email',
    status: 'success',
  });

  // Facebook Pixel
  fbq('trackCustom', 'PasswordReset', {
    method: 'email',
    status: 'success',
  });

  // TikTok Pixel
  ttq.track('SubmitForm', {
    content_id: 'password-reset',
    content_type: 'product',
    content_name: 'Password Reset',
  });
}
