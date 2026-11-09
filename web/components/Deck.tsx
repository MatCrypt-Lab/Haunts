'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { AskScreen, CardScreen, CrewScreen, MapScreen, MemoryScreen, Phone } from './Phones';

gsap.registerPlugin(ScrollTrigger);

const ITEMS = [
  { S: MemoryScreen, caption: 'Memory and journal', label: 'Memory screen: day map, stops and an AI journal entry' },
  { S: AskScreen, caption: 'Ask Haunts', label: 'Ask screen: a question, what the phone shared, and a real nearby cafe' },
  { S: MapScreen, caption: 'The map', label: 'Map screen: walked blocks painted over a dark city' },
  { S: CrewScreen, caption: 'Your crew', label: 'Crew screen: AI coach and weekly points' },
  { S: CardScreen, caption: 'Story card', label: 'Card screen: a shareable story card with an AI caption' },
];

/** Five phones stacked like a deck; scrolling fans them out, the pointer tilts the fan. */
export default function Deck() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current!;
    const phones = gsap.utils.toArray<HTMLElement>('.deck .phone', el);
    if (matchMedia('(max-width: 760px)').matches) return;
    const mid = (phones.length - 1) / 2;
    const fan = { k: 0, tx: 0, ty: 0 };
    const apply = () =>
      phones.forEach((p, i) => {
        const o = i - mid;
        const k = fan.k;
        p.style.transform = `translateX(${o * 250 * k}px) translateY(${Math.abs(o) * 34 * k}px) rotate(${o * 6 * k}deg) rotateY(${fan.tx * 14 - o * 4 * k}deg) rotateX(${-fan.ty * 10}deg) scale(${1 - Math.abs(o) * 0.06 * k})`;
        p.style.zIndex = String(10 - Math.abs(Math.round(o)));
      });
    apply();
    const st = gsap.to(fan, {
      k: 1,
      ease: 'none',
      onUpdate: apply,
      scrollTrigger: { trigger: el, start: 'top 85%', end: 'center 55%', scrub: 0.8 },
    });
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      gsap.to(fan, { tx: (e.clientX - r.left) / r.width - 0.5, ty: (e.clientY - r.top) / r.height - 0.5, duration: 0.8, onUpdate: apply });
    };
    el.addEventListener('pointermove', onMove);
    return () => {
      st.scrollTrigger?.kill();
      st.kill();
      el.removeEventListener('pointermove', onMove);
    };
  }, []);

  return (
    <div className="deck" ref={root}>
      {ITEMS.map(({ S, caption, label }) => (
        <Phone key={caption} w={250} label={label}>
          <S />
          <span className="sr-only">{caption}</span>
        </Phone>
      ))}
    </div>
  );
}
