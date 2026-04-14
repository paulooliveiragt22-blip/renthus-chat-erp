/** @type {import('next').NextConfig} */
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
    // Rotas que NUNCA podem ser cacheadas
    exclude: [
      /\/api\/whatsapp\/incoming/,
      /\/api\/whatsapp\/flows/,
      /\/api\/billing\/webhook/,
      /\/api\/billing\/charge/,
      /\/api\/billing\/create-invoice-checkout/,
      /\/api\/print\/download-agent/,
      /\/api\/downloads\//,
    ],
    runtimeCaching: [
      // Assets estáticos Next.js — CacheFirst (imutáveis com hash)
      {
        urlPattern: /\/_next\/static\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "next-static",
          expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
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
      // APIs sensíveis (pedidos, relatórios, WhatsApp): não cachear no SW — evita dados em disco partilhado
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
  outputFileTracingIncludes: {
    "/api/print/download-agent": [
      "./app/api/print/download-agent/RenthusPrintAgentInstaller-v1.0.0.exe",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = withPWA(nextConfig);
