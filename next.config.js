/** @type {import('next').NextConfig} */
const nextConfig = {
    experimental: {
        // Statement files are uploaded through a server action
        serverActions: {bodySizeLimit: '5mb'},
    },
};

module.exports = nextConfig;
