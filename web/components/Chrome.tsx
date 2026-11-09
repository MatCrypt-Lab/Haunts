'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { cityStore } from '@/lib/store';

gsap.registerPlugin(ScrollTrigger);

const BASE = '/Haunts';
const HEX = 26; // px radius of transition and trail hexes
const PAINT = ['#00a8e0', '#6a3fd1', '#ff5a5f', '#2fbf86', '#ff9f1c'];
// Real neighbourhoods on the route bar; the reader "walks" past them as the page scrolls.
const STOPS = ['Koramangala', 'Domlur', 'Indiranagar', 'MG Road', 'Malleshwaram'];
const NAMES: Record<string, string> = { '/': 'the story', '/how-it-works/': 'how it works', '/download/': 'the download' };

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function hexPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    ctx[i ? 'lineTo' : 'moveTo'](x + r * Math.cos(a), y + r * Math.sin(a));
  }
  ctx.closePath();
}

/** Hex centres covering the screen, ordered by distance from a point with a little jitter. */
function hexCells(w: number, h: number, ox: number, oy: number) {
  const dx = Math.sqrt(3) * HEX, dy = 1.5 * HEX;
  const cells: { x: number; y: number; d: number }[] = [];
  for (let row = -1; row * dy < h + dy; row++) {
    for (let col = -1; col * dx < w + dx; col++) {
      const x = col * dx + (row % 2 ? dx / 2 : 0), y = row * dy;
      cells.push({ x, y, d: Math.hypot(x - ox, y - oy) * (0.85 + Math.random() * 0.3) });
    }
  }
  return cells.sort((a, b) => a.d - b.d);
}

const split = new WeakMap<HTMLElement, HTMLElement[]>();

/** Splits text into words and letters (once), then reveals the letters in a wandering "walk" order. */
function walkReveal(el: HTMLElement): ScrollTrigger | undefined {
  const done = split.get(el);
  if (done) {
    // Already split (React can mount twice in development): just make sure it is visible.
    gsap.set(done, { opacity: 1, y: 0, clearProps: 'color' });
    return undefined;
  }
  const text = el.textContent ?? '';
  el.setAttribute('aria-label', text);
  el.textContent = '';
  const chars: HTMLElement[] = [];
  text.split(/(\s+)/).forEach((part) => {
    if (/^\s+$/.test(part)) { el.appendChild(document.createTextNode(' ')); return; }
    const w = document.createElement('span');
    w.className = 'w';
    w.setAttribute('aria-hidden', 'true');
    for (const ch of part) {
      const c = document.createElement('span');
      c.className = 'c';
      c.textContent = ch;
      w.appendChild(c);
      chars.push(c);
    }
    el.appendChild(w);
  });
  split.set(el, chars);
  if (reduced()) return undefined;
  // A random walk across the letters: mostly to a neighbour, sometimes a jump.
  const order: number[] = [];
  const left = new Set(chars.keys());
  let at = Math.floor(Math.random() * chars.length);
  while (left.size) {
    if (!left.has(at)) {
      const near = [at - 1, at + 1, at - 2, at + 2].filter((i) => left.has(i));
      at = near.length ? near[Math.floor(Math.random() * near.length)]! : [...left][Math.floor(Math.random() * left.size)]!;
    }
    order.push(at);
    left.delete(at);
    at += Math.random() < 0.5 ? -1 : 1;
  }
  gsap.set(chars, { opacity: 0, y: '0.35em', color: '#b6aad8' });
  return ScrollTrigger.create({
    trigger: el,
    start: 'top 88%',
    once: true,
    onEnter: () =>
      order.forEach((i, k) =>
        gsap.to(chars[i]!, { opacity: 1, y: 0, color: 'inherit', duration: 0.55, delay: k * 0.022, ease: 'back.out(2)', clearProps: 'color' }),
      ),
  });
}

