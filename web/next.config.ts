import path from 'node:path';
import type { NextConfig } from 'next';

// Static site for GitHub Pages: https://matcrypt-lab.github.io/Haunts/
const config: NextConfig = {
  output: 'export',
  basePath: '/Haunts',
  trailingSlash: true,
  images: { unoptimized: true },
  // Next 16 writes AGENTS.md/CLAUDE.md into the project on dev start; this repo doesn't want them.
  agentRules: false,
  // City data and the hex grid come straight from the app's shared package.
  turbopack: { root: path.join(__dirname, '..') },
  outputFileTracingRoot: path.join(__dirname, '..'),
};

export default config;
