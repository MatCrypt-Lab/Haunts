export const SITE = {
  name: 'Haunts',
  url: 'https://matcrypt-lab.github.io/Haunts',
  repo: 'https://github.com/MatCrypt-Lab/Haunts',
  repoApi: 'https://api.github.com/repos/MatCrypt-Lab/Haunts',
  workflow: 'https://github.com/MatCrypt-Lab/Haunts/actions/workflows/build-apps.yml',
  releases: 'https://github.com/MatCrypt-Lab/Haunts/releases',
  author: 'https://github.com/SudeepGowda55',
} as const;

export const OG_IMAGE = { url: `${SITE.url}/og.png`, width: 1200, height: 627, alt: 'Haunts: your city starts in fog' };

/** Prefix for files in /public, which Next does not add basePath to in plain <img> or fetch. */
export const asset = (p: string) => `/Haunts${p}`;
