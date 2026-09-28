// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // dist: web export output. .expo: generated types (typed routes).
    ignores: ['dist/*', '.expo/*'],
  },
]);
