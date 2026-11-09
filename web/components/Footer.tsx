import Link from 'next/link';
import { SITE } from '@/lib/site';

export default function Footer() {
  return (
    <footer>
      <span>Haunts · a private map of everywhere you have been, made in Bengaluru.</span>
      <span style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
        <Link href="/how-it-works/">How it works</Link>
        <Link href="/download/">Download</Link>
        <a href={SITE.repo} target="_blank" rel="noreferrer">Source on GitHub</a>
        <a href={SITE.author} target="_blank" rel="noreferrer">Built by Sudeep</a>
      </span>
    </footer>
  );
}
