// Referrals section module
import webManager from 'web-manager';

// Initialize referrals section
export function init() {
  setupButtons();
}

// Load referrals data
export function loadData(account) {
  if (!account) return;

  // Update referral code (real code only)
  updateReferralCode(account.affiliate?.code);

  // Update referrals list
  updateReferralsList(account.affiliate?.referrals);
}

// Update referral code display
function updateReferralCode(code) {
  const $codeInput = document.getElementById('referral-code-input');

  if ($codeInput) {
    if (code) {
      const baseUrl = window.location.origin;
      $codeInput.value = `${baseUrl}?ref=${code}`;
    } else {
      $codeInput.value = 'No referral link available';
    }
  }
}

// Update referrals list
function updateReferralsList(referrals) {
  const $totalReferrals = document.getElementById('total-referrals');
  const $recentReferrals = document.getElementById('recent-referrals');
  const $referralsBadge = document.getElementById('referrals-badge');
  const $referralsList = document.getElementById('referrals-list');

  // Initialize referrals array
  let referralData = referrals || [];

  // Add fake data if _dev_prefill=true is in query string
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('_dev_prefill') === 'true') {
    console.log('Adding fake referral data for testing');
    const fakeReferrals = generateFakeReferrals();
    // Add fake referrals to existing data
    referralData = [...referralData, ...fakeReferrals];
  }

  // Handle empty state
  if (!referralData || !Array.isArray(referralData) || referralData.length === 0) {
    // No referrals - show empty state
    if ($totalReferrals) $totalReferrals.textContent = '0';
    if ($recentReferrals) $recentReferrals.textContent = '0';
    if ($referralsBadge) $referralsBadge.textContent = '0';
    if ($referralsList) {
      $referralsList.innerHTML = `
        <div class="text-center text-muted py-3">
          No referrals yet. Share your code to get started!
        </div>
      `;
    }
    return;
  }

  // Calculate stats
  const totalCount = referralData.length;
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const recentCount = referralData.filter(ref => {
    const timestamp = ref.timestamp || ref.timestampUNIX * 1000;
    return timestamp >= thisMonth;
  }).length;

  // Update stats
  if ($totalReferrals) $totalReferrals.textContent = totalCount.toString();
  if ($recentReferrals) $recentReferrals.textContent = recentCount.toString();
  if ($referralsBadge) $referralsBadge.textContent = totalCount.toString();

  // Sort referrals by timestamp in reverse order (newest first)
  const sortedReferrals = [...referralData].sort((a, b) => {
    const timeA = a.timestamp || (a.timestampUNIX * 1000) || 0;
    const timeB = b.timestamp || (b.timestampUNIX * 1000) || 0;
    return timeB - timeA; // Reverse order
  });

  // Generate referral list HTML
  if ($referralsList) {
    if (sortedReferrals.length === 0) {
      $referralsList.innerHTML = `
        <div class="text-center text-muted py-3">
          No referrals yet. Share your code to get started!
        </div>
      `;
    } else {
      const referralHTML = sortedReferrals.map((referral, index) => {
        const timestamp = referral.timestamp || (referral.timestampUNIX * 1000);
        const date = timestamp ? new Date(timestamp) : null;
        const dateStr = date ? formatDate(date) : 'Unknown date';
        const timeStr = date ? formatTime(date) : '';

        return `
          <div class="list-group-item px-0">
            <div class="d-flex justify-content-between align-items-center">
              <div>
                <div class="d-flex align-items-center">
                  <span class="badge bg-secondary me-2">#${sortedReferrals.length - index}</span>
                  <div>
                    <strong class="font-monospace small">${webManager.utilities().escapeHTML(referral.uid || 'Unknown User')}</strong>
                    <div class="text-muted small">${webManager.utilities().escapeHTML(dateStr)}${timeStr ? ` at ${webManager.utilities().escapeHTML(timeStr)}` : ''}</div>
                  </div>
                </div>
              </div>
              <div class="text-end">
                <small class="text-muted">${webManager.utilities().escapeHTML(getTimeSince(timestamp))}</small>
              </div>
            </div>
          </div>
        `;
      }).join('');

      $referralsList.innerHTML = referralHTML;
    }
  }
}

