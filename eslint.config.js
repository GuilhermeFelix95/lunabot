import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    "**/dist/**",
    "apps/desktop/src-tauri/target/**",
    "apps/desktop/src-tauri/gen/**",
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
);
