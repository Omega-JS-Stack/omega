/**
 * FormManager - Lightweight form state management
 *
 * States: initializing → ready ⇄ submitting → ready (or submitted)
 *
 * Usage:
 *   const formManager = new FormManager('#my-form', { options });
 *   formManager.on('submit', async (data) => {
 *     const response = await fetch('/api', { body: JSON.stringify(data) });
 *     if (!response.ok) throw new Error('Failed');
 *   });
 */

// Libraries
import { ready as domReady } from 'web-manager/modules/dom.js';
import webManager from 'web-manager';

// Constants
const HONEYPOT_SELECTOR = '[data-honey], [name="honey"]';

// Shared beforeunload handler (registered once, checks all instances)
const _instances = new Set();
let _beforeUnloadRegistered = false;

function _sharedBeforeUnloadHandler(e) {
  for (const instance of _instances) {
    if (instance.config.warnOnUnsavedChanges && instance._isDirty) {
      e.preventDefault();
      e.returnValue = '';
      return;
    }
  }
}

export class FormManager {
  constructor(selector, options = {}) {
    // Get form element
    this.$form = typeof selector === 'string'
      ? document.querySelector(selector)
      : selector;

    if (!this.$form) {
      throw new Error(`FormManager: Form not found: ${selector}`);
    }

    // Configuration
    this.config = {
      autoReady: true, // Auto-transition to initialState when DOM is ready
      initialState: 'ready', // State to transition to when autoReady fires
      allowResubmit: true, // Allow resubmission after success (false = go to 'submitted' state)
      resetOnSuccess: false, // Clear form fields after successful submission
      warnOnUnsavedChanges: true, // Warn user before leaving page with unsaved changes
      submittingText: 'Processing...', // Text shown on submit button during submission
      submittedText: 'Processed!', // Text shown on submit button after submission (when allowResubmit: false)
      inputGroup: null, // Filter getData() to only include fields with matching data-input-group (null = all fields)
      ...options,
    };

    // State
    this.state = 'initializing';
    this._isDirty = false;
    this._permanentlyDisabled = new Set();

    // Event listeners
    this._listeners = {
      change: [],
      validation: [],
      submit: [],
      statechange: [],
      honeypot: [],
    };

    // Field errors (populated during validation)
    this._fieldErrors = {};

    // Track this instance for shared beforeunload handler
    _instances.add(this);

    /* @dev-only:start */
    {
      console.log('[Form-manager] Initialized', {
        selector: typeof selector === 'string' ? selector : this.$form.id || this.$form,
        config: this.config,
      });
    }
    /* @dev-only:end */

    // Initialize
    this._init();
  }

  /**
   * Initialize the form manager
   */
  _init() {
    // Set the form state attribute for debugging and consumer CSS hooks.
    this.$form.setAttribute('data-form-state', this.state);

    // Snapshot elements that are disabled in HTML markup. These are
    // business-logic disabled (e.g. "coming soon" options) and must stay
    // disabled through every state transition. Submit buttons are excluded
    // — disabled submit buttons in HTML are loading guards that FM takes over.
    this.$form.querySelectorAll('button, input, select, textarea').forEach(($el) => {
      if ($el.disabled && $el.type !== 'submit') {
        this._permanentlyDisabled.add($el);
      }
    });

    // Attach submit handler
    this.$form.addEventListener('submit', (e) => this._handleSubmit(e));

    // Attach change handlers
    this.$form.addEventListener('input', (e) => this._handleChange(e));
    this.$form.addEventListener('change', (e) => this._handleChange(e));

    // Register shared beforeunload handler once (covers all instances)
    if (!_beforeUnloadRegistered) {
      _beforeUnloadRegistered = true;
      window.addEventListener('beforeunload', _sharedBeforeUnloadHandler);
    }

    // Handle page restored from bfcache (e.g., back button after OAuth redirect)
    window.addEventListener('pageshow', (e) => this._handlePageShow(e));

    // Initialize file drop zones
    this._initFileDropZones();

    // Warn about fields missing name attributes (they will be invisible to validation and getData)
    /* @dev-only:start */
    {
      this.$form.querySelectorAll('input, select, textarea').forEach(($field) => {
        if (!$field.name && !$field.matches(HONEYPOT_SELECTOR) && $field.type !== 'hidden') {
          console.warn('[Form-manager] Field missing "name" attribute — will be skipped by validation and getData():', $field);
        }
      });
    }
    /* @dev-only:end */

    // Auto-populate form fields from URL query parameters
    this._populateFromQueryParams();

    // Auto-transition to initialState when DOM is ready
    if (this.config.autoReady) {
      domReady().then(() => this._setInitialState());
    }
  }