export default function Chrome() {
  const router = useRouter();
  const pathname = usePathname();
  const fog = useRef<HTMLCanvasElement>(null);
  const trail = useRef<HTMLCanvasElement>(null);
  const pin = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLDivElement>(null);
  const routeRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const [progress, setProgress] = useState(0);

  // ---------- smooth scroll, nav state, route bar
  useEffect(() => {
    if (reduced()) return;
    const lenis = new Lenis({ lerp: 0.1 });
    (window as unknown as { __lenis: Lenis }).__lenis = lenis;
    lenis.on('scroll', (e: Lenis) => {
      ScrollTrigger.update();
      cityStore.boost = Math.min(1, cityStore.boost + Math.abs(e.velocity) * 0.004);
    });
    const tick = (t: number) => lenis.raf(t * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => { gsap.ticker.remove(tick); lenis.destroy(); };
  }, []);

  useEffect(() => {
    const nav = document.querySelector('.nav');
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      setProgress(max > 0 ? scrollY / max : 0);
      nav?.classList.toggle('scrolled', scrollY > 30);
    };
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });
    return () => removeEventListener('scroll', onScroll);
  }, [pathname]);

  // ---------- per page: headline walks, reveals, arrive animation
  useEffect(() => {
    const mine: ScrollTrigger[] = [];
    document.querySelectorAll<HTMLElement>('[data-walk]').forEach((el) => {
      const t = walkReveal(el);
      if (t) mine.push(t);
    });
    const els = gsap.utils.toArray<HTMLElement>('.reveal');
    if (reduced()) gsap.set(els, { opacity: 1, y: 0 });
    else
      mine.push(...ScrollTrigger.batch(els, {
        start: 'top 90%',
        once: true,
        onEnter: (b) => gsap.to(b, { opacity: 1, y: 0, duration: 0.9, ease: 'expo.out', stagger: 0.08 }),
      }));
    const lenis = (window as unknown as { __lenis?: Lenis }).__lenis;
    lenis?.scrollTo(0, { immediate: true });
    requestAnimationFrame(() => ScrollTrigger.refresh());
    // fog clears from the centre on arrival
    const raw = sessionStorage.getItem('hx-arrive');
    if (raw && fog.current) {
      sessionStorage.removeItem('hx-arrive');
      clearFog(fog.current);
    }
    // Only this effect's triggers: the page's own (story, deck) clean up after themselves.
    return () => mine.forEach((t) => t.kill());
  }, [pathname]);

  // ---------- hex fog page transition
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a');
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || !url.pathname.startsWith(BASE) || url.hash) return;
      const to = url.pathname.slice(BASE.length) || '/';
      if (to === pathname) return;
      e.preventDefault();
      // Capture phase: keep Next's own link handler from navigating before the fog has rolled in.
      e.stopPropagation();
      if (busy.current) return;
      if (reduced() || !fog.current) { router.push(to); return; }
      busy.current = true;
      router.prefetch(to);
      fillFog(fog.current, e.clientX, e.clientY, label.current!, NAMES[to] ?? to).then(() => {
        sessionStorage.setItem('hx-arrive', '1');
        router.push(to);
        busy.current = false;
      });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [pathname, router]);

  // ---------- map-pin cursor that paints a hex trail, magnetic buttons, hex press ripple
  useEffect(() => {
    if (matchMedia('(pointer: coarse)').matches || reduced()) return;
    document.documentElement.classList.add('has-pin');
    const cv = trail.current!, ctx = cv.getContext('2d')!;
    const size = () => { cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio; ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); };
    size();
    addEventListener('resize', size);
    const cells = new Map<string, { x: number; y: number; t: number; c: string }>();
    let colour = 0;
    const p = { x: innerWidth / 2, y: innerHeight / 2, tx: innerWidth / 2, ty: innerHeight / 2 };
    const R = 15, dx = Math.sqrt(3) * R, dy = 1.5 * R;
    const onMove = (e: PointerEvent) => {
      p.tx = e.clientX; p.ty = e.clientY;
      const row = Math.round(e.clientY / dy);
      const col = Math.round((e.clientX - (row % 2 ? dx / 2 : 0)) / dx);
      const key = `${col}_${row}`;
      if (!cells.has(key)) cells.set(key, { x: col * dx + (row % 2 ? dx / 2 : 0), y: row * dy, t: 1, c: PAINT[colour++ % 40 < 20 ? 0 : 1]! });
      const over = (e.target as HTMLElement).closest('a, button');
      pin.current?.classList.toggle('big', !!over);
    };
    addEventListener('pointermove', onMove);
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      p.x += (p.tx - p.x) * 0.35; p.y += (p.ty - p.y) * 0.35;
      if (pin.current) pin.current.style.translate = `${p.x}px ${p.y}px`;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const [k, c] of cells) {
        c.t -= 0.018;
        if (c.t <= 0) { cells.delete(k); continue; }
        hexPath(ctx, c.x, c.y, R - 1.5);
        ctx.fillStyle = c.c;
        ctx.globalAlpha = c.t * 0.16;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(loop);

    const mags = new Map<HTMLElement, { x: number; y: number }>();
    const onMag = (e: PointerEvent) => {
      document.querySelectorAll<HTMLElement>('.btn').forEach((b) => {
        const r = b.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const d = Math.hypot(e.clientX - cx, e.clientY - cy);
        const pull = d < 110 ? (1 - d / 110) * 0.3 : 0;
        const v = { x: (e.clientX - cx) * pull, y: (e.clientY - cy) * pull };
        const prev = mags.get(b);
        if (!prev || Math.abs(prev.x - v.x) + Math.abs(prev.y - v.y) > 0.3) {
          b.style.transform = `translate(${v.x}px, ${v.y}px)`;
          mags.set(b, v);
        }
      });
    };
    addEventListener('pointermove', onMag);
    const onDown = (e: PointerEvent) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('.btn');
      if (!b) return;
      const r = b.getBoundingClientRect();
      const s = document.createElement('span');
      s.className = 'ripple';
      s.style.left = `${e.clientX - r.left}px`;
      s.style.top = `${e.clientY - r.top}px`;
      b.appendChild(s);
      gsap.to(s, { scale: 14, opacity: 0, duration: 0.7, ease: 'power2.out', onComplete: () => s.remove() });
    };
    addEventListener('pointerdown', onDown);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('resize', size);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointermove', onMag);
      removeEventListener('pointerdown', onDown);
      document.documentElement.classList.remove('has-pin');
    };
  }, []);

  const at = Math.min(STOPS.length - 1, Math.floor(progress * STOPS.length));
  return (
    <>
      <canvas id="trail" ref={trail} aria-hidden="true" />
      <div className="pin" ref={pin} aria-hidden="true">
        <svg viewBox="0 0 26 34" width="26" height="34">
          <path d="M13 33 C13 33 2 20 2 12 A11 11 0 0 1 24 12 C24 20 13 33 13 33 Z" fill="#1b1538" />
          <path d="M13 6.5 L18 9.25 V14.75 L13 17.5 L8 14.75 V9.25 Z" fill="#00c2ff" />
        </svg>
      </div>
      <canvas id="fog" ref={fog} aria-hidden="true" />
      <div className="fog-label" ref={label} aria-hidden="true" />
      <div ref={routeRef} className={`route${progress > 0.02 && progress < 0.96 ? ' on' : ''}`} aria-hidden="true">
        <div className="route-top">
          <span>Walking past <b>{STOPS[at]}</b></span>
          <span>{Math.round(progress * 100)}% explored</span>
        </div>
        <div className="route-line">
          <div className="route-fill" style={{ width: `${progress * 100}%` }} />
          {STOPS.map((s, i) => (
            <i key={s} className={progress * (STOPS.length - 1) >= i ? 'past' : ''} style={{ left: `${(i / (STOPS.length - 1)) * 100}%` }} />
          ))}
          <div className="route-dot" style={{ left: `${progress * 100}%` }} />
        </div>
      </div>
    </>
  );
}

