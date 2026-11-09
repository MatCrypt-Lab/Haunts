'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SITE } from '@/lib/site';

const LINKS = [
  { href: '/', label: 'Story' },
  { href: '/how-it-works/', label: 'How it works' },
  { href: '/download/', label: 'Download' },
];

export function HexMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 1.5 29 9v14L16 30.5 3 23V9Z" fill="#1b1538" />
      <path d="M16 8.5 22.5 12.25v7.5L16 23.5l-6.5-3.75v-7.5Z" fill="#00c2ff" />
      <path d="M16 8.5 22.5 12.25 16 16 9.5 12.25Z" fill="#6a3fd1" />
    </svg>
  );
}

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      <Link href="/" className="brand" aria-label="Haunts home">
        <HexMark className="brand-mark" />
        <span>Haunts</span>
      </Link>
      <div className="nav-links">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={path === l.href ? 'page' : undefined}>
            {l.label}
          </Link>
        ))}
      </div>
      <a className="gh" href={SITE.repo} target="_blank" rel="noreferrer" aria-label="GitHub repository">
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
        </svg>
      </a>
    </nav>
  );
}
