/**
 * Status Page JavaScript
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

    // Initialize components
    initializeUptimeBars();
    initializeSubscribeForm();
    initializeTooltips();
    initializeRefreshTimer();
    initializeBuildInfo();

    // Fetch status data (if configured)
    fetchStatusData();

    // Resolve after initialization
    return resolve();
  });
};

// Configuration - maps status levels to Bootstrap classes
const config = {
  selectors: {
    statusBanner: '#status-banner',
    statusText: '#status-text',
    servicesList: '#services-list',
    maintenanceList: '#maintenance-list',
    maintenanceEmpty: '#maintenance-empty',
    incidentsList: '#incidents-list',
    incidentsEmpty: '#incidents-empty',
    subscribeForm: '#status-subscribe-form',
    buildInfoLoading: '#build-info-loading',
    buildInfoContent: '#build-info-content',
    buildInfoError: '#build-info-error',
    buildTime: '#build-time',
    buildTimeAgo: '#build-time-ago',
    buildEnvironment: '#build-environment',
    buildPackages: '#build-packages',
    buildRepo: '#build-repo',
  },
  // Maps status levels to Bootstrap bg-* classes
  statusClasses: {
    operational: 'bg-success',
    degraded: 'bg-warning',
    major: 'bg-danger',
    maintenance: 'bg-info',
  },
  // Maps status levels to Bootstrap border-* classes
  borderClasses: {
    operational: 'border-success',
    degraded: 'border-warning',
    major: 'border-danger',
    maintenance: 'border-info',
    resolved: 'border-success',
    investigating: 'border-warning',
    identified: 'border-danger',
    monitoring: 'border-info',
  },
  // Maps incident status to data-status attribute values
  dataStatusMap: {
    investigating: 'warning',
    identified: 'danger',
    monitoring: 'info',
    resolved: 'success',
  },
  statusLabels: {
    operational: 'Operational',
    degraded: 'Degraded Performance',
    major: 'Major Outage',
    maintenance: 'Under Maintenance',
  },
};

// Initialize uptime bar tooltips
function initializeUptimeBars() {
  const $uptimeBars = document.querySelectorAll('.uptime-bars');

  $uptimeBars.forEach($barsContainer => {
    const $bars = $barsContainer.querySelectorAll('.uptime-bar');

    $bars.forEach(($bar, index) => {
      $bar.addEventListener('mouseenter', (e) => showUptimeTooltip(e, $bar, index, $bars.length));
      $bar.addEventListener('mouseleave', hideUptimeTooltip);
      $bar.addEventListener('mousemove', moveUptimeTooltip);
    });
  });
}

// Show uptime tooltip
function showUptimeTooltip(e, $bar, index, totalDays) {
  // Get the actual day number from data attribute (1-90)
  const dayNumber = parseInt($bar.dataset.day, 10) || (index + 1);

  // Calculate days ago (day 1 = 89 days ago, day 90 = today)
  const daysAgo = totalDays - dayNumber;
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);

  // Get status from the bar's Bootstrap bg-* class
  let status = 'operational';
  if ($bar.classList.contains('bg-warning')) {
    status = 'degraded';
  } else if ($bar.classList.contains('bg-danger')) {
    status = 'major';
  } else if ($bar.classList.contains('bg-info')) {
    status = 'maintenance';
  }

  // Get uptime data if available
  const uptime = $bar.dataset.uptime || '100%';

  // Create tooltip
  let $tooltip = document.querySelector('.uptime-tooltip');
  if (!$tooltip) {
    $tooltip = document.createElement('div');
    $tooltip.className = 'uptime-tooltip rounded-3 p-2 small';
    document.body.appendChild($tooltip);
  }

  // Format date
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  $tooltip.innerHTML = `
    <div class="fw-semibold mb-1">${webManager.utilities().escapeHTML(dateStr)}</div>
    <div class="d-flex align-items-center gap-2">
      <span class="status-dot rounded-circle ${config.statusClasses[status]}"></span>
      <span>${webManager.utilities().escapeHTML(config.statusLabels[status])}</span>
    </div>
    <div class="text-muted small">Uptime: ${webManager.utilities().escapeHTML(uptime)}</div>
  `;

  $tooltip.style.display = 'block';
  positionTooltip(e, $tooltip);
}

// Hide uptime tooltip
function hideUptimeTooltip() {
  const $tooltip = document.querySelector('.uptime-tooltip');
  if ($tooltip) {
    $tooltip.style.display = 'none';
  }
}

// Move uptime tooltip with cursor
function moveUptimeTooltip(e) {
  const $tooltip = document.querySelector('.uptime-tooltip');
  if ($tooltip) {
    positionTooltip(e, $tooltip);
  }
}

// Position tooltip near cursor
function positionTooltip(e, $tooltip) {
  const padding = 10;
  const tooltipRect = $tooltip.getBoundingClientRect();

  let left = e.clientX + padding;
  let top = e.clientY - tooltipRect.height - padding;

  // Keep tooltip within viewport
  if (left + tooltipRect.width > window.innerWidth) {
    left = e.clientX - tooltipRect.width - padding;
  }

  if (top < 0) {
    top = e.clientY + padding;
  }

  $tooltip.style.left = `${left}px`;
  $tooltip.style.top = `${top}px`;
}

// Initialize subscribe form
function initializeSubscribeForm() {
  const $form = document.querySelector(config.selectors.subscribeForm);

  if (!$form) {
    return;
  }

  const formManager = new FormManager($form, {
    submittedText: 'Subscribed!',
    allowResubmit: false,
  });

  formManager.on('submit', async () => {
    // Track subscription
    trackStatusSubscribe();

    // Here you would typically send to your backend
    // For now, we'll simulate a successful subscription
    await simulateApiCall();

    formManager.showSuccess('You\'ve been subscribed to status updates!');
  });
}

// Initialize Bootstrap tooltips
function initializeTooltips() {
  const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
  tooltipTriggerList.forEach(tooltipTriggerEl => {
    new bootstrap.Tooltip(tooltipTriggerEl);
  });
}

// Initialize refresh timer - counts up every second, resets every 60 seconds
function initializeRefreshTimer() {
  const $timer = document.querySelector('#status-refresh-timer');

  if (!$timer) {
    return;
  }

  let seconds = 0;

  setInterval(() => {
    seconds++;

    // Reset and refresh data every 60 seconds
    if (seconds >= 60) {
      seconds = 0;
      fetchStatusData();
    }

    $timer.textContent = seconds;
  }, 1000);
}

// Initialize build info section
async function initializeBuildInfo() {
  const $loading = document.querySelector(config.selectors.buildInfoLoading);
  const $content = document.querySelector(config.selectors.buildInfoContent);
  const $error = document.querySelector(config.selectors.buildInfoError);

  if (!$loading || !$content) {
    return;
  }

  try {
    // Fetch build.json
    const data = await fetch(`${window.location.origin}/build.json`, {
      response: 'json',
    });

    console.log('Build info data:', data);

    // Normalize the data structure
    const buildData = {
      timestamp: data.timestamp || null,
      environment: data.environment || (data.serving ? 'development' : 'production'),
      packages: data.packages || null,
      repo: data.repo || null,
    };

    // Test older dates
    // buildData.timestamp = Date.now() - 1000 * 60 * 60 * 24 * 7;

    displayBuildInfo(buildData);
    $loading.classList.add('d-none');
    $content.classList.remove('d-none');
  } catch (error) {
    console.error('Failed to load build info:', error);
    $loading.classList.add('d-none');
    if ($error) {
      $error.classList.remove('d-none');
    }
  }
}

// Display build information
function displayBuildInfo(data) {
  const $time = document.querySelector(config.selectors.buildTime);
  const $timeAgo = document.querySelector(config.selectors.buildTimeAgo);
  const $environment = document.querySelector(config.selectors.buildEnvironment);
  const $packages = document.querySelector(config.selectors.buildPackages);
  const $repo = document.querySelector(config.selectors.buildRepo);

  // Build time
  if ($time && data.timestamp) {
    const buildDate = new Date(data.timestamp);
    $time.textContent = buildDate.toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  // Time ago (and keep it updated every second)
  if ($timeAgo && data.timestamp) {
    updateTimeAgo($timeAgo, data.timestamp);
    setInterval(() => updateTimeAgo($timeAgo, data.timestamp), 1000);
  }

  // Environment
  if ($environment && data.environment) {
    const envText = data.environment.charAt(0).toUpperCase() + data.environment.slice(1);
    const envClass = data.environment === 'production' ? 'text-success' : 'text-warning';
    $environment.innerHTML = `<span class="${envClass}">${webManager.utilities().escapeHTML(envText)}</span>`;
  }

  // Packages
  if ($packages && data.packages) {
    const packageBadges = Object.entries(data.packages)
      .map(([name, version]) => {
        return `<span class="badge bg-body-secondary text-body fw-normal">${webManager.utilities().escapeHTML(name)}: <span class="fw-semibold">${webManager.utilities().escapeHTML(version)}</span></span>`;
      })
      .join('');
    $packages.innerHTML = packageBadges;
  }

  // Repository
  if ($repo && data.repo) {
    const repoUrl = `https://github.com/${encodeURIComponent(data.repo.user)}/${encodeURIComponent(data.repo.name)}`;
    $repo.innerHTML = `<a href="${webManager.utilities().escapeHTML(repoUrl)}" target="_blank" rel="noopener noreferrer" class="text-decoration-none">${webManager.utilities().escapeHTML(data.repo.user)}/${webManager.utilities().escapeHTML(data.repo.name)}</a>`;
  }
}

// Update relative time display
function updateTimeAgo($element, timestamp) {
  const buildDate = new Date(timestamp);
  const now = new Date();
  const diffMs = now - buildDate;
  const totalSeconds = Math.floor(diffMs / 1000);

  if (totalSeconds <= 0) {
    $element.textContent = '(Just now)';
    return;
  }

  // Calculate each unit
  const years = Math.floor(totalSeconds / (365 * 24 * 60 * 60));
  const months = Math.floor((totalSeconds % (365 * 24 * 60 * 60)) / (30 * 24 * 60 * 60));
  const days = Math.floor((totalSeconds % (30 * 24 * 60 * 60)) / (24 * 60 * 60));
  const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
  const seconds = totalSeconds % 60;

  // Build parts - once we start, include all remaining units
  const parts = [];
  let started = false;

  if (years > 0) {
    parts.push(`${years}y`);
    started = true;
  }
  if (started || months > 0) {
    parts.push(`${months}mo`);
    started = true;
  }
  if (started || days > 0) {
    parts.push(`${days}d`);
    started = true;
  }
  if (started || hours > 0) {
    parts.push(`${hours}h`);
    started = true;
  }
  if (started || minutes > 0) {
    parts.push(`${minutes}m`);
    started = true;
  }
  parts.push(`${seconds}s`);

  $element.textContent = '(' + parts.join(' ') + ' ago)';
}

// Fetch status data from API (if configured)
function fetchStatusData() {
  // Check if there's a status API endpoint configured
  const statusApiUrl = window.statusConfig?.apiUrl;

  if (!statusApiUrl) {
    // No API configured, use static data
    return;
  }

  // Fetch from API
  fetch(statusApiUrl)
    .then(response => response.json())
    .then(data => {
      updateStatusDisplay(data);
    })
    .catch(error => {
      console.warn('Failed to fetch status data:', error);
    });
}

// Update status display with fetched data
function updateStatusDisplay(data) {
  // Update overall status
  if (data.overall) {
    updateOverallStatus(data.overall);
  }

  // Update individual services
  if (data.services) {
    updateServices(data.services);
  }

  // Update maintenance items
  if (data.maintenance) {
    updateMaintenance(data.maintenance);
  }

  // Update incidents
  if (data.incidents) {
    updateIncidents(data.incidents);
  }
}

// Update overall status banner
function updateOverallStatus(status) {
  const $banner = document.querySelector(config.selectors.statusBanner);
  const $text = document.querySelector(config.selectors.statusText);

  if (!$banner || !$text) {
    return;
  }

  // Remove all status classes
  Object.values(config.statusClasses).forEach(cls => {
    $banner.classList.remove(cls);
  });

  // Add new status class
  $banner.classList.add(config.statusClasses[status.level] || config.statusClasses.operational);

  // Update text
  $text.textContent = status.message || config.statusLabels[status.level];
}

// Update individual service statuses
function updateServices(services) {
  services.forEach(service => {
    const $serviceItem = document.querySelector(`[data-service-id="${service.id}"]`);

    if (!$serviceItem) {
      return;
    }

    // Update status dot
    const $statusDot = $serviceItem.querySelector('[data-service-status]');
    if ($statusDot) {
      Object.values(config.statusClasses).forEach(cls => {
        $statusDot.classList.remove(cls);
      });
      $statusDot.classList.add(config.statusClasses[service.status] || config.statusClasses.operational);
    }

    // Update uptime percentage
    const $uptime = $serviceItem.querySelector('[data-service-uptime]');
    if ($uptime && service.uptime !== undefined) {
      $uptime.textContent = `${service.uptime}%`;
    }

    // Update uptime bars if provided
    if (service.history) {
      updateUptimeBars($serviceItem, service.history);
    }
  });
}

// Update uptime bars for a service
function updateUptimeBars($serviceItem, history) {
  const $bars = $serviceItem.querySelectorAll('.uptime-bar');

  history.forEach((day, index) => {
    const $bar = $bars[index];

    if (!$bar) {
      return;
    }

    // Remove all status classes
    Object.values(config.statusClasses).forEach(cls => {
      $bar.classList.remove(cls);
    });

    // Add new status class
    $bar.classList.add(config.statusClasses[day.status] || config.statusClasses.operational);

    // Store uptime data
    if (day.uptime !== undefined) {
      $bar.dataset.uptime = `${day.uptime}%`;
    }
  });
}

// Update maintenance section
function updateMaintenance(maintenanceItems) {
  const $list = document.querySelector(config.selectors.maintenanceList);
  const $empty = document.querySelector(config.selectors.maintenanceEmpty);

  if (!$list) {
    return;
  }

  if (!maintenanceItems || maintenanceItems.length === 0) {
    if ($empty) {
      $empty.style.display = 'block';
    }
    return;
  }

  // Hide empty state
  if ($empty) {
    $empty.style.display = 'none';
  }

  // Build maintenance cards
  const html = maintenanceItems.map(item => `
    <div class="card maintenance-card border-0 bg-body-tertiary mb-3 border-info">
      <div class="card-body p-4">
        <div class="d-flex justify-content-between align-items-start mb-2">
          <h4 class="h5 fw-semibold mb-0">${webManager.utilities().escapeHTML(item.title)}</h4>
          <span class="text-muted small">${webManager.utilities().escapeHTML(formatDate(item.scheduled_for))}</span>
        </div>
        <p class="text-muted mb-0">${webManager.utilities().escapeHTML(item.description)}</p>
        ${item.affected_services ? `
          <div class="mt-2">
            <small class="text-muted">
              <strong>Affected:</strong> ${item.affected_services.map(s => webManager.utilities().escapeHTML(s)).join(', ')}
            </small>
          </div>
        ` : ''}
      </div>
    </div>
  `).join('');

  // Insert before empty state
  if ($empty) {
    $empty.insertAdjacentHTML('beforebegin', html);
  } else {
    $list.innerHTML = html;
  }
}

// Update incidents section
function updateIncidents(incidents) {
  const $list = document.querySelector(config.selectors.incidentsList);
  const $empty = document.querySelector(config.selectors.incidentsEmpty);

  if (!$list) {
    return;
  }

  if (!incidents || incidents.length === 0) {
    if ($empty) {
      $empty.style.display = 'block';
    }
    return;
  }

  // Hide empty state
  if ($empty) {
    $empty.style.display = 'none';
  }

  // Build incident cards
  const html = incidents.map(incident => `
    <div class="card incident-card border-0 bg-body-tertiary mb-3 ${config.borderClasses[incident.status] || ''}">
      <div class="card-body p-4">
        <div class="d-flex justify-content-between align-items-start mb-2 flex-wrap gap-2">
          <h4 class="h5 fw-semibold mb-0">${webManager.utilities().escapeHTML(incident.title)}</h4>
          <div class="d-flex align-items-center gap-2">
            <span class="badge ${getIncidentBadgeClasses(incident.status)}">${webManager.utilities().escapeHTML(formatIncidentStatus(incident.status))}</span>
            <span class="text-muted small">${webManager.utilities().escapeHTML(formatDate(incident.created_at))}</span>
          </div>
        </div>
        ${incident.updates && incident.updates.length > 0 ? `
          <div class="incident-timeline mt-3">
            ${incident.updates.map(update => `
              <div class="timeline-item pb-3" data-status="${webManager.utilities().escapeHTML(config.dataStatusMap[update.status] || '')}">
                <div class="small text-muted mb-1">${webManager.utilities().escapeHTML(formatDateTime(update.created_at))}</div>
                <div class="small">${webManager.utilities().escapeHTML(update.message)}</div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    </div>
  `).join('');

  // Insert before empty state
  if ($empty) {
    $empty.insertAdjacentHTML('beforebegin', html);
  } else {
    $list.innerHTML = html;
  }
}

// Tracking functions
function trackStatusSubscribe() {
  gtag('event', 'status_subscribe', {
    method: 'email'
  });
  fbq('track', 'Lead', {
    content_name: 'Status Updates',
    content_category: 'subscription'
  });
  ttq.track('SubmitForm', {
    content_id: 'status-subscribe',
    content_type: 'product',
    content_name: 'Status Subscription'
  });
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatDateTime(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function formatIncidentStatus(status) {
  const statusLabels = {
    investigating: 'Investigating',
    identified: 'Identified',
    monitoring: 'Monitoring',
    resolved: 'Resolved'
  };
  return statusLabels[status] || status;
}

function getIncidentBadgeClasses(status) {
  const badgeClasses = {
    investigating: 'bg-warning-subtle text-warning',
    identified: 'bg-danger-subtle text-danger',
    monitoring: 'bg-info-subtle text-info',
    resolved: 'bg-success-subtle text-success'
  };
  return badgeClasses[status] || 'bg-secondary-subtle text-secondary';
}

function simulateApiCall() {
  return new Promise(resolve => setTimeout(resolve, 1000));
}
