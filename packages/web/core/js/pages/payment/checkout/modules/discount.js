// Discount code logic for checkout
import { state, formatCurrency } from './state.js';
import { validateDiscountCode } from './api.js';

/**
 * What a validated code takes off, in its own shape: the server answers with a
 * `percent` OR an `amount`, never both. Reading only the percent is what made
 * a flat code announce itself as "undefined% off".
 * @param {object} result - the validate() body
 * @returns {string} e.g. "20% off" or "$10.00 off"
 */
function describeDiscount(result) {
  return result.percent > 0
    ? `${result.percent}% off`
    : `${formatCurrency(result.amount)} off`;
}

/** Put the receipt back on full price, in both discount shapes. */
function clearDiscount() {
  state.discountCode = null;
  state.discountPercent = 0;
  state.discountAmount = 0;
}

/**
 * Apply a discount code via server-side validation
 * @param {string} code - Discount code to validate
 * @param {Function} updateUI - Callback to refresh bindings
 */
export async function applyDiscountCode(code, updateUI) {
  code = (code || '').trim().toUpperCase();

  if (!code) {
    clearDiscount();
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
      // One shape or the other reaches the receipt; the other stays zero, so
      // the summary prices against whichever the server actually issued
      state.discountCode = result.code;
      state.discountPercent = result.percent || 0;
      state.discountAmount = result.amount || 0;
      state.discountUI = { loading: false, success: true, error: false, message: `Discount applied: ${describeDiscount(result)}` };
    } else {
      clearDiscount();
      state.discountUI = { loading: false, success: false, error: true, message: 'Invalid discount code' };
    }
  } catch (e) {
    console.warn('Discount validation failed:', e);
    clearDiscount();
    state.discountUI = { loading: false, success: false, error: true, message: 'Unable to validate discount code. Please try again.' };
  }

  updateUI();
}
