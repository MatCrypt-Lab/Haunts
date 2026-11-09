import type { Metadata, Viewport } from 'next';
import { Fragment_Mono, Funnel_Display, Host_Grotesk } from 'next/font/google';
import Chrome from '@/components/Chrome';
import Footer from '@/components/Footer';
import Nav from '@/components/Nav';
import { OG_IMAGE, SITE } from '@/lib/site';
import './globals.css';

const display = Funnel_Display({ subsets: ['latin'], weight: ['500', '700', '800'], variable: '--font-display' });
const body = Host_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-body' });
const mono = Fragment_Mono({ subsets: ['latin'], weight: '400', variable: '--font-mono' });

const description =
  'Haunts privately remembers everywhere you stop in Bengaluru, turns walks into a map you paint with friends, and adds an AI that never reads your timeline.';

export const metadata: Metadata = {
  metadataBase: new URL(`${SITE.url}/`),
  title: { default: 'Haunts · Your city starts in fog', template: '%s · Haunts' },
  description,
  alternates: { canonical: `${SITE.url}/` },
  openGraph: { type: 'website', siteName: 'Haunts', title: 'Haunts · Your city starts in fog', description, url: `${SITE.url}/`, images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', title: 'Haunts · Your city starts in fog', description, images: [OG_IMAGE.url] },
  icons: { icon: '/Haunts/icon.svg' },
};

export const viewport: Viewport = { themeColor: '#e8e3f3', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <Nav />
        <main>{children}</main>
        <Footer />
        <Chrome />
      </body>
    </html>
  );
}
