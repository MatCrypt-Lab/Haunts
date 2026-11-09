'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { buildGrid, hoodIndex, NEIGHBOUR_DIRS } from '@/lib/city';
import { cityStore } from '@/lib/store';

const MIST = new THREE.Color('#e8e3f3');
const YOU = new THREE.Color('#00a8e0');
// Simulated crews for the territory chapter, in the app's crew colours.
const CREWS = [
  { name: 'Koramangala Owls', color: '#ff5a5f', hoods: ['koramangala', 'btm-layout', 'hsr-layout'] },
  { name: 'Indiranagar Runners', color: '#4d7cfe', hoods: ['indiranagar', 'domlur', 'halasuru', 'jeevan-bhima-nagar'] },
  { name: 'Jayanagar Juniors', color: '#ff9f1c', hoods: ['jayanagar', 'basavanagudi', 'wilson-garden'] },
];

const vert = /* glsl */ `
attribute float aReveal;
attribute float aSeed;
attribute float aOwner;
attribute float aStop;
uniform float uTime;
uniform float uOwnerMix;
uniform float uStopMix;
varying float vReveal;
varying float vOwner;
varying float vTop;
varying float vH;
varying float vStop;
varying vec3 vWorld;
void main() {
  float own = aOwner >= 0.0 ? step(0.45, fract(aSeed * 7.13)) * uOwnerMix : 0.0;
  float rev = max(aReveal, own);
  vReveal = rev;
  vOwner = aOwner;
  vStop = aStop * uStopMix;
  float fogH = 0.05 + 0.035 * sin(uTime * 0.7 + aSeed * 31.0);
  float h = mix(fogH, 0.22 + aSeed * 0.5, rev) + vStop * 0.9;
  vec3 p = position;
  vH = p.y;
  p.y *= h;
  vTop = normal.y;
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const frag = /* glsl */ `
uniform float uTime;
uniform float uOwnerMix;
uniform vec3 uMist;
uniform vec3 uYou;
uniform vec3 uCrew0;
uniform vec3 uCrew1;
uniform vec3 uCrew2;
uniform vec3 uCam;
uniform float uFogFar;
varying float vReveal;
varying float vOwner;
varying float vTop;
varying float vH;
varying float vStop;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  float mist = fbm(vWorld.xz * 0.09 + vec2(uTime * 0.03, uTime * 0.018));
  vec3 fogCol = mix(uMist * 0.9, vec3(1.0), mist * 0.55);
  vec3 paint = uYou;
  // No dynamic array indexing: some GPUs return garbage for it.
  vec3 crew = vOwner < 0.5 ? uCrew0 : vOwner < 1.5 ? uCrew1 : uCrew2;
  if (vOwner > -0.5) paint = mix(uYou, crew, uOwnerMix);
  paint = mix(paint, vec3(0.416, 0.247, 0.82), vStop);
  float shade = vTop > 0.5 ? 1.0 : 0.62 + 0.3 * vH;
  vec3 col = mix(fogCol * (vTop > 0.5 ? 1.0 : 0.86), paint * shade + vec3(0.12) * vTop, vReveal);
  float d = distance(vWorld, uCam);
  float f = smoothstep(uFogFar * 0.45, uFogFar, d);
  col = mix(col, uMist, f);
  gl_FragColor = vec4(col, 1.0);
}`;

const moteVert = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uPx;
varying float vA;
void main() {
  vec3 p = position;
  p.x += sin(uTime * 0.12 + aSeed * 40.0) * 2.0;
  p.z += cos(uTime * 0.1 + aSeed * 23.0) * 2.0;
  p.y += sin(uTime * 0.4 + aSeed * 9.0) * 0.3;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uPx * (2.0 + aSeed * 5.0) * (24.0 / -mv.z);
  vA = 0.25 + 0.55 * fract(aSeed * 13.7);
  gl_Position = projectionMatrix * mv;
}`;
const moteFrag = /* glsl */ `
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  gl_FragColor = vec4(1.0, 1.0, 1.0, smoothstep(0.5, 0.0, d) * vA);
}`;

type Walker = { cell: number; dir: number; color: THREE.Color };

