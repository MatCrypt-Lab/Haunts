import type { Metadata } from 'next';
import InstallTabs from '@/components/InstallTabs';
import { BuildStatus, LatestRelease } from '@/components/Live';
import { OG_IMAGE, SITE } from '@/lib/site';

const title = 'Download';
const description =
  'Download Haunts: the Android APK, an iPhone build to sideload, and a simulator build for browser demos, published straight from the GitHub Actions pipeline.';
const url = `${SITE.url}/download/`;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: url },
  openGraph: { title: `${title} · Haunts`, description, url, images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', images: [OG_IMAGE.url] },
};

export default function Download() {
  return (
    <>
      <header className="page-head">
        <span className="tag">Download</span>
        <h1 data-walk="">Get Haunts on your phone.</h1>
        <p className="lede">Every file below comes straight from the build pipeline, read live from GitHub, so it is always the newest one.</p>
      </header>

      <section className="section" style={{ paddingTop: 0 }} aria-label="Downloads and build status">
        <div className="dl-grid">
          <article className="card reveal" style={{ gap: 18 }}>
            <h2 style={{ fontSize: 'clamp(30px, 3.4vw, 48px)' }}>Latest build</h2>
            <LatestRelease />
          </article>
          <article className="card reveal" style={{ gap: 18 }}>
            <h2 style={{ fontSize: 'clamp(30px, 3.4vw, 48px)' }}>The pipeline</h2>
            <p>One GitHub Actions workflow builds the Android APK on Linux and the iPhone builds on a Mac, then publishes them as a release.</p>
            <BuildStatus />
            <div className="btn-row">
              <a className="btn violet" href={SITE.workflow} target="_blank" rel="noreferrer">Run a new build</a>
              <a className="btn alt" href={`${SITE.repo}/fork`} target="_blank" rel="noreferrer">Fork and build your own</a>
            </div>
            <p className="note">
              Starting a build needs a GitHub account with access to the repository: open the workflow and press <b>Run workflow</b>. Anyone else can fork the repository and run the same pipeline for free in their copy.
            </p>
          </article>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }} aria-labelledby="install">
        <div className="section-head">
          <span className="tag">Install</span>
          <h2 id="install" data-walk="">Three ways to try it.</h2>
        </div>
        <div className="card reveal">
          <InstallTabs />
        </div>
      </section>
    </>
  );
}
