// Team section module
import webManager from 'web-manager';

// Initialize team section
export function init() {
  setupButtons();
}

// Load team data
export function loadData(account) {
  if (!account) return;

  // Update members list
  updateMembersList(account.team?.members || []);

  // Update invite status
  updateInviteStatus(account.team?.invites || []);
}

// Update team members list
function updateMembersList(members) {
  const $membersList = document.getElementById('team-list');
  if (!$membersList) return;

  // Always include current user as owner
  const currentUser = webManager.auth().getUser();
  const allMembers = [
    {
      id: currentUser?.uid,
      email: currentUser?.email,
      name: 'You',
      role: 'owner',
      status: 'active',
      joinedAt: Date.now()
    },
    ...members
  ];

  // Generate members HTML
  const membersHTML = allMembers.map(member => `
    <div class="list-group-item">
      <div class="d-flex justify-content-between align-items-center">
        <div>
          <strong>${webManager.utilities().escapeHTML(member.name || member.email)}</strong>
          ${member.role === 'owner' ? '' : `<small class="text-muted d-block">${webManager.utilities().escapeHTML(member.email)}</small>`}
          <small class="text-muted">${getRoleLabel(member.role)}</small>
        </div>
        <div class="d-flex align-items-center">
          <span class="badge bg-${getRoleBadgeColor(member.role)} me-2">${getRoleLabel(member.role)}</span>
          ${member.role !== 'owner' ? getActionButtons(member) : ''}
        </div>
      </div>
    </div>
  `).join('');

  $membersList.innerHTML = membersHTML || '<p class="text-muted">No team members yet.</p>';
}

// Update invite status
function updateInviteStatus(invites) {
  const $invitesList = document.getElementById('pending-invites');
  if (!$invitesList || invites.length === 0) return;

  const invitesHTML = invites.map(invite => `
    <div class="list-group-item">
      <div class="d-flex justify-content-between align-items-center">
        <div>
          <strong>${webManager.utilities().escapeHTML(invite.email)}</strong>
          <small class="text-muted d-block">Invited ${webManager.utilities().escapeHTML(formatDate(invite.invitedAt))}</small>
        </div>
        <div>
          <button class="btn btn-sm btn-outline-danger" data-action="cancel-invite" data-invite-id="${webManager.utilities().escapeHTML(invite.id)}">
            Cancel Invite
          </button>
        </div>
      </div>
    </div>
  `).join('');

  $invitesList.innerHTML = invitesHTML;
}

// Get role label
function getRoleLabel(role) {
  const labels = {
    owner: 'Owner',
    admin: 'Admin',
    member: 'Member',
    viewer: 'Viewer'
  };
  return labels[role] || 'Member';
}

// Get role badge color
function getRoleBadgeColor(role) {
  const colors = {
    owner: 'primary',
    admin: 'success',
    member: 'secondary',
    viewer: 'light'
  };
  return colors[role] || 'secondary';
}

// Get action buttons for member
function getActionButtons(member) {
  if (member.status === 'pending') {
    return `
      <button class="btn btn-sm btn-outline-secondary" disabled>
        Pending
      </button>
    `;
  }

  return `
    <div class="dropdown">
      <button class="btn btn-sm btn-outline-secondary dropdown-toggle" type="button" data-bs-toggle="dropdown">
        Actions
      </button>
      <ul class="dropdown-menu">
        <li><a class="dropdown-item" href="#" data-action="change-role" data-member="${webManager.utilities().escapeHTML(member.id)}">Change Role</a></li>
        <li><hr class="dropdown-divider"></li>
        <li><a class="dropdown-item text-danger" href="#" data-action="remove" data-member="${webManager.utilities().escapeHTML(member.id)}">Remove Team Member</a></li>
      </ul>
    </div>
  `;
}

// Setup button handlers
function setupButtons() {
  // Invite team member button
  const $inviteBtn = document.getElementById('invite-team-member-btn');
  if ($inviteBtn) {
    $inviteBtn.addEventListener('click', handleInviteMember);
  }

  // Setup dropdown actions
  document.addEventListener('click', (event) => {
    const action = event.target.dataset.action;
    const memberId = event.target.dataset.member;
    const inviteId = event.target.dataset.inviteId;

    if (action === 'cancel-invite' && inviteId) {
      event.preventDefault();
      cancelInvite(inviteId);
    } else if (action && memberId) {
      event.preventDefault();
      handleMemberAction(action, memberId);
    }
  });
}

// Handle invite team member
async function handleInviteMember() {
  const email = prompt('Enter the email address of the person you want to invite:');

  if (!email || !email.includes('@')) {
    return;
  }

  try {
    // Send invite
    // await webManager.team().inviteMember(email);
    console.log('Inviting member:', email);

    webManager.utilities().showNotification(`Invitation sent to ${email}`, 'success');
  } catch (error) {
    console.error('Failed to invite member:', error);
    webManager.utilities().showNotification('Failed to send invitation. Please try again.', 'danger');
  }
}

// Handle member action
async function handleMemberAction(action, memberId) {
  switch(action) {
    case 'change-role':
      handleChangeRole(memberId);
      break;
    case 'remove':
      handleRemoveMember(memberId);
      break;
  }
}

// Handle change role
async function handleChangeRole(memberId) {
  const newRole = prompt('Enter new role (admin, member, viewer):');

  if (!newRole || !['admin', 'member', 'viewer'].includes(newRole)) {
    return;
  }

  try {
    // Update member role
    // await webManager.team().updateMemberRole(memberId, newRole);
    console.log('Changing role for member:', memberId, 'to', newRole);

    webManager.utilities().showNotification('Member role updated successfully', 'success');
  } catch (error) {
    console.error('Failed to update member role:', error);
    webManager.utilities().showNotification('Failed to update member role. Please try again.', 'danger');
  }
}

// Handle remove member
async function handleRemoveMember(memberId) {
  if (!confirm('Are you sure you want to remove this member from your team?')) {
    return;
  }

  try {
    // Remove member
    // await webManager.team().removeMember(memberId);
    console.log('Removing member:', memberId);

    webManager.utilities().showNotification('Member removed successfully', 'success');
  } catch (error) {
    console.error('Failed to remove member:', error);
    webManager.utilities().showNotification('Failed to remove member. Please try again.', 'danger');
  }
}

// Handle cancel invite
async function cancelInvite(inviteId) {
  if (!confirm('Are you sure you want to cancel this invitation?')) {
    return;
  }

  try {
    // Cancel invite
    // await webManager.team().cancelInvite(inviteId);
    console.log('Cancelling invite:', inviteId);

    webManager.utilities().showNotification('Invitation cancelled', 'success');
  } catch (error) {
    console.error('Failed to cancel invite:', error);
    webManager.utilities().showNotification('Failed to cancel invitation. Please try again.', 'danger');
  }
}

// Format date helper
function formatDate(timestamp) {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp);
  return date.toLocaleDateString();
}