  /**
   * Register event listener
   */
  on(event, callback) {
    if (!this._listeners[event]) {
      this._listeners[event] = [];
    }
    this._listeners[event].push(callback);
    return this; // Allow chaining
  }

  /**
   * Emit event to all listeners
   */
  async _emit(event, data) {
    const listeners = this._listeners[event] || [];
    for (const callback of listeners) {
      await callback(data);
    }
  }

  /**
   * Auto-populate form fields from URL query parameters
   * Matches query param keys to field names (supports dot notation)
   */
  _populateFromQueryParams() {
    const params = new URLSearchParams(window.location.search);

    if (params.size === 0) {
      return;
    }

    const data = {};

    for (const [key, value] of params) {
      // Skip tracking/UTM params and common non-form params
      if (
        key.startsWith('utm_')
        || key.startsWith('itm_')
        || key === 'cb'
        || key === 'fbclid'
        || key === 'gclid'
      ) {
        continue;
      }

      // Only populate if a matching field exists in the form
      const $field = this.$form.querySelector(`[name="${key}"]`);
      if (!$field) {
        continue;
      }

      data[key] = value;
    }

    if (Object.keys(data).length > 0) {
      this.setData(data);
    }
  }

  /**
   * Set initial state based on config
   */
  _setInitialState() {
    const state = this.config.initialState;

    /* @dev-only:start */
    {
      console.log('[Form-manager] DOM ready, setting initial state:', state);
    }
    /* @dev-only:end */

    if (state === 'ready') {
      this.ready();
    } else {
      this._setState(state);
    }
  }

  /**
   * Transition to ready state
   */
  ready() {
    /* @dev-only:start */
    {
      console.log('[Form-manager] ready() called');
    }
    /* @dev-only:end */

    this._setState('ready');
    this._setDisabled(false);

    // Focus the field with autofocus attribute if it exists (desktop only)
    const $autofocusField = this.$form.querySelector('[autofocus]');
    if ($autofocusField && !$autofocusField.disabled && webManager.utilities().getDevice() === 'desktop') {
      this._focusField($autofocusField);
    }
  }

  /**
   * Handle form submission
   */
  async _handleSubmit(e) {
    // Always prevent default - this is the whole point
    e.preventDefault();

    // Ignore if not ready
    if (this.state !== 'ready') {
      /* @dev-only:start */
      {
        console.log('[Form-manager] Submit ignored, not ready. Current state:', this.state);
      }
      /* @dev-only:end */
      return;
    }

    // Get the submit button that was clicked (native browser API)
    const $submitButton = e.submitter;

    // Collect form data BEFORE disabling (disabled elements aren't in FormData)
    const data = this.getData();

    // Clear previous field errors
    this.clearFieldErrors();

    // Run validation BEFORE transitioning to submitting state
    const validationPassed = await this._runValidation(data, $submitButton);
    if (!validationPassed) {
      return;
    }

    // Transition to submitting
    this._setState('submitting');
    this._setDisabled(true);
    this._showSpinner(true);

    /* @dev-only:start */
    {
      console.log('[Form-manager] Submitting', {
        data,
        submitButton: $submitButton?.name ? `${$submitButton.name}=${$submitButton.value}` : null,
      });
    }
    /* @dev-only:end */

    try {
      // Let consumers handle the submission
      await this._emit('submit', { data, $submitButton });

      /* @dev-only:start */
      {
        console.log('[Form-manager] Submit success', {
          resetOnSuccess: this.config.resetOnSuccess,
          allowResubmit: this.config.allowResubmit,
        });
      }
      /* @dev-only:end */

      // Success - clear dirty state
      this.setDirty(false);
      this._showSpinner(false);

      if (this.config.resetOnSuccess) {
        this.$form.reset();
      }

      if (this.config.allowResubmit) {
        this._setState('ready');
        this._setDisabled(false);
      } else {
        this._setState('submitted');
        this._showSubmittedText();
        // Stay disabled - no more submissions allowed
      }
    } catch (error) {
      /* @dev-only:start */
      {
        console.log('[Form-manager] Submit error:', error.message);
      }
      /* @dev-only:end */

      // Error - go back to ready and show error
      this._setState('ready');
      this._setDisabled(false);
      this._showSpinner(false);
      this.showError(error.message || 'An error occurred');
    }
  }

