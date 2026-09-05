/** @type {import('next').NextConfig} */
const { withSentryConfig } = require("@sentry/nextjs");

const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  // Só ativa service worker em produção
  disable: process.env.NODE_ENV === "development",
  register: true,
  // ADR-0008 D5 / P3.2: não ativar SW novo no meio da venda — banner pede confirmação
  skipWaiting: false,
  clientsClaim: true,
  reloadOnOnline: false,
  // Fallback offline para navegação
  fallbacks: {
    document: "/offline",
  },
  workboxOptions: {
    // Web Push: handlers em public/push-sw.js
    importScripts: ["/push-sw.js"],
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
      // Matriz D3 / Perf-5: APIs comerciais sempre rede (nunca SWR)
      {
        urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
        handler: "NetworkOnly",
      },
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
      // Timeout 4s (era 8): em galpão cai mais cedo no cache/offline (P3.6 / Perf-B)
      {
        urlPattern: ({ request }) => request.mode === "navigate",
        handler: "NetworkFirst",
        options: {
          cacheName: "pages",
          networkTimeoutSeconds: 4,
          expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 },
        },
      },
    ],
  },
});

const { X_FRAME_OPTIONS_DENY } = require("./lib/security/cspPolicy.cjs");

const isProd =
  process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key:   "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  /** S11: alinhado a frame-ancestors 'none' (CSP enforce no proxy). */
  { key: "X-Frame-Options", value: X_FRAME_OPTIONS_DENY },
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
  async redirects() {
    return [
      {
        source: "/superadmin",
        destination: "/platform",
        permanent: true,
      },
      {
        source: "/superadmin/:path*",
        destination: "/platform/:path*",
        permanent: true,
      },
    ];
  },
  // Mixpanel proxy (track + engage + Session Replay /record)
  // Replay doc: mesmo api_host; US → api.mixpanel.com
  // https://docs.mixpanel.com/docs/tracking-methods/sdks/javascript/javascript-replay
  async rewrites() {
    return [
      {
        source: "/mp/:path*",
        destination: "https://api.mixpanel.com/:path*",
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
