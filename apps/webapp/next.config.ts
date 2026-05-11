import { withPayload } from '@payloadcms/next/withPayload';
import { createMDX } from 'fumadocs-mdx/next';
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

const withMDX = createMDX({
    configPath: 'source.config.ts',
});

export default withPayload(withMDX(nextConfig));
