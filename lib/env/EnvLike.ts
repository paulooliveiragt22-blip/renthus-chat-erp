/**
 * Subconjunto mínimo de `process.env` usado como parâmetro injetável em
 * funções de config (testabilidade). Não usar `NodeJS.ProcessEnv` direto:
 * é um tipo ambient global — pacotes como `@sentry/nextjs`/`next` podem
 * endurecer esse shape (ex.: exigir `NODE_ENV`) via declaration merging em
 * qualquer arquivo do mesmo programa TS, quebrando literais `{ FOO: "x" }`
 * passados em testes que não têm relação com Sentry/Next.
 */
export type EnvLike = Record<string, string | undefined>;
