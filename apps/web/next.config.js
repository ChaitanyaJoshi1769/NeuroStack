/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  transpilePackages: ['@neurostack/ui', '@neurostack/sdk', '@neurostack/shared'],
  experimental: {
    optimizePackageImports: ['@neurostack/ui'],
  },
};

module.exports = nextConfig;
