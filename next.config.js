/** @type {import('next').NextConfig} */
const nextConfig = {
    // Self-contained server that scripts/deploy.sh uploads
    output: 'standalone',
    experimental: {
        // Statement files are uploaded through a server action
        serverActions: {bodySizeLimit: '5mb'},
    },
};

module.exports = nextConfig;
