/** @type {import('next').NextConfig} */
const nextConfig = {
    // Self-contained server for the Docker image
    output: 'standalone',
    experimental: {
        // Statement files are uploaded through a server action
        serverActions: {bodySizeLimit: '5mb'},
    },
};

module.exports = nextConfig;
