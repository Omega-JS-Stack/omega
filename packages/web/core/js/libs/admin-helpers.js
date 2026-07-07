/**
 * Shared Admin Page Helpers
 */

export function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return 'Just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }
  if (days < 30) {
    return `${days}d ago`;
  }

  return new Date(timestamp).toLocaleDateString();
}

export function capitalize(str) {
  if (!str) {
    return '';
  }
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function setStatValue(id, result) {
  const $el = document.getElementById(id);
  if (!$el) {
    return;
  }

  if (result.status === 'fulfilled') {
    $el.textContent = result.value.data().count.toLocaleString();
  } else {
    $el.innerHTML = '<span class="text-danger small">Error</span>';
    console.error(`Failed to load ${id}:`, result.reason);
  }
}

export function setStatSubValue(id, result, label) {
  const $el = document.getElementById(id);
  if (!$el) {
    return;
  }

  if (result.status === 'fulfilled') {
    const count = result.value.data().count;
    $el.textContent = `+${count.toLocaleString()} ${label}`;
    $el.classList.add('text-success');
    $el.classList.remove('text-muted');
  }
}
