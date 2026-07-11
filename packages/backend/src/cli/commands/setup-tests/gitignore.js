const BaseTest = require('./base-test');
const jetpack = require('fs-jetpack');
const path = require('path');
const { mergeLineBasedFiles, hasSectionMarkers, DEFAULT_SECTION_MARKER, CUSTOM_SECTION_MARKER } = require('./helpers/merge-line-files');

class GitignoreTest extends BaseTest {
  getName() {
    return 'has correct .gitignore';
  }

  async run() {
    const gitignorePath = `${this.self.firebaseProjectPath}/.gitignore`;
    const oldGitignorePath = `${this.self.firebaseProjectPath}/functions/.gitignore`;
    const existingContent = jetpack.read(gitignorePath);

    // Check if old functions/.gitignore exists (should be removed)
    if (jetpack.exists(oldGitignorePath)) {
      return false;
    }

    if (!existingContent) {
      return false;
    }

    // Check if file has proper section markers
    if (!hasSectionMarkers(existingContent)) {
      return false;
    }

    // Get the template
    const templatePath = path.resolve(__dirname, '../../../defaults/_.gitignore');
    const templateContent = jetpack.read(templatePath);

    if (!templateContent) {
      throw new Error('Could not read .gitignore template file');
    }

    // Extract default sections and compare
    const existingDefaults = this.extractDefaultSection(existingContent);
    const templateDefaults = this.extractDefaultSection(templateContent);

    // Check if all template defaults are present in existing defaults
    const templateLines = templateDefaults
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));

    const existingLines = existingDefaults
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));

    for (const line of templateLines) {
      if (!existingLines.includes(line)) {
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
      if (trimmed === CUSTOM_SECTION_MARKER) {
        break;
      }

      if (inDefaultSection) {
        defaultLines.push(line);
      }
    }

    return defaultLines.join('\n');
  }

  async fix() {
    const gitignorePath = `${this.self.firebaseProjectPath}/.gitignore`;
    const oldGitignorePath = `${this.self.firebaseProjectPath}/functions/.gitignore`;
    const templatePath = path.resolve(__dirname, '../../../defaults/_.gitignore');

    const templateContent = jetpack.read(templatePath);
    if (!templateContent) {
      throw new Error('Could not read .gitignore template file');
    }

    // Remove old functions/.gitignore if it exists
    if (jetpack.exists(oldGitignorePath)) {
      jetpack.remove(oldGitignorePath);
    }

    let existingContent = jetpack.read(gitignorePath) || '';

    // Normalize runs of blank lines
    existingContent = existingContent.replace(/\n{3,}/g, '\n\n');

    // If file doesn't have section markers, treat existing content as custom values
    if (!hasSectionMarkers(existingContent)) {
      const customValues = existingContent.trim();
      existingContent = templateContent.replace(
        '# ...',
        customValues ? customValues + '\n# ...' : '# ...'
      );
    } else {
      // Smart merge
      existingContent = mergeLineBasedFiles(existingContent, templateContent, '.gitignore');
    }

    jetpack.write(gitignorePath, existingContent);
  }
}

module.exports = GitignoreTest;