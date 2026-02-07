/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
    proxyTimeout: 600_000, // 10 min – matches our fetch timeout
  },
};
module.exports = nextConfig;
