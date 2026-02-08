/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
    proxyTimeout: 300_000, // 5 min – Vercel hobby plan limit
  },
  // Allow images from GitHub avatars (used in navbar)
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
};
module.exports = nextConfig;
