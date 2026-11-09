import type { Metadata } from 'next';
import Link from 'next/link';
import Deck from '@/components/Deck';
import Hero from '@/components/Hero';
import Story, { type Chapter } from '@/components/Story';
import { CITY_TOTAL_BLOCKS, NEIGHBOURHOOD_COUNT, BLOCK_M } from '@/lib/city';
import { OG_IMAGE, SITE } from '@/lib/site';

const description =
  'Haunts privately remembers everywhere you stop in Bengaluru, turns walks into a map you paint with friends, and adds an AI that never reads your timeline.';

export const metadata: Metadata = {
  title: { absolute: 'Haunts · Your city starts in fog' },
  description,
  alternates: { canonical: `${SITE.url}/` },
  openGraph: { title: 'Haunts · Your city starts in fog', description, url: `${SITE.url}/`, images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', images: [OG_IMAGE.url] },
};

const n = (x: number) => x.toLocaleString('en-IN');

const CHAPTERS: Chapter[] = [
  {
    tag: 'The map',
    title: 'Walk, and the fog lifts.',
    body: 'Haunts runs quietly in the background. Every street you walk paints a block, so the map of Bengaluru slowly fills in with the places you actually live.',
    fact: `Bengaluru is ${n(CITY_TOTAL_BLOCKS)} blocks of about ${BLOCK_M} m across ${NEIGHBOURHOOD_COUNT} neighbourhoods. The blocks on this map are the real grid.`,
  },
  {
    tag: 'Your memory',
    title: 'It remembers. Only for you.',
    body: 'Where you stopped, for how long, the route between: a private timeline you can search, name and look back on. It stays on your phone; the server only ever sees block IDs and dates.',
    fact: 'Optional backup is encrypted on the phone with AES-256-GCM, using a recovery code only you hold.',
  },
  {
    tag: 'Your crew',
    title: 'Friends fight for neighbourhoods.',
    body: 'Crews of up to 20 paint the city together. The crew with the most presence in a neighbourhood owns it for the week, and hidden drops wait in the streets.',
    fact: 'Territory resets every Monday. Crew colours here are a simulation; the scores in the app are real.',
  },
  {
    tag: 'Ask Haunts',
    title: 'An AI that knows the city, not your diary.',
    body: 'Ask for a quiet cafe you have never tried, a 30-minute walk that paints new blocks, or where you spent most of last month. It reasons on the server; your phone answers the private parts.',
    fact: 'Places, routes and weather come from OpenStreetMap and Open-Meteo. The purple line is the kind of walk Ask plans.',
  },
];

const FEATURES = [
  { title: 'Private timeline', body: 'Stops, places and routes recorded on the phone. Search "that cafe from March".', c: '#6a3fd1' },
  { title: 'Encrypted backup', body: 'Survives a new phone. The server stores bytes it cannot read.', c: '#1b1538' },
  { title: 'A map you paint', body: 'Background tracking turns walks into 60 m hex blocks.', c: '#00a8e0' },
  { title: 'Crews and territory', body: 'Weekly neighbourhood battles, titles like Pioneer and Local legend.', c: '#ff5a5f' },
  { title: 'Ask anything', body: 'Nearby places, plans with timings and routes, questions about your own history.', c: '#6a3fd1' },
  { title: 'Camera and voice', body: 'Point at a sign, a menu or a building. Ask out loud, hear it answer.', c: '#2fbf86' },
  { title: 'Walking guide', body: 'A short spoken story whenever you step into a block you have never explored.', c: '#ff9f1c' },
  { title: 'Private zones', body: 'Home and anywhere you choose are never recorded at all.', c: '#1b1538' },
];

export default function Home() {
  return (
    <>
      <Hero>
        <div className="legend">
          <div className="legend-top">
            <span className="tag">Bengaluru, in blocks</span>
            <span className="scale mono" aria-label="Scale: one block is 60 metres"><i />60 m</span>
          </div>
          <p className="lede">
            Haunts privately remembers everywhere you stop, turns your walks into a map you colour in with friends, and gives you an AI that knows the city but never reads your timeline.
          </p>
          <div className="btn-row">
            <Link className="btn" href="/download/">Get the app <Arrow /></Link>
            <Link className="btn alt" href="/how-it-works/">How it works</Link>
          </div>
          <div className="keys">
            <span><b style={{ background: '#cbc1e6' }} />Fog</span>
            <span><b style={{ background: '#00a8e0' }} />Your blocks</span>
            <span><b style={{ background: '#ff5a5f' }} />Crew territory</span>
            <span><b style={{ background: '#ff9f1c' }} />Drop found</span>
          </div>
        </div>
      </Hero>

      <Story chapters={CHAPTERS} />

      <section className="section solid" aria-labelledby="screens">
        <div className="section-head">
          <span className="tag">The app</span>
          <h2 id="screens" data-walk="">Five screens, one city.</h2>
          <p className="lede">Drawn here in code from the real app: the same colours, words and layout you see on the phone. Move your pointer over them.</p>
        </div>
        <Deck />
        <p className="muted reveal" style={{ textAlign: 'center', marginTop: 70 }}>Memory · Ask · Map · Crew · Story card</p>
      </section>

      <section className="section solid" aria-labelledby="inside">
        <div className="section-head">
          <span className="tag">What is inside</span>
          <h2 id="inside" data-walk="">Built for the everyday, with a game on top.</h2>
        </div>
        <div className="grid-4">
          {FEATURES.map((f) => (
            <article key={f.title} className="card reveal">
              <span className="ico" style={{ background: f.c }} aria-hidden="true"><Dot /></span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section solid" aria-labelledby="try">
        <div className="card dark reveal" style={{ padding: 'clamp(28px, 5vw, 64px)', gap: 24 }}>
          <h2 id="try" data-walk="">Try it on your phone.</h2>
          <p style={{ maxWidth: '52ch', fontSize: 19 }}>
            Every build comes straight from the GitHub pipeline: an Android APK, an iPhone build to sideload, and a simulator build for browser demos.
          </p>
          <div className="btn-row">
            <Link className="btn violet" href="/download/">Download Haunts <Arrow /></Link>
            <a className="btn alt" href={SITE.repo} target="_blank" rel="noreferrer">Read the code</a>
          </div>
        </div>
      </section>
    </>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M4 10h12M11 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Dot() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 3 16 6.5v7L10 17l-6-3.5v-7Z" opacity=".9" />
    </svg>
  );
}
