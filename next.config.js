/** @type {import('next').NextConfig} */
const { withSentryConfig } = require("@sentry/nextjs");

const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  // Só ativa service worker em produção
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
  reloadOnOnline: true,
  // Fallback offline para navegação
  fallbacks: {
    document: "/offline",
  },
  workboxOptions: {
    // Não precachar source maps nem rotas de API (só assets estáticos com hash).
    exclude: [
      /\/api\/whatsapp\/incoming/,
      /\/api\/whatsapp\/flows/,
      /\/api\/billing\/webhook/,
      /\/api\/billing\/charge/,
      /\/api\/billing\/create-invoice-checkout/,
      /\/api\/downloads\//,
      /\/api\/agent\/activate/,
      /\.map$/,
      /^\/api\//,
    ],
    runtimeCaching: [
      // Assets estáticos Next.js — CacheFirst (imutáveis com hash)
      {
        urlPattern: /\/_next\/static\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "next-static",
          expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 },
        },
      },
      // Imagens otimizadas
      {
        urlPattern: /\/_next\/image\?.*/i,
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "next-images",
          expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 7 },
        },
      },
      // Documentos HTML: rede primeiro — evita shell/RSC stale após deploy
      {
        urlPattern: ({ request }) => request.mode === "navigate",
        handler: "NetworkFirst",
        options: {
          cacheName: "pages",
          networkTimeoutSeconds: 8,
          expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 },
        },
      },
    ],
  },
});

const isProd =
  process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key:   "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
];

if (isProd) {
  securityHeaders.push({
    key:   "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  });
}

const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = withSentryConfig(withPWA(nextConfig), {
  // `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` ausentes (padrão até
  // configurar o projeto no Sentry) só pulam o upload de source maps —
  // não quebram o build. Ver docs/CHECKLIST_SEGURANCA_CONFIABILIDADE_P0.md item 2.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: true,
  webpack: {
    treeshake: { removeDebugLogging: true },
  },
});
