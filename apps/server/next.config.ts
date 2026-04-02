import { withPayload } from '@payloadcms/next/withPayload';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    output: 'standalone',
    distDir: '.next',
    turbopack: {
        resolveExtensions: ['.mdx', '.tsx', '.ts', '.jsx', '.js', '.json'],
    },
    typescript: {
        ignoreBuildErrors: true,
    },
    redirects: async () => {
        return [
            {
                source: '/',
                destination: '/home',
                permanent: true,
            },
        ];
    },
};

export default withPayload(nextConfig);
