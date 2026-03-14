/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/print/download-agent": [
      "./app/api/print/download-agent/RenthusPrintAgentInstaller-v1.0.0.exe",
    ],
  },
};

module.exports = nextConfig;
