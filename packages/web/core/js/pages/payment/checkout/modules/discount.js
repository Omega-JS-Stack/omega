// Discount code logic for checkout
import { state } from './state.js';
import { validateDiscountCode } from './api.js';

/**
 * Apply a discount code via server-side validation
 * @param {string} code - Discount code to validate
 * @param {Function} updateUI - Callback to refresh bindings
 */
export async function applyDiscountCode(code, updateUI) {
  code = (code || '').trim().toUpperCase();

  if (!code) {
    state.discountCode = null;
    state.discountPercent = 0;
    state.discountUI = { loading: false, success: false, error: true, message: 'Please enter a discount code' };
    updateUI();
    return;
  }

  // Show loading
  state.discountUI = { loading: true, success: false, error: false, message: '' };
  updateUI();

  try {
    const result = await validateDiscountCode(code);

    if (result.valid) {
      state.discountCode = result.code;
      state.discountPercent = result.percent;
      state.discountUI = { loading: false, success: true, error: false, message: `Discount applied: ${result.percent}% off` };
    } else {
      state.discountCode = null;
      state.discountPercent = 0;
      state.discountUI = { loading: false, success: false, error: true, message: 'Invalid discount code' };
    }
  } catch (e) {
    console.warn('Discount validation failed:', e);
    state.discountCode = null;
    state.discountPercent = 0;
    state.discountUI = { loading: false, success: false, error: true, message: 'Unable to validate discount code. Please try again.' };
  }

  updateUI();
}
