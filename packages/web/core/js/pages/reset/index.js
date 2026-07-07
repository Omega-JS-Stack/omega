// Libraries
import authPages from '__main_assets__/js/libs/auth.js';

// Module
export default () => {
  return new Promise(async function (resolve, reject) {
    await authPages();

    // Resolve
    return resolve();
  });
}
