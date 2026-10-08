// Metro must watch packages/core: it is linked into node_modules via file:../../packages/core,
// and its real path lies outside this project root.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const coreRoot = path.resolve(__dirname, '../../packages/core');

config.watchFolders = [...(config.watchFolders ?? []), coreRoot];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
// expo-sqlite's web build imports a .wasm file.
config.resolver.assetExts.push('wasm');

module.exports = config;
