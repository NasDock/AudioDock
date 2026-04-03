const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);

const workspaceRoot = path.resolve(__dirname, "../..");
const rootNodeModules = path.join(workspaceRoot, "node_modules");

config.resolver.blockList = [
  /node_modules\/\.pnpm\/electron@.*\/node_modules\/electron\/dist\/.*/,
];

config.resolver.nodeModulesPaths = [
  path.join(__dirname, "node_modules"),
  rootNodeModules,
];

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  react: path.join(rootNodeModules, "react"),
  "react/jsx-runtime": path.join(rootNodeModules, "react/jsx-runtime"),
  "react/jsx-dev-runtime": path.join(rootNodeModules, "react/jsx-dev-runtime"),
  "react-native": path.join(rootNodeModules, "react-native"),
};

module.exports = config;
