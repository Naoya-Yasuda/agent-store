/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async rewrites() {
    const apiUrl = process.env.API_URL || 'http://api:3000';
    return [
      {
        source: '/review/:path*',
        destination: `${apiUrl}/api/review/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
