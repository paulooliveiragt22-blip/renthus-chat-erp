import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Saída compilada de `npm test` (tsc -> .tests-dist/**/*.js) — artefato gerado, não código-fonte.
    // Achado 2026-08-11 (docs/CHECKLIST_SEGURANCA_CONFIABILIDADE_P0.md item 6): sem este ignore, 779
    // dos 1129 erros de lint (69%) eram ruído desse diretório, mascarando o tamanho real do backlog.
    ".tests-dist/**",
  ]),
]);

export default eslintConfig;
