import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return ['/', '/how-it-works/', '/download/'].map((p) => ({ url: `${SITE.url}${p}`, changeFrequency: 'weekly', priority: p === '/' ? 1 : 0.8 }));
}
