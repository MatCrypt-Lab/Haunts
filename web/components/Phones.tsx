// The app's screens, redrawn in code from the real app (same colours, layout and copy),
// so they stay sharp at any size and can move. Not screenshots.
import type { CSSProperties, ReactNode } from 'react';

const SQ3 = Math.sqrt(3);
function hexPoints(cx: number, cy: number, r: number) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

/** A walked route through a hex grid: a fixed, hand-picked path so server and client match. */
const WALK: [number, number][] = [
  [3, 9], [4, 9], [5, 9], [5, 10], [6, 10], [7, 10], [7, 11], [8, 11], [8, 12], [8, 13], [7, 13], [6, 13], [6, 14],
  [5, 14], [4, 14], [4, 15], [3, 15], [3, 16], [4, 16], [5, 16], [6, 16], [7, 16], [8, 16], [9, 16], [9, 17],
  [5, 5], [5, 6], [6, 6], [7, 6], [8, 6], [8, 7], [9, 7], [10, 7],
];

export function Phone({ children, w = 270, className = '', style, label }: { children: ReactNode; w?: number; className?: string; style?: CSSProperties; label: string }) {
  return (
    <div className={`phone ${className}`} style={{ '--w': `${w}px`, ...style } as CSSProperties} role="img" aria-label={label}>
      <div className="screen">{children}</div>
    </div>
  );
}

function Tabs({ on }: { on: string }) {
  return (
    <div className="tabbar">
      {['Map', 'Ask', 'Memory', 'Crew', 'Card', 'Me'].map((t) => (
        <span key={t} className={t === on ? 'on' : ''}>{t}</span>
      ))}
    </div>
  );
}

export function MapScreen() {
  const r = 11, dx = SQ3 * r, dy = 1.5 * r;
  const painted = new Map(WALK.map(([c, rw], i) => [`${c}_${rw}`, i]));
  const cells: ReactNode[] = [];
  for (let row = 0; row < 26; row++) {
    for (let col = 0; col < 12; col++) {
      const x = col * dx + (row % 2 ? dx / 2 : 0), y = row * dy + 20;
      const i = painted.get(`${col}_${row}`);
      cells.push(
        <polygon
          key={`${col}_${row}`}
          points={hexPoints(x, y, r - 0.8)}
          className={i !== undefined ? 'hx-p' : undefined}
          style={i !== undefined ? ({ '--i': i } as CSSProperties) : undefined}
          fill={i !== undefined ? '#ff5a5f' : 'none'}
          stroke={i !== undefined ? '#ff8a8e' : 'rgba(255,255,255,0.035)'}
        />,
      );
    }
  }
  return (
    <div className="app" style={{ padding: 0 }}>
      <svg className="map-svg" viewBox="0 0 270 470" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="270" height="470" fill="#0b0b12" />
        <path d="M-10 150 C 60 140 120 190 290 170 M 40 -10 C 60 120 30 300 80 480 M 150 -10 C 170 200 210 300 200 480 M -10 330 C 90 300 160 360 290 320" stroke="#1c1c28" strokeWidth="9" fill="none" />
        {cells}
        <circle cx="168" cy="300" r="6" fill="#00c2ff" stroke="#fff" strokeWidth="2.5" />
      </svg>
      <div className="hud">
        <b>0.11%</b>
        <span className="sub">of Bengaluru explored</span>
        <div style={{ color: '#ff5a5f', fontSize: '.85em', fontWeight: 700 }}>+74 this week</div>
      </div>
      <div className="track-badge">● Tracking</div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '0 calc(var(--w) * 0.055)' }}>
        <Tabs on="Map" />
      </div>
    </div>
  );
}

export function AskScreen() {
  return (
    <div className="app">
      <h4>Ask Haunts</h4>
      <span className="sub">Your city, your memory, your crew.</span>
      <div className="seq" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--w) * 0.025)' }}>
        <div className="bubble me" style={{ '--i': 0 } as CSSProperties}>Quiet cafe nearby I haven&apos;t tried</div>
        <div className="sub" style={{ '--i': 1, fontSize: '.72em' } as CSSProperties}>🔒 Shared from your phone: whether you have been to 10 nearby places</div>
        <div className="bubble ai" style={{ '--i': 2 } as CSSProperties}>The Hole In The Wall Cafe is 92 m away and the only one listed with wifi. Open 8 AM to 9 PM.</div>
        <div className="ui-card" style={{ '--i': 3 } as CSSProperties}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
            <span>The Hole In The Wall Cafe</span>
            <span className="sub">92 m</span>
          </div>
          <span className="sub" style={{ fontSize: '.75em' }}>cafe · american · wifi · 8th Main Road</span>
          <div className="ui-btns">
            <span className="ui-btn">Map</span>
            <span className="ui-btn">Save to try</span>
          </div>
        </div>
        <div className="chip-row" style={{ '--i': 4 } as CSSProperties}>
          <span className="ui-chip">Walk me there</span>
          <span className="ui-chip">Anything open late?</span>
        </div>
      </div>
      <Tabs on="Ask" />
    </div>
  );
}