/** Camera keyframes per story chapter: [orbit angle, height, distance, look-x, look-z]. */
const SHOTS: [number, number, number, number, number][] = [
  [0.35, 22, 30, 0, 2],
  [0.9, 11, 16, -2, 4],
  [0.1, 38, 34, 0, 0],
  [-0.5, 16, 22, 2, 3],
];

export default function CityScene() {
  const ref = useRef<HTMLCanvasElement>(null);
  const labels = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const grid = buildGrid();
    const n = grid.count;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    let dpr = Math.min(devicePixelRatio, 1.5);
    renderer.setPixelRatio(dpr);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 200);

    // ----- hex blocks
    const geo = new THREE.CylinderGeometry(0.53, 0.53, 1, 6, 1);
    geo.translate(0, 0.5, 0);
    const reveal = new Float32Array(n);
    const target = new Float32Array(n);
    const seed = new Float32Array(n);
    const owner = new Float32Array(n).fill(-1);
    const stop = new Float32Array(n);
    const crewHoods = CREWS.map((c) => c.hoods.map(hoodIndex).filter((i) => i >= 0));
    for (let i = 0; i < n; i++) {
      seed[i] = Math.random();
      const k = crewHoods.findIndex((hs) => hs.includes(grid.nb[i]!));
      owner[i] = k;
    }
    const inst = new THREE.InstancedBufferGeometry().copy(geo as unknown as THREE.InstancedBufferGeometry);
    inst.instanceCount = n;
    const aReveal = new THREE.InstancedBufferAttribute(reveal, 1);
    aReveal.setUsage(THREE.DynamicDrawUsage);
    inst.setAttribute('aReveal', aReveal);
    inst.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    inst.setAttribute('aOwner', new THREE.InstancedBufferAttribute(owner, 1));
    const aStop = new THREE.InstancedBufferAttribute(stop, 1);
    inst.setAttribute('aStop', aStop);
    const uniforms = {
      uTime: { value: 0 },
      uOwnerMix: { value: 0 },
      uStopMix: { value: 0 },
      uMist: { value: MIST },
      uYou: { value: YOU },
      uCrew0: { value: new THREE.Color(CREWS[0]!.color) },
      uCrew1: { value: new THREE.Color(CREWS[1]!.color) },
      uCrew2: { value: new THREE.Color(CREWS[2]!.color) },
      uCam: { value: new THREE.Vector3() },
      uFogFar: { value: 60 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms });
    const mesh = new THREE.InstancedMesh(inst, mat, n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) mesh.setMatrixAt(i, m4.makeTranslation(grid.x[i]!, 0, grid.z[i]!));
    mesh.frustumCulled = false;
    scene.add(mesh);

    // ----- mist motes
    const MOTES = 5000;
    const mp = new Float32Array(MOTES * 3);
    const ms = new Float32Array(MOTES);
    for (let i = 0; i < MOTES; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * 46;
      mp[i * 3] = Math.cos(a) * rr;
      mp[i * 3 + 1] = 0.3 + Math.random() * 5;
      mp[i * 3 + 2] = Math.sin(a) * rr;
      ms[i] = Math.random();
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    mg.setAttribute('aSeed', new THREE.BufferAttribute(ms, 1));
    const moteU = { uTime: uniforms.uTime, uPx: { value: dpr } };
    const motes = new THREE.Points(mg, new THREE.ShaderMaterial({ vertexShader: moteVert, fragmentShader: moteFrag, uniforms: moteU, transparent: true, depthWrite: false }));
    scene.add(motes);

    // ----- drop pulses (amber rings)
    const rings: { m: THREE.Mesh; t: number }[] = [];
    const ringGeo = new THREE.RingGeometry(0.6, 0.78, 6);
    ringGeo.rotateX(-Math.PI / 2);
    const spawnRing = (i: number) => {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ff9f1c', transparent: true, depthWrite: false }));
      m.position.set(grid.x[i]!, 0.9, grid.z[i]!);
      scene.add(m);
      rings.push({ m, t: 0 });
    };

    // ----- AI route (chapter 4): a walk through three places, drawn progressively
    const routeCells: number[] = [];
    const routeMat = new THREE.MeshBasicMaterial({ color: '#6a3fd1' });
    let routeMesh: THREE.Mesh | null = null;
    let routeTris = 0;

    // ----- walkers (simulation)
    const startHoods = ['koramangala', 'indiranagar', 'hsr-layout'].map((id) => grid.hood.find((h) => h.id === id)).filter(Boolean);
    const nearest = (x: number, z: number) => {
      let best = 0, bd = Infinity;
      for (let i = 0; i < n; i++) {
        const d = (grid.x[i]! - x) ** 2 + (grid.z[i]! - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    };
    const walkers: Walker[] = startHoods.map((h) => ({ cell: nearest(h!.x, h!.z), dir: Math.floor(Math.random() * 6), color: YOU }));
    const step = (w: Walker) => {
      if (Math.random() > 0.78) w.dir = (w.dir + (Math.random() < 0.5 ? 1 : 5)) % 6;
      for (let tries = 0; tries < 6; tries++) {
        const [dq, dr] = NEIGHBOUR_DIRS[w.dir]!;
        const next = grid.index.get(`${grid.q[w.cell]! + dq}_${grid.r[w.cell]! + dr}`);
        if (next !== undefined) { w.cell = next; break; }
        w.dir = (w.dir + 2) % 6;
      }
      if (target[w.cell] === 0) cityStore.painted++;
      target[w.cell] = 1;
    };
    // Pre-walk so the map is never empty, then pick memory stops and the AI route from it.
    for (let s = 0; s < 260; s++) walkers.forEach(step);
    for (let i = 0; i < n; i++) reveal[i] = target[i]!;
    cityStore.painted = 0; // the counter only shows what is painted while you watch
    const painted = [...target.keys()].filter((i) => target[i] === 1);
    for (let k = 0; k < 7; k++) stop[painted[Math.floor(Math.random() * painted.length)]!] = 1;
    aStop.needsUpdate = true;
    {
      const w: Walker = { cell: walkers[0]!.cell, dir: 0, color: YOU };
      for (let s = 0; s < 70; s++) {
        // Turn every few blocks, alternating sides, so it reads as a street walk.
        if (s % 5 === 0) w.dir = (w.dir + (s % 10 === 0 ? 1 : 5)) % 6;
        const [dq, dr] = NEIGHBOUR_DIRS[w.dir]!;
        const next = grid.index.get(`${grid.q[w.cell]! + dq}_${grid.r[w.cell]! + dr}`);
        if (next === undefined) { w.dir = (w.dir + 1) % 6; continue; }
        w.cell = next;
        routeCells.push(next);
      }
      if (routeCells.length > 2) {
        const pts = routeCells.map((i) => new THREE.Vector3(grid.x[i]!, 1.15, grid.z[i]!));
        const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), routeCells.length * 3, 0.13, 6, false);
        routeTris = tube.index!.count;
        tube.setDrawRange(0, 0);
        routeMesh = new THREE.Mesh(tube, routeMat);
        scene.add(routeMesh);
      }
    }

    // ----- labels
    const labelEls = grid.hood.slice(0, 14).map((h) => {
      const el = document.createElement('span');
      el.className = 'nb-label';
      el.textContent = h.name;
      labels.current!.appendChild(el);
      return { el, v: new THREE.Vector3(h.x, 0.6, h.z) };
    });

    // ----- sizing, pointer, loop
    const size = () => {
      const w = innerWidth, h = innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    size();
    addEventListener('resize', size);
    const ptr = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => { ptr.x = e.clientX / innerWidth - 0.5; ptr.y = e.clientY / innerHeight - 0.5; };
    addEventListener('pointermove', onMove);

    // The Ask chapter's camera looks at the middle of the planned route.
    const shots = SHOTS.map((s) => [...s] as [number, number, number, number, number]);
    if (routeCells.length) {
      const mid = routeCells[Math.floor(routeCells.length / 2)]!;
      shots[3]![3] = grid.x[mid]!;
      shots[3]![4] = grid.z[mid]!;
    }
    const cur = { a: SHOTS[0]![0], h: SHOTS[0]![1], d: SHOTS[0]![2], lx: 0, lz: 2 };
    const tmp = new THREE.Vector3();
    let raf = 0, last = performance.now(), acc = 0, slow = 0, nextRing = 3, first = true;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (cityStore.visible < 0.01 && !first) return;
      const t = (uniforms.uTime.value += dt);

      // walkers keep painting on their own; scrolling makes them hurry
      acc += dt * (5 + cityStore.boost * 30) * (reduce ? 0.2 : 1);
      while (acc > 1) { acc--; walkers.forEach(step); }
      let changed = false;
      for (let i = 0; i < n; i++) {
        if (reveal[i]! < target[i]!) { reveal[i] = Math.min(1, reveal[i]! + dt * 2.5); changed = true; }
      }
      if (changed) aReveal.needsUpdate = true;
      cityStore.boost *= 0.92;

      // story state
      const ch = Math.max(0, Math.min(3, cityStore.chapter));
      uniforms.uStopMix.value = Math.max(0, 1 - Math.abs(ch - 1) * 1.4);
      uniforms.uOwnerMix.value = Math.max(0, 1 - Math.abs(ch - 2) * 1.4);
      if (routeMesh) (routeMesh.geometry as THREE.BufferGeometry).setDrawRange(0, Math.floor(routeTris * Math.max(0, Math.min(1, (ch - 2.4) / 0.5)) / 3) * 3);

      if ((nextRing -= dt) < 0) { nextRing = 5 + Math.random() * 3; spawnRing(painted[Math.floor(Math.random() * painted.length)]!); }
      for (let k = rings.length - 1; k >= 0; k--) {
        const r = rings[k]!;
        r.t += dt;
        r.m.scale.setScalar(1 + r.t * 3.2);
        (r.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - r.t / 1.8);
        if (r.t > 1.8) { scene.remove(r.m); (r.m.material as THREE.Material).dispose(); rings.splice(k, 1); }
      }

      // camera eases toward the chapter's shot
      const i0 = Math.floor(ch), i1 = Math.min(3, i0 + 1), f = ch - i0;
      const s0 = shots[i0]!, s1 = shots[i1]!;
      const portrait = camera.aspect < 0.9 ? 1.55 : 1;
      const k = 1 - Math.pow(0.002, dt);
      cur.a += (s0[0] + (s1[0] - s0[0]) * f + t * 0.01 + ptr.x * 0.15 - cur.a) * k;
      cur.h += (s0[1] + (s1[1] - s0[1]) * f - ptr.y * 3 - cur.h) * k;
      cur.d += ((s0[2] + (s1[2] - s0[2]) * f) * portrait - cur.d) * k;
      cur.lx += (s0[3] + (s1[3] - s0[3]) * f - cur.lx) * k;
      cur.lz += (s0[4] + (s1[4] - s0[4]) * f - cur.lz) * k;
      camera.position.set(cur.lx + Math.sin(cur.a) * cur.d, cur.h * portrait, cur.lz + Math.cos(cur.a) * cur.d);
      camera.lookAt(cur.lx, 0, cur.lz);
      uniforms.uCam.value.copy(camera.position);
      uniforms.uFogFar.value = 55 * portrait;

      canvas.style.opacity = String(cityStore.visible);
      renderer.render(scene, camera);

      for (const l of labelEls) {
        tmp.copy(l.v).project(camera);
        const sy = (-tmp.y * 0.5 + 0.5) * innerHeight;
        const on = tmp.z < 1 && Math.abs(tmp.x) < 0.92 && sy > 110 && sy < innerHeight - 40;
        l.el.style.opacity = on ? String(0.85 * cityStore.visible) : '0';
        l.el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * innerWidth}px, ${sy}px) translate(-50%, -50%)`;
      }

      // step the resolution down if frames stay slow
      slow = slow * 0.95 + dt * 0.05;
      if (slow > 0.026 && dpr > 0.75) { dpr -= 0.25; renderer.setPixelRatio(dpr); size(); slow = 0.016; }
      if (first) { first = false; canvas.classList.add('ready'); }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('resize', size);
      removeEventListener('pointermove', onMove);
      labelEls.forEach((l) => l.el.remove());
      renderer.dispose();
      inst.dispose();
      mat.dispose();
      mg.dispose();
    };
  }, []);

  return (
    <>
      <canvas id="city" ref={ref} aria-label="3D map of central Bengaluru in 60 metre blocks. Simulated walkers paint blocks as they explore." role="img" />
      <div ref={labels} aria-hidden="true" />
    </>
  );
}
