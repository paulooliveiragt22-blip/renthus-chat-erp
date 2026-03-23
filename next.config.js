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
      // Dashboard stats — NetworkFirst (dados frescos prioritários)
      {
        urlPattern: /\/api\/dashboard\/stats/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "api-dashboard",
          networkTimeoutSeconds: 10,
          expiration: { maxEntries: 10, maxAgeSeconds: 60 * 5 },
        },
      },
      // Lista de pedidos
      {
        urlPattern: /\/api\/orders\/list/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "api-orders",
          networkTimeoutSeconds: 10,
          expiration: { maxEntries: 5, maxAgeSeconds: 60 * 2 },
        },
      },
      // Detalhe de pedido
      {
        urlPattern: /\/api\/orders\/[^/]+$/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "api-order-detail",
          networkTimeoutSeconds: 10,
          expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 },
        },
      },
      // Relatórios
      {
        urlPattern: /\/api\/reports\/.*/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "api-reports",
          networkTimeoutSeconds: 10,
          expiration: { maxEntries: 20, maxAgeSeconds: 60 * 10 },
        },
      },
      // WhatsApp threads (leitura)
      {
        urlPattern: /\/api\/whatsapp\/threads/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "api-threads",
          networkTimeoutSeconds: 10,
          expiration: { maxEntries: 10, maxAgeSeconds: 60 * 2 },
        },
      },
    ],
  },
});

const nextConfig = {
  outputFileTracingIncludes: {
    "/api/print/download-agent": [
      "./app/api/print/download-agent/RenthusPrintAgentInstaller-v1.0.0.exe",
    ],
  },
};

module.exports = withPWA(nextConfig);
