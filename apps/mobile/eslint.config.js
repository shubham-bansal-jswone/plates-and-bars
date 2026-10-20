const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expo,
  { ignores: ['dist/*', '.expo/*', 'node_modules/*', 'public/tesseract/*'] /* vendored engine files, copied unmodified */ },
  // Jest setup files use the jest global (the tests get it from eslint-config-expo's test override).
  { files: ['jest/**/*.js'], languageOptions: { globals: { jest: 'readonly' } } },
]);
