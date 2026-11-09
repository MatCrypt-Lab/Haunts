'use client';

import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';

type Node = 'phone' | 'api' | 'claude' | 'osm';
type Packet = { from: Node; to: Node; text: string; blocked?: boolean };

const POS: Record<Node, { x: number; y: number }> = {
  phone: { x: 170, y: 220 },
  api: { x: 500, y: 220 },
  claude: { x: 840, y: 110 },
  osm: { x: 840, y: 330 },
};

// What really crosses each boundary, following the server and app code.
const QUESTIONS: { q: string; packets: Packet[] }[] = [
  {
    q: "Quiet cafe nearby I haven't tried",
    packets: [
      { from: 'phone', to: 'phone', text: 'exact GPS position', blocked: true },
      { from: 'phone', to: 'api', text: 'question + 60 m map block' },
      { from: 'api', to: 'claude', text: 'question + block, no identity' },
      { from: 'claude', to: 'api', text: 'search_places: cafe, 1 km' },
      { from: 'api', to: 'osm', text: 'cafes near the block' },
      { from: 'osm', to: 'api', text: '10 real cafes, hours, wifi' },
      { from: 'claude', to: 'api', text: 'check_visited: 10 places' },
      { from: 'api', to: 'phone', text: 'have you been to these?' },
      { from: 'phone', to: 'phone', text: 'your visit history', blocked: true },
      { from: 'phone', to: 'api', text: 'yes or no, 10 places' },
      { from: 'api', to: 'phone', text: 'answer + pins for the map' },
    ],
  },
  {
    q: 'Where did I spend the most time this month?',
    packets: [
      { from: 'phone', to: 'api', text: 'question + 60 m map block' },
      { from: 'api', to: 'claude', text: 'question' },
      { from: 'claude', to: 'api', text: 'memory_query: top_places' },
      { from: 'api', to: 'phone', text: 'please summarise' },
      { from: 'phone', to: 'phone', text: 'timeline with times and routes', blocked: true },
      { from: 'phone', to: 'api', text: 'top 8 place names + minutes' },
      { from: 'api', to: 'claude', text: 'that summary only' },
      { from: 'api', to: 'phone', text: 'answer' },
    ],
  },
  {
    q: 'Plan a 30-minute walk that paints new blocks',
    packets: [
      { from: 'phone', to: 'phone', text: 'home and private zones', blocked: true },
      { from: 'phone', to: 'api', text: 'question + 60 m map block' },
      { from: 'api', to: 'claude', text: 'question + block' },
      { from: 'claude', to: 'api', text: 'plan_explore_walk: 30 min' },
      { from: 'api', to: 'api', text: 'which nearby blocks are new' },
      { from: 'api', to: 'osm', text: 'walking route, 3 waypoints' },
      { from: 'osm', to: 'api', text: 'route on real streets' },
      { from: 'api', to: 'phone', text: 'route: 2.4 km, 20 new blocks' },
    ],
  },
];

const LABEL: Record<Node, [string, string]> = {
  phone: ['Your phone', 'memory lives here'],
  api: ['Haunts server', 'AWS · Fastify'],
  claude: ['Claude', 'Opus 5.5 agent'],
  osm: ['OpenStreetMap', 'places, routes, weather'],
};

