/**
 * FormManager Test Page JavaScript
 */

// Libraries
import { FormManager } from '__main_assets__/js/libs/form-manager.js';
import webManager from 'web-manager';

// Module
export default () => {
  return new Promise(async function (resolve) {
    // Initialize when DOM is ready
    await webManager.dom().ready();

    // Initialize test forms
    initTestFormMain();
    initTestFormValidation();
    initTestFormContact();
    initTestFormManual();
    initTestFormGroups();
    initTestFormFileDrop();
    initTestFormSnapshot();

    // Resolve after initialization
    return resolve();
  });
};

// Helper: simulate async API call
function simulateApi(ms = 1000) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test 1: Full Test (success/fail, nested, change events)
function initTestFormMain() {
  const formManager = new FormManager('#test-form-main');
  const $status = document.getElementById('main-status');
  const $action = document.getElementById('main-action');
  const $output = document.getElementById('main-output');

  formManager.on('statechange', ({ state }) => {
    $status.textContent = `Status: ${state}`;
  });

  formManager.on('change', ({ name, value, data }) => {
    console.log('[Test 1] Change:', name, '=', value);
    console.log('[Test 1] Full data:', data);
  });

  formManager.on('submit', async ({ data, $submitButton }) => {
    console.log('[Test 1] Submitting:', data);
    console.log('[Test 1] Submit button:', $submitButton?.dataset?.action);

    // Show action separately
    const action = $submitButton?.dataset?.action || 'unknown';
    $action.textContent = `Action: ${action}`;

    // Show data
    $output.textContent = JSON.stringify(data, null, 2);

    await simulateApi(1000);

    if (data.settings.outcome === 'error') {
      throw new Error('Simulated server error - please try again');
    }

    formManager.showSuccess(`Form ${action === 'draft' ? 'saved as draft' : 'submitted'} successfully!`);
  });

  // Set Data button - test setData() API
  const $setDataBtn = document.getElementById('main-set-data');
  $setDataBtn.addEventListener('click', () => {
    const testData = {
      user: {
        name: 'John Doe',
        email: 'john@example.com',
        address: {
          city: 'Los Angeles',
        },
      },
      settings: {
        outcome: 'error',
        subscribe: true,
      },
      preferences: {
        notifications: 'important',
        features: {
          darkmode: true,
          analytics: true,
          beta: false,
        },
      },
    };

    formManager.setData(testData);
    $output.textContent = 'Data set via setData() API - submit to verify';
  });
}

// Test 2: Validation
function initTestFormValidation() {
  const formManager = new FormManager('#test-form-validation');
  const $status = document.getElementById('validation-status');
  const $setCorrectBtn = document.getElementById('validation-set-correct');

  formManager.on('statechange', ({ state }) => {
    $status.textContent = `Status: ${state}`;
  });

  // Validation event - runs BEFORE submit, use setError to accumulate errors
  formManager.on('validation', ({ data, setError }) => {
    console.log('[Test 2] Validating:', data);

    // Custom validation (HTML5 validation handles required, email format, etc.)
    // Here we add business logic validation

    if (data.age && parseInt(data.age) < 18) {
      setError('age', 'You must be 18 or older');
    }

    // Note: 'required' validation is handled automatically by HTML5 validation
    // We just need to add the 'required' attribute to the HTML inputs
  });

  formManager.on('submit', async ({ data }) => {
    console.log('[Test 2] Submitting (validation passed):', data);

    // If we reach here, validation passed
    await simulateApi(500);
    formManager.showSuccess('Validation passed! Form submitted.');
  });

  // Set Correct button - fills in valid values
  $setCorrectBtn.addEventListener('click', () => {
    formManager.setData({
      name: 'John Doe',
      email: 'john@example.com',
      age: 25,
      terms: true,
    });
  });
}

// Test 3: Contact Form (one-time submit)
function initTestFormContact() {
  const formManager = new FormManager('#test-form-contact', {
    allowResubmit: false,
    resetOnSuccess: true,
  });
  const $status = document.getElementById('contact-status');

  formManager.on('statechange', ({ state }) => {
    $status.textContent = `Status: ${state}`;
  });

  formManager.on('change', ({ name, value, data }) => {
    console.log('[Test 3] Change:', name, '=', value);
    console.log('[Test 3] Full data:', data);
  });

  formManager.on('submit', async ({ data }) => {
    console.log('[Test 3] Submitting:', data);
    await simulateApi(1000);
    formManager.showSuccess('Message sent! Form is now locked.');
  });
}

