'use client';

import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { cityStore } from '@/lib/store';
import { AskScreen, CrewScreen, MapScreen, MemoryScreen, Phone } from './Phones';

gsap.registerPlugin(ScrollTrigger);

export type Chapter = { tag: string; title: string; body: string; fact: string };

const SCREENS = [MapScreen, MemoryScreen, CrewScreen, AskScreen];

export default function Story({ chapters }: { chapters: Chapter[] }) {
  const root = useRef<HTMLElement>(null);
  const [on, setOn] = useState(0);

  useEffect(() => {
    const state = { ch: 0 };
    const tl = gsap.to(state, {
      ch: chapters.length - 1,
      ease: 'none',
      // On the tween, not the trigger: the trigger's update fires before scrub smoothing catches up.
      onUpdate: () => {
        cityStore.chapter = state.ch;
        setOn(Math.min(chapters.length - 1, Math.round(state.ch)));
      },
      scrollTrigger: { trigger: root.current, start: 'top top', end: 'bottom bottom', scrub: 0.6 },
    });
    // The city fades out as the section after the story scrolls in.
    const fade = ScrollTrigger.create({
      trigger: root.current,
      start: 'bottom bottom',
      end: 'bottom 30%',
      onUpdate: (s) => (cityStore.visible = 1 - s.progress),
      onLeaveBack: () => (cityStore.visible = 1),
    });
    return () => {
      tl.scrollTrigger?.kill();
      tl.kill();
      fade.kill();
      cityStore.chapter = 0;
      cityStore.visible = 1;
    };
  }, [chapters.length]);

  return (
    <section className="story" ref={root} aria-label="How Haunts works, in four steps">
      <div className="story-stage">
        <div className="callout">
          {chapters.map((c, i) => (
            <div key={c.title} className={`chapter${i === on ? ' on' : ''}`} aria-hidden={i !== on}>
              <span className="tag">{c.tag}</span>
              <h3>{c.title}</h3>
              <p>{c.body}</p>
              <p className="fact">{c.fact}</p>
            </div>
          ))}
        </div>
        <div className="chapters-dots" aria-hidden="true">
          {chapters.map((c, i) => <i key={c.title} className={i === on ? 'on' : ''} />)}
        </div>
        <Phone w={250} className="story-phone" label={`The ${['map', 'memory', 'crew', 'Ask'][on]} screen of the Haunts app`}>
          {SCREENS.map((S, i) => (
            <div key={i} className={i === on ? 'on' : ''}><S /></div>
          ))}
        </Phone>
      </div>
    </section>
  );
}
