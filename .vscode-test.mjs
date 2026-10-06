// Tests that run inside VS Code: `npm run test:vscode`. They check the parts that need
// the real editor (problems in the text editor, reading folders, the canvas editor).
import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'test/vscode/**/*.vscode.js',
  // Other extensions would slow the run down and could add their own problems.
  launchArgs: ['--disable-extensions'],
  mocha: { ui: 'tdd', timeout: 30000 },
});