// Test 4: Manual Ready
function initTestFormManual() {
  const formManager = new FormManager('#test-form-manual', { autoReady: false });
  const $status = document.getElementById('manual-status');

  formManager.on('statechange', ({ state }) => {
    $status.textContent = `Status: ${state}`;
  });

  formManager.on('change', ({ name, value, data }) => {
    console.log('[Test 4] Change:', name, '=', value);
    console.log('[Test 4] Full data:', data);
  });

  formManager.on('submit', async ({ data }) => {
    console.log('[Test 4] Submitting:', data);
    await simulateApi(1000);
    formManager.showSuccess('Done!');
  });

  // Simulate async initialization (e.g., loading user data)
  setTimeout(() => {
    console.log('[Test 4] Now ready');
    formManager.ready();
  }, 2000);
}

// Test 5: Input Groups
// Test 6: File Drop (defined below initTestFormGroups)

function initTestFormGroups() {
  const formManager = new FormManager('#test-form-groups');
  const $status = document.getElementById('groups-status');
  const $filter = document.getElementById('groups-filter');
  const $output = document.getElementById('groups-output');
  const $filterBtns = document.querySelectorAll('.groups-filter-btn');

  formManager.on('statechange', ({ state }) => {
    $status.textContent = `Status: ${state}`;
  });

  // Filter button click handler
  $filterBtns.forEach(($btn) => {
    $btn.addEventListener('click', () => {
      // Update active state
      $filterBtns.forEach(($b) => $b.classList.remove('active'));
      $btn.classList.add('active');

      // Set the input group filter (parse data-group as JSON array or single string)
      const groupAttr = $btn.dataset.group;
      let group = null;
      if (groupAttr) {
        try {
          group = JSON.parse(groupAttr);
        } catch {
          group = groupAttr; // Single string value
        }
      }
      formManager.setInputGroup(group);

      // Update filter display
      const currentGroup = formManager.getInputGroup();
      $filter.textContent = currentGroup
        ? `Filter: ${JSON.stringify(currentGroup)}`
        : 'Filter: none (all fields)';

      console.log('[Test 5] Input group set to:', currentGroup);
    });
  });

  formManager.on('submit', async ({ data }) => {
    console.log('[Test 5] getData() result:', data);

    // Show the filtered data
    $output.textContent = JSON.stringify(data, null, 2);

    // Don't actually submit - just show the data
    formManager.showSuccess('getData() returned ' + Object.keys(data).length + ' top-level keys');
  });
}

// Test 7: Disabled-State Snapshot
function initTestFormSnapshot() {
  const formManager = new FormManager('#test-form-snapshot');
  const $status = document.getElementById('snapshot-status');
  const $cycleCount = document.getElementById('snapshot-cycle-count');
  const $output = document.getElementById('snapshot-output');
  const $cycleBtn = document.getElementById('snapshot-cycle');

  let cycles = 0;

  function logStates() {
    const form = document.getElementById('test-form-snapshot');
    const lines = [];
    form.querySelectorAll('input, select, textarea, button').forEach(($el) => {
      const label = $el.name || $el.type || $el.tagName.toLowerCase();
      lines.push(`${label}: disabled=${$el.disabled}`);
    });
    $output.textContent = lines.join('\n');
  }

  formManager.on('statechange', ({ state }) => {
    $status.textContent = `Status: ${state}`;
    logStates();
  });

  formManager.on('submit', async ({ data }) => {
    console.log('[Test 7] Submitting:', data);
    logStates();
    await simulateApi(2000);
    cycles++;
    $cycleCount.textContent = `Cycles: ${cycles}`;
    formManager.showSuccess('Done! Permanently disabled fields should still be disabled.');
  });

  // Rapid cycle button — triggers 5 fast disable/enable cycles
  $cycleBtn.addEventListener('click', async () => {
    $cycleBtn.disabled = true;
    for (let i = 0; i < 5; i++) {
      formManager._setDisabled(true);
      logStates();
      await simulateApi(300);
      formManager._setDisabled(false);
      logStates();
      await simulateApi(300);
      cycles++;
    }
    $cycleCount.textContent = `Cycles: ${cycles}`;
    $cycleBtn.disabled = false;
    formManager.showSuccess('5 rapid cycles complete. Check that Enterprise/Region/Notes stayed disabled.');
  });
}

// Test 6: File Drop
function initTestFormFileDrop() {
  const formManager = new FormManager('#test-form-file-drop');
  const $status = document.getElementById('file-drop-status');

  formManager.on('statechange', ({ state }) => {
    $status.textContent = `Status: ${state}`;
  });

  formManager.on('change', ({ name, value }) => {
    console.log('[Test 6] Change:', name, '=', value);
  });

  formManager.on('submit', async ({ data }) => {
    console.log('[Test 6] Submitting:', data);
    await simulateApi(500);
    formManager.showSuccess('File(s) submitted!');
  });
}
