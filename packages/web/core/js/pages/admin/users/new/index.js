/**
 * Admin Create User Page JavaScript
 */

// Libraries
import { FormManager } from '@omega.js/client/modules/form-manager.js';
import omega from '@omega.js/client';

// State
let formManager = null;

// Module
export default () => {
  return new Promise(async function (resolve) {
    await omega.dom().ready();

    omega.auth().listen({ once: true }, async (state) => {
      if (!state.user) {
        return;
      }

      initForm();
    });

    return resolve();
  });
};

// Initialize FormManager
function initForm() {
  formManager = new FormManager('#create-user-form', {
    allowResubmit: false,
    submittingText: 'Creating...',
    submittedText: 'Created!',
  });

  formManager.on('validation', ({ data, setError }) => {
    if (data?.user?.password !== data?.user?.confirmPassword) {
      setError('user.confirmPassword', 'Passwords do not match');
    }
  });

  formManager.on('submit', async ({ data }) => {
    const email = data?.user?.email?.trim();
    const password = data?.user?.password;

    // Create Firebase Auth user via a temporary app to avoid signing out the current admin
    const { initializeApp, deleteApp } = await import('firebase/app');
    const { getAuth, createUserWithEmailAndPassword } = await import('firebase/auth');

    const tempApp = initializeApp(omega.firebaseApp.options, '_temp_create_user_');
    const tempAuth = getAuth(tempApp);

    try {
      const userCredential = await createUserWithEmailAndPassword(tempAuth, email, password);
      const uid = userCredential.user.uid;

      await tempAuth.signOut();

      formManager.showSuccess(`User created: ${email} (${uid})`);
    } finally {
      await deleteApp(tempApp);
    }
  });
}