// Format date
function formatDate(date) {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

// Format time
function formatTime(date) {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Get time since string
function getTimeSince(timestamp) {
  if (!timestamp) return 'Unknown';

  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) return 'Just now';

  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes} min${minutes > 1 ? 's' : ''} ago`;
  }

  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  }

  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }

  if (diff < 2592000000) {
    const weeks = Math.floor(diff / 604800000);
    return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  }

  const months = Math.floor(diff / 2592000000);
  if (months < 12) {
    return `${months} month${months > 1 ? 's' : ''} ago`;
  }

  const years = Math.floor(months / 12);
  return `${years} year${years > 1 ? 's' : ''} ago`;
}

// Setup button handlers
function setupButtons() {
  // Copy referral code button
  const $copyBtn = document.getElementById('copy-referral-code-btn');
  if ($copyBtn) {
    $copyBtn.addEventListener('click', handleCopyReferralCode);
  }
}

// Handle copy referral code
async function handleCopyReferralCode() {
  const $codeInput = document.getElementById('referral-code-input');
  const $copyBtn = document.getElementById('copy-referral-code-btn');

  if (!$codeInput || !$codeInput.value || $codeInput.value === 'No referral link available') {
    webManager.utilities().showNotification('No referral link to copy', 'warning');
    return;
  }

  try {
    // Copy the full URL directly from the input (it now contains the full URL)
    await webManager.utilities().clipboardCopy($codeInput);

    // Update button text temporarily
    const $text = $copyBtn.querySelector('.button-text');
    const originalText = $text.textContent;

    $text.textContent = 'Copied!';
    $copyBtn.classList.remove('btn-primary');
    $copyBtn.classList.add('btn-success');

    // Reset after 2 seconds
    setTimeout(() => {
      $text.textContent = originalText;
      $copyBtn.classList.remove('btn-success');
      $copyBtn.classList.add('btn-primary');
    }, 2000);

  } catch (err) {
    console.error('Failed to copy referral link:', err);
    webManager.utilities().showNotification('Failed to copy referral link', 'danger');
  }
}

// Generate fake referrals for demo
function generateFakeReferrals() {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;

  return [
    {
      uid: 'user_k9m2n8p4q1r7',
      timestamp: now - (2 * 60 * 60 * 1000), // 2 hours ago
      timestampUNIX: Math.floor((now - (2 * 60 * 60 * 1000)) / 1000)
    },
    {
      uid: 'user_x3y7z2a5b9c6',
      timestamp: now - (8 * 60 * 60 * 1000), // 8 hours ago
      timestampUNIX: Math.floor((now - (8 * 60 * 60 * 1000)) / 1000)
    },
    {
      uid: 'user_t4u8i2o6p1a5',
      timestamp: now - (oneDay), // 1 day ago
      timestampUNIX: Math.floor((now - oneDay) / 1000)
    },
    {
      uid: 'user_f7g1h5j9k3l8',
      timestamp: now - (3 * oneDay), // 3 days ago
      timestampUNIX: Math.floor((now - (3 * oneDay)) / 1000)
    },
    {
      uid: 'user_q2w6e1r5t9y4',
      timestamp: now - (7 * oneDay), // 1 week ago
      timestampUNIX: Math.floor((now - (7 * oneDay)) / 1000)
    },
    {
      uid: 'user_m8n2b6v1c5x9',
      timestamp: now - (14 * oneDay), // 2 weeks ago
      timestampUNIX: Math.floor((now - (14 * oneDay)) / 1000)
    },
    {
      uid: 'user_a3s7d1f5g9h4',
      timestamp: now - (25 * oneDay), // 25 days ago
      timestampUNIX: Math.floor((now - (25 * oneDay)) / 1000)
    },
    {
      uid: 'user_z9x5c1v7b3n8',
      timestamp: now - (35 * oneDay), // 35 days ago
      timestampUNIX: Math.floor((now - (35 * oneDay)) / 1000)
    },
    {
      uid: 'user_p6o2i8u4y1t5',
      timestamp: now - (45 * oneDay), // 45 days ago
      timestampUNIX: Math.floor((now - (45 * oneDay)) / 1000)
    },
    {
      uid: 'user_l1k9j7h5g3f2',
      timestamp: now - (60 * oneDay), // 2 months ago
      timestampUNIX: Math.floor((now - (60 * oneDay)) / 1000)
    },
    {
      uid: 'user_e4r8t2y6u1i5',
      timestamp: now - (90 * oneDay), // 3 months ago
      timestampUNIX: Math.floor((now - (90 * oneDay)) / 1000)
    },
    {
      uid: 'user_w7q1a5s9d3f6',
      timestamp: now - (120 * oneDay), // 4 months ago
      timestampUNIX: Math.floor((now - (120 * oneDay)) / 1000)
    }
  ];
}

