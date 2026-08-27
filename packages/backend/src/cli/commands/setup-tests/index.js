/**
 * Test Registry
 * Manages the order and execution of all setup tests
 */

const { isCustomProject, FIREBASE_ONLY_SETUP_CHECKS } = require('../../utils/project-type');

// Import all test classes in the order they should run
const IsFirebaseProjectTest = require('./is-firebase-project');
const NodeVersionTest = require('./node-version');
const NvmrcVersionTest = require('./nvmrc-version');
const FirebaseCLITest = require('./firebase-cli');
const FirebaseAuthTest = require('./firebase-auth');
const JavaInstalledTest = require('./java-installed');
const GcloudCliTest = require('./gcloud-cli');
const FunctionsPackageTest = require('./functions-package');
const FirebaseAdminTest = require('./firebase-admin');
const FirebaseFunctionsTest = require('./firebase-functions');
const OmegaBackendTest = require('./omega-backend');
const NpmProjectScriptsTest = require('./npm-project-scripts');
const OmegaConfigTest = require('./omega-config');
const ProjectIdConsistencyTest = require('./project-id-consistency');
const ServiceAccountTest = require('./service-account');
const GitignoreTest = require('./gitignore');
const EnvFileTest = require('./env-file');
const EnvRuntimeConfigDeprecatedTest = require('./env-runtime-config-deprecated');
const FirestoreRulesInJsonTest = require('./firestore-rules-in-json');
const FirestoreIndexesInJsonTest = require('./firestore-indexes-in-json');
const RealtimeRulesInJsonTest = require('./realtime-rules-in-json');
const StorageRulesInJsonTest = require('./storage-rules-in-json');
const RemoteconfigTemplateInJsonTest = require('./remoteconfig-template-in-json');
const EmulatorConfigTest = require('./emulator-config');
const HostingRewritesTest = require('./hosting-rewrites');
const FirestoreIndexesSyncedTest = require('./firestore-indexes-synced');
const StorageLifecyclePolicyTest = require('./storage-lifecycle-policy');
const FirestoreRulesFileTest = require('./firestore-rules-file');
const FirestoreIndexesFileTest = require('./firestore-indexes-file');
const RealtimeRulesFileTest = require('./realtime-rules-file');
const StorageRulesFileTest = require('./storage-rules-file');
const RemoteconfigTemplateFileTest = require('./remoteconfig-template-file');
const HostingFolderTest = require('./hosting-folder');
const PublicHtmlFilesTest = require('./public-html-files');
const FirestoreIndexesRequiredTest = require('./firestore-indexes-required');
const ProjectDirectoriesTest = require('./project-directories');
const LegacyTestsCleanupTest = require('./legacy-tests-cleanup');
const MarketingCampaignsSeededTest = require('./marketing-campaigns-seeded');

// The checks a custom-server target skips whole (#614) — the mode table names
// them, this resolves each name to the class the list below instantiates.
const FIREBASE_ONLY_CLASSES = new Set(FIREBASE_ONLY_SETUP_CHECKS.map((name) => require(`./${name}`)));

/**
 * Get all tests in the order they should run
 *
 * A custom-server backend (#584) has no Cloud Functions deploy and no
 * emulator, so the checks that scaffold and maintain the Firebase-only
 * artifacts are not part of its setup at all.
 *
 * @param {Object} context - The test context containing main and other dependencies
 * @returns {Array} Array of test instances
 */
function getTests(context) {
  const tests = [
    new IsFirebaseProjectTest(context),
    new NodeVersionTest(context),
    new NvmrcVersionTest(context),
    new FirebaseCLITest(context),
    new FirebaseAuthTest(context),
    new JavaInstalledTest(context),
    new GcloudCliTest(context),
    new FunctionsPackageTest(context),
    new FirebaseAdminTest(context),
    new FirebaseFunctionsTest(context),
    new OmegaBackendTest(context),
    new NpmProjectScriptsTest(context),
    new OmegaConfigTest(context),
    new ServiceAccountTest(context),
    new ProjectIdConsistencyTest(context),
    new GitignoreTest(context),
    new EnvFileTest(context),
    new EnvRuntimeConfigDeprecatedTest(context),
    new FirestoreRulesInJsonTest(context),
    new FirestoreIndexesInJsonTest(context),
    new RealtimeRulesInJsonTest(context),
    new StorageRulesInJsonTest(context),
    new RemoteconfigTemplateInJsonTest(context),
    new EmulatorConfigTest(context),
    new HostingRewritesTest(context),
    new StorageLifecyclePolicyTest(context),
    new FirestoreRulesFileTest(context),
    new FirestoreIndexesFileTest(context),
    new FirestoreIndexesRequiredTest(context),
    new FirestoreIndexesSyncedTest(context),
    new RealtimeRulesFileTest(context),
    new StorageRulesFileTest(context),
    new RemoteconfigTemplateFileTest(context),
    new HostingFolderTest(context),
    new PublicHtmlFilesTest(context),
    new ProjectDirectoriesTest(context),
    new LegacyTestsCleanupTest(context),
    new MarketingCampaignsSeededTest(context),
  ];

  if (!isCustomProject(context.main.firebaseProjectPath)) {
    return tests;
  }

  return tests.filter((test) => !FIREBASE_ONLY_CLASSES.has(test.constructor));
}

module.exports = {
  getTests,
};