export default function Flow() {
  const [qi, setQi] = useState(0);
  const [log, setLog] = useState<Packet[]>([]);
  const layer = useRef<SVGGElement>(null);

  useEffect(() => {
    const g = layer.current!;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const { packets } = QUESTIONS[qi]!;
    setLog([]);
    g.replaceChildren();
    if (reduce) { setLog(packets); return; }
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 2.5, onRepeat: () => setLog([]) });
    packets.forEach((p, k) => {
      const ns = 'http://www.w3.org/2000/svg';
      const el = document.createElementNS(ns, 'g');
      const w = p.text.length * 7.2 + 26;
      el.innerHTML = `<rect x="${-w / 2}" y="-15" width="${w}" height="30" rx="15" fill="${p.blocked ? '#ff5a5f' : p.from === 'phone' || p.to === 'phone' ? '#00c2ff' : '#e8e3f3'}"/><text x="0" y="5" text-anchor="middle" fill="#1b1538" style="font:600 12.5px var(--body)">${p.blocked ? '✕ ' : ''}${p.text}</text>`;
      el.setAttribute('opacity', '0');
      g.appendChild(el);
      const a = POS[p.from], b = POS[p.to];
      const at = k * 1.15;
      if (p.blocked) {
        // Tries to leave the phone and is stopped at its boundary.
        tl.fromTo(el, { attr: { transform: `translate(${a.x},${a.y + 40})` }, opacity: 0 }, { opacity: 1, duration: 0.2 }, at)
          .to(el, { attr: { transform: `translate(${a.x + 120},${a.y + 40})` }, duration: 0.45, ease: 'power2.in' }, at)
          .to(el, { attr: { transform: `translate(${a.x + 60},${a.y + 40})` }, duration: 0.4, ease: 'back.out(3)' }, at + 0.45)
          .to(el, { opacity: 0, duration: 0.3 }, at + 0.95);
      } else if (p.from === p.to) {
        tl.fromTo(el, { attr: { transform: `translate(${a.x},${a.y - 60})` }, opacity: 0 }, { opacity: 1, duration: 0.25 }, at).to(el, { opacity: 0, duration: 0.3 }, at + 0.9);
      } else {
        tl.fromTo(el, { attr: { transform: `translate(${a.x},${a.y})` }, opacity: 0 }, { opacity: 1, duration: 0.15 }, at)
          .to(el, { attr: { transform: `translate(${b.x},${b.y})` }, duration: 0.85, ease: 'power1.inOut' }, at)
          .to(el, { opacity: 0, duration: 0.2 }, at + 0.85);
      }
      tl.call(() => setLog((l) => [...l, p]), [], at + 0.3);
    });
    return () => { tl.kill(); };
  }, [qi]);

  return (
    <div className="flow">
      <div className="flow-q" role="group" aria-label="Pick a question">
        {QUESTIONS.map((q, i) => (
          <button key={q.q} aria-pressed={i === qi} onClick={() => setQi(i)}>{q.q}</button>
        ))}
      </div>
      <svg viewBox="0 0 1000 440" role="img" aria-label="Diagram of what travels between the phone, the Haunts server, Claude and OpenStreetMap for the selected question">
        <path className="wire" d={`M${POS.phone.x} ${POS.phone.y} L${POS.api.x} ${POS.api.y}`} />
        <path className="wire" d={`M${POS.api.x} ${POS.api.y} L${POS.claude.x} ${POS.claude.y}`} />
        <path className="wire" d={`M${POS.api.x} ${POS.api.y} L${POS.osm.x} ${POS.osm.y}`} />
        <rect x="40" y="70" width="260" height="300" rx="26" fill="none" stroke="#6a3fd1" strokeWidth="2" strokeDasharray="7 7" />
        <text x="58" y="98" fill="#b9a5f0" style={{ font: '600 13px var(--body)' }}>Stays on the phone</text>
        {(Object.keys(POS) as Node[]).map((k) => (
          <g key={k} className="node" transform={`translate(${POS[k].x},${POS[k].y})`}>
            <rect x="-88" y="-34" width="176" height="68" rx="18" />
            <text x="0" y="-4" textAnchor="middle">{LABEL[k][0]}</text>
            <text className="small" x="0" y="16" textAnchor="middle">{LABEL[k][1]}</text>
          </g>
        ))}
        <g ref={layer} />
      </svg>
      <div className="flow-log" aria-live="polite">
        {log.map((p, i) => (
          <span key={i} className={p.blocked ? 'no' : 'yes'}>
            {p.blocked ? '✕ Never leaves the phone: ' : '✓ '}
            <b>{p.text}</b>
            {p.blocked ? '' : ` · ${LABEL[p.from][0]} → ${LABEL[p.to][0]}`}
          </span>
        ))}
      </div>
    </div>
  );
}
