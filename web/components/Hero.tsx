'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { cityStore } from '@/lib/store';

// Three.js only runs in the browser; start loading it right away, in parallel with hydration.
const loadCity = () => import('./CityScene');
if (typeof window !== 'undefined') void loadCity();
const CityScene = dynamic(loadCity, { ssr: false });

const TITLE = 'Your city starts in fog.';

/** The headline set along a road, like a street name on a map; letters appear in walking order. */
function RoadTitle() {
  const ref = useRef<SVGTextElement>(null);
  useEffect(() => {
    const spans = Array.from(ref.current!.querySelectorAll('tspan'));
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.set(spans, { opacity: 0, fill: '#b6aad8' });
    const order = spans.map((_, i) => i).sort(() => Math.random() - 0.5);
    // Bias toward neighbours: sort by a wandering position instead of pure shuffle.
    let pos = Math.floor(spans.length / 2);
    const walk: number[] = [];
    const left = new Set(order);
    while (left.size) {
      const near = [...left].sort((a, b) => Math.abs(a - pos) - Math.abs(b - pos))[Math.random() < 0.8 ? 0 : 1] ?? [...left][0]!;
      walk.push(near);
      left.delete(near);
      pos = near + (Math.random() < 0.5 ? -1 : 1);
    }
    walk.forEach((i, k) => gsap.to(spans[i]!, { opacity: 1, fill: '#1b1538', duration: 0.5, delay: 0.3 + k * 0.045 }));
  }, []);
  return (
    <svg className="hero-road desk-only" viewBox="0 0 1440 300" aria-hidden="true">
      <path id="road" className="road" d="M -60 230 C 260 70, 600 300, 900 180 S 1300 60, 1520 130" />
      <path className="road-line" d="M -60 230 C 260 70, 600 300, 900 180 S 1300 60, 1520 130" />
      <text ref={ref} fontSize="116" dy="38">
        <textPath href="#road" startOffset="5%">
          {[...TITLE].map((c, i) => <tspan key={i}>{c}</tspan>)}
        </textPath>
      </text>
    </svg>
  );
}

function SimChip() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN(cityStore.painted), 400);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="sim-chip" aria-live="off">
      <span className="mono">Simulated walk · 3 walkers</span>
      <strong>{n.toLocaleString('en-IN')}</strong>
      <span className="mono">blocks painted since you arrived</span>
    </div>
  );
}

export default function Hero({ children }: { children: React.ReactNode }) {
  return (
    <section className="hero">
      <CityScene />
      <h1 aria-label={TITLE}>
        <RoadTitle />
        <span className="hero-h1-mob mob-only" data-walk="">{TITLE}</span>
      </h1>
      {children}
      <SimChip />
    </section>
  );
}
