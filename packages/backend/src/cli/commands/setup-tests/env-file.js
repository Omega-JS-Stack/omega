const BaseTest = require('./base-test');
const jetpack = require('fs-jetpack');
const path = require('path');
const { mergeLineBasedFiles, hasSectionMarkers, DEFAULT_SECTION_MARKER } = require('./helpers/merge-line-files');

class EnvFileTest extends BaseTest {
  getName() {
    return 'has correct .env file';
  }

  async run() {
    // Authored home = the TARGET ROOT (src/dist pillar) — the stage step copies
    // it into functions/.env so the deploy artifact stays self-contained
    const envPath = `${this.self.firebaseProjectPath}/.env`;
    const existingContent = jetpack.read(envPath);

    if (!existingContent) {
      return false;
    }

    // Check if file has proper section markers
    if (!hasSectionMarkers(existingContent)) {
      return false;
    }

    // Get the template
    const templatePath = path.resolve(__dirname, '../../../defaults/_.env');
    const templateContent = jetpack.read(templatePath);

    if (!templateContent) {
      throw new Error('Could not read .env template file');
    }

    // Extract default sections and compare keys
    const existingDefaults = this.extractDefaultSection(existingContent);
    const templateDefaults = this.extractDefaultSection(templateContent);

    // Check if all template default keys are present in existing defaults
    const templateKeys = this.extractEnvKeys(templateDefaults);
    const existingKeys = this.extractEnvKeys(existingDefaults);

    for (const key of templateKeys) {
      if (!existingKeys.includes(key)) {
        return false;
      }
    }

    return true;
  }

  extractDefaultSection(content) {
    const lines = content.split('\n');
    const defaultLines = [];
    let inDefaultSection = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === DEFAULT_SECTION_MARKER) {
        inDefaultSection = true;
        continue;
      }
      if (trimmed === '# ========== Custom Values ==========') {
        break;
      }

      if (inDefaultSection) {
        defaultLines.push(line);
      }
    }

    return defaultLines.join('\n');
  }

  extractEnvKeys(content) {
    return content
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => l.split('=')[0].trim())
      .filter(k => k);
  }

  async fix() {
    const envPath = `${this.self.firebaseProjectPath}/.env`;
    const templatePath = path.resolve(__dirname, '../../../defaults/_.env');

    const templateContent = jetpack.read(templatePath);
    if (!templateContent) {
      throw new Error('Could not read .env template file');
    }

    let existingContent = jetpack.read(envPath) || '';

    // A pre-pillar functions/.env is the same authored file in its old home —
    // adopt its content once, then the target root owns it (functions/ is staged)
    if (!existingContent) {
      existingContent = jetpack.read(`${this.self.firebaseProjectPath}/functions/.env`) || '';
    }

    // If file doesn't have section markers, treat existing content as custom values
    if (!hasSectionMarkers(existingContent)) {
      const customValues = existingContent.trim();
      existingContent = templateContent.replace(
        '# ...',
        customValues ? customValues + '\n# ...' : '# ...'
      );
    } else {
      // Smart merge
      existingContent = mergeLineBasedFiles(existingContent, templateContent, '.env');
    }

    jetpack.write(envPath, existingContent);
    this.restage();
  }
}

module.exports = EnvFileTest;