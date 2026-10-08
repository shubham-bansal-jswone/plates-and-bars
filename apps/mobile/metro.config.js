// Metro must watch packages/core: it is linked into node_modules via file:../../packages/core,
// and its real path lies outside this project root.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const coreRoot = path.resolve(__dirname, '../../packages/core');

config.watchFolders = [...(config.watchFolders ?? []), coreRoot];
// Resolve dependencies of linked packages/core from this app's node_modules only.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
// expo-sqlite's web build imports a .wasm file.
config.resolver.assetExts.push('wasm');

// expo-sqlite on web runs SQLite in a worker and needs SharedArrayBuffer, which browsers only allow on
// cross-origin isolated pages. Expo's dev server serves the HTML before Metro's middleware runs, so
// `server.enhanceMiddleware` cannot reach it; this sets the headers on responses of the dev server process.
// TODO: drop this for `enhanceMiddleware` once Expo's middleware order lets it see the HTML.
// The production host sends the same headers from public/_headers.
if (!process.argv.includes('export')) {
  const http = require('http');
  const writeHead = http.ServerResponse.prototype.writeHead;
  http.ServerResponse.prototype.writeHead = function (...args) {
    if (!this.headersSent) {
      if (!this.hasHeader('Cross-Origin-Opener-Policy')) this.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      if (!this.hasHeader('Cross-Origin-Embedder-Policy')) this.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    }
    return writeHead.apply(this, args);
  };
}

module.exports = config;
