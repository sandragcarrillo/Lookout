import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // Don't bundle thirdweb through webpack — it uses Node.js internals
  // that webpack transforms incorrectly, breaking the auth header generation
  serverExternalPackages: ['thirdweb'],
  webpack: (config) => {
    config.resolve.alias['@agent'] = path.resolve(__dirname, '../agent');
    // NodeNext uses .js imports that actually point to .ts files — remap them
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
