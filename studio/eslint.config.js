import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "studio-data/**", "e2e/output/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { "@typescript-eslint/consistent-type-imports": "error", "no-console": "error", "prefer-const": ["error", { destructuring: "all" }] } },
  { files: ["**/*.js"], languageOptions: { globals: {} } },
);
