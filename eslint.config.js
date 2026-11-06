// Only rules that catch real bugs; a duplicate key once replaced the preload's window focus
// with the focus-block call, so opening chat ended a focus block.
export default [
  { ignores: ["dist/**", "release/**", "sim/**", "state/**", "private/**"] },
  {
    files: ["**/*.js", "**/*.cjs"],
    languageOptions: { ecmaVersion: "latest" },
    rules: { "no-dupe-keys": "error", "no-duplicate-case": "error" },
  },
  { files: ["**/*.cjs"], languageOptions: { sourceType: "commonjs" } },
  { files: ["electron/settings.js", "electron/welcome.js", "electron/keyprompt.js"], languageOptions: { sourceType: "script" } },
];