  /**
   * Handle input changes
   */
  _handleChange(e) {
    // Mark form as dirty
    this.setDirty(true);

    const data = this.getData();

    /* @dev-only:start */
    {
      console.log('[Form-manager] Change', {
        name: e.target.name,
        value: e.target.value,
        data,
      });
    }
    /* @dev-only:end */

    this._emit('change', {
      field: e.target,
      name: e.target.name,
      value: e.target.value,
      data,
    });

    // Clear field error when user types in that field
    if (this._fieldErrors[e.target.name]) {
      this._clearFieldError(e.target.name);
    }

    // Clear file drop error when the file input inside a drop zone changes
    const $zone = e.target.closest('[data-file-drop]');
    if ($zone) {
      $zone.classList.remove('file-drop-error');
    }
  }

  /**
   * Run validation (HTML5 + custom validation event)
   * Returns true if validation passed, false if there are errors
   */
  async _runValidation(data, $submitButton) {
    /* @dev-only:start */
    {
      console.log('[Form-manager] Running validation');
    }
    /* @dev-only:end */

    // 0. Check honeypot fields first (bot detection)
    if (this._isHoneypotFilled()) {
      /* @dev-only:start */
      {
        console.log('[Form-manager] Honeypot triggered - rejecting submission');
      }
      /* @dev-only:end */

      // Emit honeypot event for tracking
      this._emit('honeypot', { data });

      this.showError('Something went wrong. Please try again.');
      return false;
    }

    // Create setError helper for custom validation
    const setError = (fieldName, message) => {
      this._fieldErrors[fieldName] = message;
    };

    // 1. Run automatic HTML5 validation
    this._runHTML5Validation(setError);

    // 2. Run custom validation listeners
    await this._emit('validation', { data, setError, $submitButton });

    // 3. Check if there are any errors
    const errorCount = Object.keys(this._fieldErrors).length;
    if (errorCount > 0) {
      /* @dev-only:start */
      {
        console.log('[Form-manager] Validation failed:', this._fieldErrors);
      }
      /* @dev-only:end */

      // Display all field errors
      this._displayFieldErrors();

      // Focus first error field
      this._focusFirstError();

      return false;
    }

    /* @dev-only:start */
    {
      console.log('[Form-manager] Validation passed');
    }
    /* @dev-only:end */

    return true;
  }

