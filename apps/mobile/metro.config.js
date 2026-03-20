const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);

config.resolver.blockList = [
  /node_modules\/\.pnpm\/electron@.*\/node_modules\/electron\/dist\/.*/,
];

module.exports = config;
