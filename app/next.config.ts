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
    // Agent lives outside app/ — tell webpack to resolve its imports from app/node_modules
    // Keep 'node_modules' first so normal upward traversal still works for everything else
    config.resolve.modules = ['node_modules', path.resolve(__dirname, 'node_modules')];
    return config;
  },
};

export default nextConfig;
