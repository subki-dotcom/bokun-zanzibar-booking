module.exports = {
  env: {
    node: true,
    es2021: true,
    commonjs: true
  },
  extends: ["eslint:recommended", "plugin:node/recommended", "prettier"],
  parserOptions: {
    ecmaVersion: 2021
  },
  rules: {
    "no-console": "off",
    "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }]
  }
};
