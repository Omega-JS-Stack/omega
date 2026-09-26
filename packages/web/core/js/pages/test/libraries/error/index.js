/**
 * /test/libraries/error: the button signs in with bad credentials, so the
 * client's auth error path has a real failure to report.
 */

export default ({ omega }) => {
  const $trigger = document.getElementById('trigger-error');
  if (!$trigger) {
    return;
  }

  $trigger.addEventListener('click', () => {
    omega.auth.signInWithEmailAndPassword('invalid@example.com', 'wrongpassword');
  });
};