export function MemoryScreen() {
  return (
    <div className="app">
      <h4>Memory</h4>
      <span className="sub">Everywhere you have been. Only you can see this.</span>
      <div className="ui-card" style={{ padding: 0, overflow: 'hidden' }}>
        <svg viewBox="0 0 240 110" aria-hidden="true">
          <rect width="240" height="110" fill="#0e0e16" />
          <path d="M0 70 C 50 60 90 90 240 72 M 70 0 C 80 50 60 80 90 110" stroke="#1c1c28" strokeWidth="6" fill="none" />
          <path className="draw" d="M30 80 L 70 80 L 110 50 L 120 28 L 168 28 L 150 46 M 120 50 L 160 50 L 180 70 L 150 92 L 116 86 Z" stroke="#ff5a5f" strokeWidth="2.6" fill="none" strokeLinejoin="round" />
          <circle cx="30" cy="80" r="5" fill="#ff5a5f" />
          <circle cx="70" cy="80" r="5" fill="#ff5a5f" />
          <circle cx="116" cy="86" r="5" fill="#fff" />
          <circle cx="168" cy="28" r="5" fill="#ff5a5f" />
        </svg>
      </div>
      <b style={{ fontSize: '1.05em' }}>4 stops <span className="sub" style={{ float: 'right', fontWeight: 500 }}>41m in total</span></b>
      {[
        ['☕ Test Cafe', '10:43 PM to 10:57 PM · 14m', ''],
        ['4th B Cross Road, Koramangala', '11:09 PM to 11:16 PM · 7m', 'Name it'],
      ].map(([a, b, c]) => (
        <div key={a} className="ui-card" style={{ gridTemplateColumns: '1fr auto', alignItems: 'center' }}>
          <span><b style={{ display: 'block', fontSize: '.92em' }}>{a}</b><span className="sub" style={{ fontSize: '.72em' }}>{b}</span></span>
          {c ? <span style={{ color: 'var(--app-accent)', fontWeight: 700, fontSize: '.8em' }}>{c}</span> : null}
        </div>
      ))}
      <div className="ui-card">
        <span className="ui-label">✦ Journal</span>
        <b>Ten Minutes After Two</b>
        <span className="sub typing" style={{ fontSize: '.78em' }}>While most of Bengaluru slept, you were in Koramangala</span>
      </div>
      <Tabs on="Memory" />
    </div>
  );
}

export function CrewScreen() {
  const members = [
    ['Priya', 'Owner · 434 blocks', 993],
    ['Arjun', '254 blocks', 591],
    ['Meera', '169 blocks', 384],
    ['sudeep.walks (you)', '64 blocks', 76],
  ] as const;
  return (
    <div className="app">
      <h4>Koramangala Owls</h4>
      <span className="sub">5 of 20 members · Rank 1 · 4 neighbourhoods</span>
      <div className="ui-card">
        <span className="ui-label">✦ Crew coach</span>
        <span style={{ fontSize: '.8em' }}>Runners gained ground in HSR overnight. Defend it today: about 120 block-days does it. Arjun and Meera are closest.</span>
      </div>
      {members.map(([n, s, p]) => (
        <div key={n} className="ui-card" style={{ gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 'calc(var(--w) * 0.03)' }}>
          <span><b style={{ display: 'block', fontSize: '.9em' }}>{n}</b><span className="sub" style={{ fontSize: '.72em' }}>{s}</span></span>
          <span style={{ textAlign: 'right' }}><b style={{ color: '#ff5a5f', display: 'block' }}>{p}</b><span className="sub" style={{ fontSize: '.65em' }}>pts</span></span>
        </div>
      ))}
      <Tabs on="Crew" />
    </div>
  );
}

export function CardScreen() {
  const cells: ReactNode[] = [];
  const r = 7.5, dx = SQ3 * r, dy = 1.5 * r;
  WALK.slice(0, 25).forEach(([c, rw], i) => {
    cells.push(<polygon key={i} points={hexPoints((c - 2) * dx + (rw % 2 ? dx / 2 : 0) + 40, (rw - 8) * dy + 30, r - 0.6)} fill="#ff5a5f" opacity={0.9} />);
  });
  return (
    <div className="app">
      <h4>Your card</h4>
      <span className="sub">Share it to your Story.</span>
      <div style={{ borderRadius: 'calc(var(--w) * 0.03)', background: '#0b0b14', padding: 'calc(var(--w) * 0.06)', display: 'grid', gap: 'calc(var(--w) * 0.015)' }}>
        <span style={{ fontWeight: 800, letterSpacing: '.18em', fontSize: '.7em' }}>HAUNTS</span>
        <b style={{ font: '800 2.3em/1 var(--display)' }}>74</b>
        <span className="sub">blocks of Bengaluru explored</span>
        <i style={{ fontSize: '.8em' }}>Owls at No. 1. I did my bit.</i>
        <svg viewBox="0 0 200 130" aria-hidden="true">{cells}</svg>
        <b style={{ color: '#ff5a5f', fontSize: '.85em' }}>+74 blocks this week</b>
        <span style={{ fontSize: '.75em', fontWeight: 700 }}>@sudeep.walks · Koramangala Owls</span>
      </div>
      <div className="ui-btns"><span className="ui-btn pri">Share card</span></div>
      <Tabs on="Card" />
    </div>
  );
}
