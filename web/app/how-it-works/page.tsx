import type { Metadata } from 'next';
import Link from 'next/link';
import Flow from '@/components/Flow';
import { CITY_TOTAL_BLOCKS, NEIGHBOURHOOD_COUNT } from '@/lib/city';
import { OG_IMAGE, SITE } from '@/lib/site';

const title = 'How it works';
const description =
  'How Haunts stays personal without reading your life: what stays on the phone, what the server sees, how the Claude agent splits its tools, and the stack.';
const url = `${SITE.url}/how-it-works/`;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: url },
  openGraph: { title: `${title} · Haunts`, description, url, images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', images: [OG_IMAGE.url] },
};

const RULES = [
  ['No raw location on the server', 'The phone turns each GPS fix into a 60 m block ID and a date. Only those are uploaded.'],
  ['Private zones never recorded', 'Home and other zones are filtered on the phone before anything is stored, and never leave it.'],
  ['No live location for friends', 'The crew map hides today and shows no times, so nobody can see where you are right now.'],
  ['Memory is end-to-end encrypted', 'Backups are encrypted on the phone with a recovery code; the server keeps bytes it cannot read.'],
  ['The AI never sees your timeline', 'When a question needs your memory, the phone asks you, then sends a short summary only.'],
  ['Delete means delete', 'Deleting the account removes every row you own, including drops and the encrypted backup.'],
];

const SERVER_TOOLS = ['search_places', 'walking_route', 'get_weather', 'plan_explore_walk', 'game_status'];
const PHONE_TOOLS = ['check_visited', 'memory_query', 'taste_profile', 'saved_places'];

const STACK = {
  'Mobile app': ['Expo SDK 57', 'React Native 0.86', 'expo-router', 'MapLibre', 'expo-location background tracking', 'SQLite', 'speech in and out', 'camera'],
  Server: ['Node 22', 'Fastify 5', 'PostgreSQL on Neon', 'AWS EC2', 'Caddy with automatic HTTPS', 'systemd'],
  AI: ['Claude Opus 5.5', 'tool use agent', 'structured JSON answers', 'vision', 'prompt caching', 'refusal fallback'],
  'Data and builds': ['OpenStreetMap: Overpass, Nominatim, Photon, OSRM', 'Open-Meteo', 'GitHub Actions', 'GitHub Releases', 'GitHub Pages'],
};

export default function HowItWorks() {
  return (
    <>
      <header className="page-head">
        <span className="tag">How it works</span>
        <h1 data-walk="">Personal, without reading your life.</h1>
        <p className="lede">Haunts is a phone app, a small server and an AI agent. The interesting part is where each piece of your data is allowed to go.</p>
      </header>

      <section className="section" style={{ paddingTop: 0 }} aria-labelledby="flow">
        <div className="section-head">
          <h2 id="flow" data-walk="">Watch what leaves the phone.</h2>
          <p className="lede">Pick a question. Each pill is a real message in the code path. Red ones are stopped at the phone.</p>
        </div>
        <div className="reveal"><Flow /></div>
      </section>

      <section className="section" aria-labelledby="agent">
        <div className="section-head">
          <span className="tag">The AI agent</span>
          <h2 id="agent" data-walk="">One agent, two kinds of tools.</h2>
          <p className="lede">Claude plans on the server. Tools that touch the city run there; tools that touch your memory run on your phone and return a summary.</p>
        </div>
        <div className="grid-2">
          <article className="card reveal">
            <h3>Runs on the server</h3>
            <p>Public data and game state: real places, walking routes on actual streets, weather, the explore-walk planner and crew scores.</p>
            <div className="stack">{SERVER_TOOLS.map((t) => <span key={t} className="mono">{t}</span>)}</div>
          </article>
          <article className="card dark reveal">
            <h3>Runs on your phone</h3>
            <p>Your memory. The conversation pauses, the phone asks for permission once, answers from its own database and shows what it shared.</p>
            <div className="stack">{PHONE_TOOLS.map((t) => <span key={t} className="mono" style={{ background: 'rgba(255,255,255,.1)', color: '#e8e3f3' }}>{t}</span>)}</div>
          </article>
        </div>
      </section>

      <section className="section" aria-labelledby="rules">
        <div className="section-head">
          <span className="tag">Privacy rules</span>
          <h2 id="rules" data-walk="">Enforced in code, not in a policy.</h2>
        </div>
        <div className="grid-3">
          {RULES.map(([t, b]) => (
            <article key={t} className="card reveal">
              <h3>{t}</h3>
              <p>{b}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="numbers">
        <div className="section-head">
          <span className="tag">By the numbers</span>
          <h2 id="numbers" data-walk="">Small app, real city.</h2>
        </div>
        <div className="facts">
          {[
            [CITY_TOTAL_BLOCKS.toLocaleString('en-IN'), 'blocks cover Bengaluru'],
            [String(NEIGHBOURHOOD_COUNT), 'neighbourhoods to own'],
            ['60 m', 'per block, about one street corner'],
            ['94', 'automated tests on the shared core and the API'],
          ].map(([v, l]) => (
            <div key={l} className="card reveal">
              <span className="fact-n">{v}</span>
              <p>{l}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="stack">
        <div className="section-head">
          <span className="tag">The stack</span>
          <h2 id="stack" data-walk="">What it is built with.</h2>
        </div>
        <div className="grid-2">
          {Object.entries(STACK).map(([k, v]) => (
            <article key={k} className="card reveal">
              <h3>{k}</h3>
              <div className="stack">{v.map((s) => <span key={s}>{s}</span>)}</div>
            </article>
          ))}
        </div>
        <div className="btn-row reveal" style={{ marginTop: 40 }}>
          <Link className="btn" href="/download/">Get the app</Link>
          <a className="btn alt" href={SITE.repo} target="_blank" rel="noreferrer">Read the code</a>
        </div>
      </section>
    </>
  );
}
