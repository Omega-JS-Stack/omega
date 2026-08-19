// Referrals section module
import omega from '@omega.js/client';

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

// When a referral happened, in milliseconds.
//
// A signup appends `{ uid, timestamp }` with an ISO STRING (@omega.js/backend
// routes/user/signup/post.js processAffiliate), so every read below has to go
// through a parse: comparing or subtracting that string produced NaN, and the
// whole list rendered as "NaN years ago" against real data (#343). Read once,
// here, and `timestampUNIX` still answers for a record that carries one.
function getReferralTime(referral) {
  const parsed = referral.timestamp ? new Date(referral.timestamp).getTime() : NaN;

  if (!Number.isNaN(parsed)) {
    return parsed;
  }

  return referral.timestampUNIX ? referral.timestampUNIX * 1000 : 0;
}

// Update referrals list
function updateReferralsList(referrals) {
  const $totalReferrals = document.getElementById('total-referrals');
  const $recentReferrals = document.getElementById('recent-referrals');
  const $referralsBadge = document.getElementById('referrals-badge');
  const $referralsList = document.getElementById('referrals-list');

  // Initialize referrals array
  const referralData = referrals || [];

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
  const recentCount = referralData.filter(ref => getReferralTime(ref) >= thisMonth).length;

  // Update stats
  if ($totalReferrals) $totalReferrals.textContent = totalCount.toString();
  if ($recentReferrals) $recentReferrals.textContent = recentCount.toString();
  if ($referralsBadge) $referralsBadge.textContent = totalCount.toString();

  // Sort referrals by timestamp in reverse order (newest first)
  const sortedReferrals = [...referralData].sort((a, b) => getReferralTime(b) - getReferralTime(a));

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
        const timestamp = getReferralTime(referral);
        const date = timestamp ? new Date(timestamp) : null;
        const dateStr = date ? formatDate(date) : 'Unknown date';
        const timeStr = date ? formatTime(date) : '';

        return `
          <div class="list-group-item px-0">
            <div class="d-flex justify-content-between align-items-center">
              <div>
                <div class="d-flex align-items-center">
                  <span class="omega-chip me-2">#${sortedReferrals.length - index}</span>
                  <div>
                    <strong class="font-monospace small">${omega.utilities().escapeHTML(referral.uid || 'Unknown User')}</strong>
                    <div class="text-muted small">${omega.utilities().escapeHTML(dateStr)}${timeStr ? ` at ${omega.utilities().escapeHTML(timeStr)}` : ''}</div>
                  </div>
                </div>
              </div>
              <div class="text-end">
                <small class="text-muted">${omega.utilities().escapeHTML(getTimeSince(timestamp))}</small>
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
    omega.utilities().showNotification('No referral link to copy', 'warning');
    return;
  }

  try {
    // Copy the full URL directly from the input (it now contains the full URL)
    await omega.utilities().clipboardCopy($codeInput);

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
    omega.utilities().showNotification('Failed to copy referral link', 'danger');
  }
}