function setupCanvas(cv: HTMLCanvasElement) {
  cv.width = innerWidth * devicePixelRatio;
  cv.height = innerHeight * devicePixelRatio;
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  return ctx;
}

/** Fog rolls in: hexes fill outward from the click until the screen is covered. */
function fillFog(cv: HTMLCanvasElement, ox: number, oy: number, label: HTMLElement, name: string) {
  const ctx = setupCanvas(cv);
  const cells = hexCells(innerWidth, innerHeight, ox, oy);
  const maxD = cells[cells.length - 1]!.d;
  const dur = 620;
  label.textContent = `Walking to ${name}`;
  return new Promise<void>((done) => {
    const t0 = performance.now();
    const frame = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const c of cells) {
        const local = Math.min(1, Math.max(0, (k * 1.35 - (c.d / maxD) * 0.9) / 0.45));
        if (local <= 0) break;
        hexPath(ctx, c.x, c.y, HEX * (0.4 + 0.62 * local));
        ctx.fillStyle = local < 1 ? '#cbc1e6' : '#e8e3f3';
        ctx.fill();
      }
      label.style.opacity = String(Math.max(0, (k - 0.6) / 0.4));
      if (k < 1) requestAnimationFrame(frame);
      else setTimeout(done, 120);
    };
    requestAnimationFrame(frame);
  });
}

/** Fog lifts: hexes shrink away from the centre, revealing the new page. */
function clearFog(cv: HTMLCanvasElement) {
  const ctx = setupCanvas(cv);
  const cells = hexCells(innerWidth, innerHeight, innerWidth / 2, innerHeight / 2);
  const maxD = cells[cells.length - 1]!.d;
  const label = document.querySelector<HTMLElement>('.fog-label');
  const t0 = performance.now();
  const dur = 760;
  const frame = (now: number) => {
    const k = Math.min(1, (now - t0) / dur);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const c of cells) {
      const local = 1 - Math.min(1, Math.max(0, (k * 1.35 - (c.d / maxD) * 0.9) / 0.45));
      if (local <= 0) continue;
      hexPath(ctx, c.x, c.y, HEX * 1.02 * local);
      ctx.fillStyle = '#e8e3f3';
      ctx.fill();
    }
    if (label) label.style.opacity = String(Math.max(0, 1 - k * 3));
    if (k < 1) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  };
  requestAnimationFrame(frame);
}
