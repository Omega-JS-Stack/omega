// Bootstrap Components Test Page JavaScript

// Libraries
import webManager from 'web-manager';

// Module
export default () => {
  return new Promise(async function (resolve) {
    // Initialize when DOM is ready
    await webManager.dom().ready();

    // Initialize Bootstrap components
    initializeBootstrapComponents();

    // Resolve after initialization
    return resolve();
  });
};

// Initialize Bootstrap interactive components
function initializeBootstrapComponents() {
  // Initialize tooltips
  const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
  const tooltipList = tooltipTriggerList.map(function (tooltipTriggerEl) {
    return new bootstrap.Tooltip(tooltipTriggerEl);
  });
  
  // Initialize popovers
  const popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));
  const popoverList = popoverTriggerList.map(function (popoverTriggerEl) {
    return new bootstrap.Popover(popoverTriggerEl);
  });
  
  // Initialize toast
  const toastElList = [].slice.call(document.querySelectorAll('.toast'));
  const toastList = toastElList.map(function(toastEl) {
    return new bootstrap.Toast(toastEl);
  });
  
  // Show toast on button click
  const $toastTrigger = document.getElementById('liveToastBtn');
  const $toastLiveExample = document.getElementById('liveToast');
  if ($toastTrigger && $toastLiveExample) {
    $toastTrigger.addEventListener('click', function () {
      const toast = new bootstrap.Toast($toastLiveExample);
      toast.show();
    });
  }
}