  /**
   * Run HTML5 constraint validation on all form fields
   */
  _runHTML5Validation(setError) {
    const $fields = this.$form.querySelectorAll('input, select, textarea');

    $fields.forEach(($field) => {
      const name = $field.name;
      if (!name) {
        return;
      }

      // Skip if field is not in current input group (respects setInputGroup filter)
      if (!this._isFieldInGroup($field)) {
        return;
      }

      // Skip if already has an error (from previous validation)
      if (this._fieldErrors[name]) {
        return;
      }

      const value = $field.value;
      const type = $field.type;

      // Required validation
      if ($field.hasAttribute('required')) {
        if (type === 'checkbox' && !$field.checked) {
          setError(name, 'This field is required');
          return;
        }
        if (type === 'radio') {
          // Radio groups: check if any radio in the group is checked
          const $checked = this.$form.querySelector(`input[name="${name}"]:checked`);
          if (!$checked) {
            setError(name, 'This field is required');
          }
          return;
        }
        if (!value || !value.trim()) {
          setError(name, 'This field is required');
          return;
        }
      }

      // Skip further validation if empty and not required
      if (!value) {
        return;
      }

      // Email validation
      if (type === 'email') {
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(value)) {
          setError(name, 'Please enter a valid email address');
          return;
        }
      }

      // URL validation
      if (type === 'url') {
        try {
          new URL(value);
        } catch {
          setError(name, 'Please enter a valid URL');
          return;
        }
      }

      // Min length validation
      if ($field.hasAttribute('minlength')) {
        const minLength = parseInt($field.getAttribute('minlength'), 10);
        if (value.length < minLength) {
          setError(name, `Must be at least ${minLength} characters`);
          return;
        }
      }

      // Max length validation
      if ($field.hasAttribute('maxlength')) {
        const maxLength = parseInt($field.getAttribute('maxlength'), 10);
        if (value.length > maxLength) {
          setError(name, `Must be no more than ${maxLength} characters`);
          return;
        }
      }

      // Min value validation (for number, range, date, etc.)
      if ($field.hasAttribute('min')) {
        const min = $field.getAttribute('min');
        if (type === 'number' || type === 'range') {
          if (parseFloat(value) < parseFloat(min)) {
            setError(name, `Must be at least ${min}`);
            return;
          }
        } else if (type === 'date' || type === 'datetime-local') {
          if (new Date(value) < new Date(min)) {
            setError(name, `Must be on or after ${min}`);
            return;
          }
        }
      }

      // Max value validation
      if ($field.hasAttribute('max')) {
        const max = $field.getAttribute('max');
        if (type === 'number' || type === 'range') {
          if (parseFloat(value) > parseFloat(max)) {
            setError(name, `Must be no more than ${max}`);
            return;
          }
        } else if (type === 'date' || type === 'datetime-local') {
          if (new Date(value) > new Date(max)) {
            setError(name, `Must be on or before ${max}`);
            return;
          }
        }
      }

      // Pattern validation
      if ($field.hasAttribute('pattern')) {
        const pattern = new RegExp(`^${$field.getAttribute('pattern')}$`);
        if (!pattern.test(value)) {
          const title = $field.getAttribute('title') || 'Please match the requested format';
          setError(name, title);
          return;
        }
      }
    });
  }

  /**
   * Display all field errors in the DOM
   */
  _displayFieldErrors() {
    for (const [fieldName, message] of Object.entries(this._fieldErrors)) {
      this._showFieldError(fieldName, message);
    }
  }

  /**
   * Show error on a specific field
   */
  _showFieldError(fieldName, message) {
    const $field = this.$form.querySelector(`[name="${fieldName}"]`);
    if (!$field) {
      return;
    }

    // Radio groups: show error text under the last radio without highlighting
    if ($field.type === 'radio') {
      const $radios = this.$form.querySelectorAll(`[name="${fieldName}"]`);
      const $last = $radios[$radios.length - 1];

      const $parent = $last.closest('.form-check') || $last.parentElement;
      let $feedback = $parent.querySelector('.invalid-feedback');
      if (!$feedback) {
        $feedback = document.createElement('div');
        $feedback.className = 'invalid-feedback';
        $parent.appendChild($feedback);
      }

      $feedback.textContent = message;
      $feedback.style.display = 'block';
      return;
    }

    // Add invalid class to field
    $field.classList.add('is-invalid');

    // Bootstrap requires `.has-validation` on the wrapping `.input-group` so the
    // trailing element (e.g. a password-visibility toggle button) keeps its
    // border-radius once a sibling `.invalid-feedback` is rendered. Without
    // this, the appended feedback makes the trailing button no longer
    // `:last-child` and Bootstrap strips its right corners to 0.
    const $inputGroup = $field.closest('.input-group');
    if ($inputGroup) {
      $inputGroup.classList.add('has-validation');
    }

    // Find or create feedback element
    let $feedback = $field.parentElement.querySelector('.invalid-feedback');
    if (!$feedback) {
      $feedback = document.createElement('div');
      $feedback.className = 'invalid-feedback';

      // Insert after the field (or after the label for checkboxes)
      if ($field.type === 'checkbox') {
        const $parent = $field.closest('.form-check') || $field.parentElement;
        $parent.appendChild($feedback);
      } else {
        $field.parentElement.appendChild($feedback);
      }
    }

    $feedback.textContent = message;
    $feedback.style.display = 'block';
  }

  /**
   * Clear error on a specific field
   */
  _clearFieldError(fieldName) {
    delete this._fieldErrors[fieldName];

    const $field = this.$form.querySelector(`[name="${fieldName}"]`);
    if (!$field) {
      return;
    }

    // Radio groups: clear the error text under the last radio
    if ($field.type === 'radio') {
      const $radios = this.$form.querySelectorAll(`[name="${fieldName}"]`);
      const $last = $radios[$radios.length - 1];

      const $parent = $last.closest('.form-check') || $last.parentElement;
      const $feedback = $parent.querySelector('.invalid-feedback');
      if ($feedback) {
        $feedback.style.display = 'none';
      }
      return;
    }

    $field.classList.remove('is-invalid');

    const $feedback = $field.parentElement.querySelector('.invalid-feedback');
    if ($feedback) {
      $feedback.style.display = 'none';
    }
  }

  /**
   * Clear all field errors
   */
  clearFieldErrors() {
    for (const fieldName of Object.keys(this._fieldErrors)) {
      this._clearFieldError(fieldName);
    }
    this._fieldErrors = {};

    // Clear file drop error states
    this.$form.querySelectorAll('[data-file-drop].file-drop-error').forEach(($zone) => {
      $zone.classList.remove('file-drop-error');
    });
  }

  /**
   * Focus the first field with an error
   */
  _focusFirstError() {
    const firstFieldName = Object.keys(this._fieldErrors)[0];
    if (!firstFieldName) {
      return;
    }

    this._focusField(firstFieldName);
  }

  /**
   * Scroll to and focus a field if it exists
   * @param {HTMLElement|string} field - Field element or field name
   */
  _focusField(field) {
    // Resolve field element from name if string provided
    const $field = typeof field === 'string'
      ? this.$form.querySelector(`[name="${field}"]`)
      : field;

    if (!$field) {
      return;
    }

    $field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $field.focus();

    // Move cursor to end of input if it has existing text
    // Disabled because throws errors on some inputs (eg email)
    // if (typeof $autofocusField.setSelectionRange === 'function') {
    //   const len = $autofocusField.value.length;
    //   $autofocusField.setSelectionRange(len, len);
    // }
  }



  /**
   * Programmatically set field errors and display them (for use in submit handler)
   */
  throwFieldErrors(errors) {
    for (const [fieldName, message] of Object.entries(errors)) {
      this._fieldErrors[fieldName] = message;
    }
    this._displayFieldErrors();
    this._focusFirstError();
    throw new Error('Validation failed');
  }

  /**
   * Handle pageshow event (bfcache restoration)
   */
  _handlePageShow(e) {
    // Only handle if page was restored from bfcache
    if (!e.persisted) {
      return;
    }

    /* @dev-only:start */
    {
      console.log('[Form-manager] Page restored from bfcache, current state:', this.state);
    }
    /* @dev-only:end */

    // Reset form to ready if it was stuck in submitting state
    if (this.state === 'submitting') {
      this._showSpinner(false);
      this.ready();
    }
  }

  /**
   * Set dirty state
   */
  setDirty(dirty) {
    if (this._isDirty === dirty) {
      return;
    }

    this._isDirty = dirty;

    /* @dev-only:start */
    {
      console.log('[Form-manager] Dirty state:', dirty);
    }
    /* @dev-only:end */
  }

  /**
   * Set form state
   */
  _setState(newState) {
    const previousState = this.state;
    this.state = newState;
    this.$form.setAttribute('data-form-state', newState);

    /* @dev-only:start */
    {
      console.log('[Form-manager] State change', {
        from: previousState,
        to: newState,
      });
    }
    /* @dev-only:end */

    this._emit('statechange', { state: newState, previousState });
  }

  /**
   * Enable/disable form controls. Elements snapshotted as permanently
   * disabled during _init() are never re-enabled.
   */
  _setDisabled(disabled) {
    /* @dev-only:start */
    {
      console.log('[Form-manager] Set disabled:', disabled);
    }
    /* @dev-only:end */

    this.$form.querySelectorAll('button, input, select, textarea').forEach(($el) => {
      if (this._permanentlyDisabled.has($el)) {
        $el.disabled = true;
        return;
      }
      $el.disabled = disabled;
    });
  }

  /**
   * Get all submit buttons in the form
   * Note: Uses button.type property instead of [type="submit"] selector
   * because HTML minifiers may strip the attribute (it's the default)
   */
  _getSubmitButtons() {
    return Array.from(this.$form.querySelectorAll('button')).filter($btn => $btn.type === 'submit');
  }

  /**
   * Show/hide spinner on submit buttons
   */
  _showSpinner(show) {
    this._getSubmitButtons().forEach(($btn) => {
      if (show) {
        // Store original content
        $btn._originalHTML = $btn.innerHTML;
        const text = this.config.submittingText;
        $btn.innerHTML = text
          ? `<span class="spinner-border spinner-border-sm me-2"></span>${webManager.utilities().escapeHTML(text)}`
          : '<span class="spinner-border spinner-border-sm"></span>';
      } else if ($btn._originalHTML) {
        $btn.innerHTML = $btn._originalHTML;
      }
    });
  }

  /**
   * Show submitted text on submit buttons (when allowResubmit: false)
   */
  _showSubmittedText() {
    this._getSubmitButtons().forEach(($btn) => {
      const $buttonText = $btn.querySelector('.button-text');
      if ($buttonText) {
        $buttonText.textContent = this.config.submittedText;
      } else {
        $btn.textContent = this.config.submittedText;
      }
    });
  }

  /**
   * Set nested value using dot notation (e.g., "user.address.city")
   */
  _setNested(obj, path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    let current = obj;

    for (const key of keys) {
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }

    // Handle multiple values (e.g., checkboxes with same name)
    if (current[lastKey] !== undefined) {
      if (!Array.isArray(current[lastKey])) {
        current[lastKey] = [current[lastKey]];
      }
      current[lastKey].push(value);
    } else {
      current[lastKey] = value;
    }
  }

  /**
   * Get nested value using dot notation
   */
  _getNested(obj, path) {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }

  /**
   * Collect form data as plain object (supports dot notation for nested fields)
   * Respects inputGroup filter when set - only includes fields matching the group
   */
  getData() {
    const data = {};

    // Get all form fields
    const $fields = this.$form.querySelectorAll('input, select, textarea');

    // Count checkboxes per name to detect groups vs single (only for fields in group)
    const checkboxCounts = {};
    $fields.forEach(($field) => {
      if ($field.type === 'checkbox' && this._isFieldInGroup($field)) {
        checkboxCounts[$field.name] = (checkboxCounts[$field.name] || 0) + 1;
      }
    });

    // Process non-checkbox fields
    $fields.forEach(($field) => {
      const name = $field.name;

      // Skip fields without name
      if (!name) {
        return;
      }

      // Skip if field is not in current input group
      if (!this._isFieldInGroup($field)) {
        return;
      }

      // Skip honeypot fields (should never be in form data)
      if ($field.matches(HONEYPOT_SELECTOR)) {
        return;
      }

      // Skip checkboxes - we handle them separately
      if ($field.type === 'checkbox') {
        return;
      }

      // Skip radio buttons that aren't checked
      if ($field.type === 'radio' && !$field.checked) {
        return;
      }

      this._setNested(data, name, $field.value);
    });

    // Handle checkboxes
    const processedGroups = new Set();
    $fields.forEach(($cb) => {
      if ($cb.type !== 'checkbox') {
        return;
      }

      const name = $cb.name;

      // Skip if field is not in current input group
      if (!this._isFieldInGroup($cb)) {
        return;
      }

      // Single checkbox: true/false
      if (checkboxCounts[name] === 1) {
        this._setNested(data, name, $cb.checked);
        return;
      }

      // Checkbox group: object with value: true/false (only process once per group)
      if (processedGroups.has(name)) {
        return;
      }
      processedGroups.add(name);

      const values = {};
      this.$form.querySelectorAll(`input[type="checkbox"][name="${name}"]`).forEach(($groupCb) => {
        // Only include checkboxes that are in the group
        if (this._isFieldInGroup($groupCb)) {
          values[$groupCb.value] = $groupCb.checked;
        }
      });
      this._setNested(data, name, values);
    });

    return data;
  }

  /**
   * Show success message
   */
  showSuccess(message) {
    /* @dev-only:start */
    {
      console.log('[Form-manager] Show success:', message);
    }
    /* @dev-only:end */

    webManager.utilities().showNotification(message, { type: 'success' });
  }

  /**
   * Show error message
   */
  showError(message) {
    /* @dev-only:start */
    {
      console.log('[Form-manager] Show error:', message);
    }
    /* @dev-only:end */

    webManager.utilities().showNotification(message, { type: 'danger' });
  }

  /**
   * Reset the form
   */
  reset() {
    /* @dev-only:start */
    {
      console.log('[Form-manager] reset() called');
    }
    /* @dev-only:end */

    this.setDirty(false);
    this.$form.reset();
    this._setState('ready');
  }

  /**
   * Programmatically trigger form submission
   * Fires the native submit event so FormManager's _handleSubmit() processes it
   */
  submit() {
    this.$form.requestSubmit();
  }

  /**
   * Check if form has unsaved changes
   */
  isDirty() {
    return this._isDirty;
  }

  /**
   * Set the input group filter for getData()
   * When set, getData() only returns fields matching the group (via data-input-group attribute)
   * Fields without data-input-group or with empty value are considered "global" and always included
   *
   * @param {string|string[]|null} group - Group name(s) to filter by (e.g., 'url', ['url', 'wifi']), or null to disable filtering
   * @returns {FormManager} - Returns this for chaining
   */
  setInputGroup(group) {
    // Normalize to array or null
    if (group === null || group === undefined || group === '') {
      this.config.inputGroup = null;
    } else if (Array.isArray(group)) {
      this.config.inputGroup = group.map((g) => g.toLowerCase());
    } else {
      this.config.inputGroup = [group.toLowerCase()];
    }

    /* @dev-only:start */
    {
      console.log('[Form-manager] setInputGroup:', this.config.inputGroup);
    }
    /* @dev-only:end */

    return this;
  }

  /**
   * Get the current input group filter
   * @returns {string[]|null}
   */
  getInputGroup() {
    return this.config.inputGroup;
  }

  /**
   * Check if any honeypot field has been filled (bot detection)
   * Honeypot fields are hidden from users but bots fill them automatically
   * @returns {boolean} - true if a honeypot field has a value (bot detected)
   */
  _isHoneypotFilled() {
    const $honeypots = this.$form.querySelectorAll(HONEYPOT_SELECTOR);

    for (const $field of $honeypots) {
      if ($field.value && $field.value.trim() !== '') {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a field should be included based on input group filter
   * @param {HTMLElement} $field - The field element to check
   * @returns {boolean}
   */
  _isFieldInGroup($field) {
    const allowedGroups = this.config.inputGroup;

    // No filter set - include all fields
    if (!allowedGroups) {
      return true;
    }

    // Get field's group attribute
    const fieldGroup = $field.getAttribute('data-input-group');

    // No group attribute or empty = global field, always include
    if (!fieldGroup || fieldGroup.trim() === '') {
      return true;
    }

    // Check if field's group is in allowed groups
    return allowedGroups.includes(fieldGroup.toLowerCase());
  }

  /**
   * Initialize file drop zones within the form
   * Scans for [data-file-drop] containers and attaches drag-and-drop behavior
   */
  _initFileDropZones() {
    const $zones = this.$form.querySelectorAll('[data-file-drop]');

    /* @dev-only:start */
    {
      console.log('[Form-manager] _initFileDropZones found', $zones.length, 'zones');
    }
    /* @dev-only:end */

    $zones.forEach(($zone) => {
      this._setupFileDropZone($zone);
    });
  }

  /**
   * Set up a single file drop zone
   * @param {HTMLElement} $zone - The container with data-file-drop attribute
   */
  _setupFileDropZone($zone) {
    const $input = $zone.querySelector('input[type="file"]');
    if (!$input) {
      return;
    }

    const mode = ($zone.getAttribute('data-file-drop') || '').toLowerCase();
    const isPageMode = mode === 'page';

    /* @dev-only:start */
    {
      console.log('[Form-manager] Setting up file drop zone', {
        mode: isPageMode ? 'page' : 'local',
        input: $input.name || $input.id,
      });
    }
    /* @dev-only:end */

    // Track drag enter/leave depth for reliable active state
    let dragDepth = 0;

    // Determine the drop target (zone or entire page)
    const $dropTarget = isPageMode ? document.body : $zone;

    // Helper: check if event landed on a different local drop zone (page mode only)
    // If so, let that zone handle it instead
    const isOverOtherZone = (e) => {
      if (!isPageMode) {
        return false;
      }

      const $closest = e.target.closest('[data-file-drop]');
      return $closest && $closest !== $zone;
    };

    // Prevent default on dragover to allow drop
    $dropTarget.addEventListener('dragover', (e) => {
      if (isOverOtherZone(e)) {
        return;
      }

      e.preventDefault();
    });

    // Track drag enter for active state
    $dropTarget.addEventListener('dragenter', (e) => {
      if (isOverOtherZone(e)) {
        return;
      }

      e.preventDefault();
      dragDepth++;

      if (dragDepth === 1) {
        $zone.classList.add('file-drop-active');
      }
    });

    // Track drag leave for active state
    $dropTarget.addEventListener('dragleave', (e) => {
      if (isOverOtherZone(e)) {
        return;
      }

      e.preventDefault();
      dragDepth--;

      if (dragDepth === 0) {
        $zone.classList.remove('file-drop-active');
      }
    });

    // Handle drop
    $dropTarget.addEventListener('drop', (e) => {
      if (isOverOtherZone(e)) {
        return;
      }

      e.preventDefault();
      dragDepth = 0;
      $zone.classList.remove('file-drop-active');

      this._handleFileDrop(e, $input, $zone);
    });

    // Click-to-browse: click anywhere on the zone opens the file picker
    $zone.addEventListener('click', (e) => {
      // Skip if clicking the input itself (avoid double-open)
      if (e.target === $input) {
        return;
      }

      $input.click();
    });

    // Update file name display when file is selected via browse dialog
    $input.addEventListener('change', () => {
      this._updateFileDropName($input, $zone);
    });
  }

  /**
   * Handle a file drop event
   * @param {DragEvent} e - The drop event
   * @param {HTMLInputElement} $input - The file input to assign files to
   * @param {HTMLElement} $zone - The drop zone container
   */
  _handleFileDrop(e, $input, $zone) {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) {
      return;
    }

    // Assign files to the input using DataTransfer
    const dt = new DataTransfer();
    const acceptAttr = $input.getAttribute('accept');
    const isMultiple = $input.hasAttribute('multiple');

    for (const file of files) {
      // Filter by accept attribute if present
      if (acceptAttr && !this._fileMatchesAccept(file, acceptAttr)) {
        continue;
      }

      dt.items.add(file);

      // Only take the first file if input is not multiple
      if (!isMultiple) {
        break;
      }
    }

    // Show error if no valid files after filtering
    if (dt.files.length === 0) {
      $zone.classList.add('file-drop-error');
      this.showError(`File type not accepted. Accepted: ${acceptAttr}`);
      return;
    }

    $input.files = dt.files;

    // Dispatch change event so existing handlers pick it up
    $input.dispatchEvent(new Event('change', { bubbles: true }));

    // Update file name display
    this._updateFileDropName($input, $zone);

    /* @dev-only:start */
    {
      console.log('[Form-manager] File dropped', {
        files: Array.from(dt.files).map((f) => f.name),
        input: $input.name || $input.id,
      });
    }
    /* @dev-only:end */
  }

  /**
   * Update the file name display element in a drop zone
   * @param {HTMLInputElement} $input - The file input
   * @param {HTMLElement} $zone - The drop zone container
   */
  _updateFileDropName($input, $zone) {
    const $name = $zone.querySelector('[data-file-drop-name]');
    if (!$name) {
      return;
    }

    const files = $input.files;
    if (!files || files.length === 0) {
      $name.textContent = 'No file selected';
      $zone.classList.remove('file-drop-has-file');
      return;
    }

    if (files.length === 1) {
      $name.textContent = files[0].name;
    } else {
      $name.textContent = `${files.length} files selected`;
    }

    $zone.classList.add('file-drop-has-file');
    $zone.classList.remove('file-drop-error');
  }

  /**
   * Check if a file matches an accept attribute value
   * @param {File} file - The file to check
   * @param {string} accept - The accept attribute value (e.g., "image/*,.pdf")
   * @returns {boolean}
   */
  _fileMatchesAccept(file, accept) {
    const types = accept.split(',').map((t) => t.trim().toLowerCase());
    const fileName = file.name.toLowerCase();
    const fileType = (file.type || '').toLowerCase();

    // Common extension-to-MIME-category map for when browser doesn't provide file.type
    const extToCategory = {
      '.jpg': 'image/', '.jpeg': 'image/', '.png': 'image/', '.gif': 'image/',
      '.webp': 'image/', '.svg': 'image/', '.bmp': 'image/', '.ico': 'image/',
      '.pdf': 'application/pdf',
    };

    for (const type of types) {
      // Extension match (e.g., ".pdf")
      if (type.startsWith('.')) {
        if (fileName.endsWith(type)) {
          return true;
        }
        continue;
      }

      // Wildcard MIME match (e.g., "image/*")
      if (type.endsWith('/*')) {
        const prefix = type.slice(0, -2) + '/';

        // Check actual MIME type
        if (fileType && fileType.startsWith(prefix)) {
          return true;
        }

        // Fallback: check extension when browser doesn't provide MIME type
        if (!fileType) {
          const ext = '.' + fileName.split('.').pop();
          const guessedCategory = extToCategory[ext] || '';
          if (guessedCategory.startsWith(prefix)) {
            return true;
          }
        }
        continue;
      }

      // Exact MIME match (e.g., "application/pdf")
      if (fileType === type) {
        return true;
      }
    }

    return false;
  }

  /**
   * Set form data from a nested object (supports dot notation field names)
   */
  setData(data) {
    /* @dev-only:start */
    {
      console.log('[Form-manager] setData() called', data);
    }
    /* @dev-only:end */

    // Flatten nested object to dot notation paths
    const flatData = this._flattenObject(data);

    // Set each field value
    for (const [path, value] of Object.entries(flatData)) {
      this._setFieldValue(path, value);
    }
  }

  /**
   * Flatten a nested object to dot notation paths
   */
  _flattenObject(obj, prefix = '') {
    const result = {};

    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        // Check if this is a checkbox group (object with boolean values)
        const isCheckboxGroup = Object.values(value).every((v) => typeof v === 'boolean');

        if (isCheckboxGroup) {
          // Keep as object for checkbox group handling
          result[path] = value;
        } else {
          // Recurse into nested object
          Object.assign(result, this._flattenObject(value, path));
        }
      } else {
        result[path] = value;
      }
    }

    return result;
  }

  /**
   * Set a single field value by name (supports dot notation)
   */
  _setFieldValue(name, value) {
    const $fields = this.$form.querySelectorAll(`[name="${name}"]`);

    if ($fields.length === 0) {
      /* @dev-only:start */
      {
        console.log('[Form-manager] setData: field not found:', name);
      }
      /* @dev-only:end */
      return;
    }

    const $field = $fields[0];
    const type = $field.type;

    // Handle different input types
    if (type === 'checkbox') {
      if ($fields.length === 1) {
        // Single checkbox: boolean value
        $field.checked = !!value;
      } else if (typeof value === 'object') {
        // Checkbox group: object with value: boolean
        $fields.forEach(($cb) => {
          $cb.checked = !!value[$cb.value];
        });
      }
    } else if (type === 'radio') {
      // Radio group: set the one with matching value
      $fields.forEach(($radio) => {
        $radio.checked = $radio.value === value;
      });
    } else if ($field.tagName === 'SELECT') {
      // Select: set value
      $field.value = value;
    } else {
      // Text, email, textarea, etc.
      $field.value = value;
    }

    /* @dev-only:start */
    {
      console.log('[Form-manager] setData: set field', { name, value, type });
    }
    /* @dev-only:end */
  }
}
