'use client';

// The WebGL part of the 3D view. Loaded only on the client, and only when the
// 3D tab opens (next/dynamic with ssr: false in warehouse-3d.tsx), so three.js
// never weighs on the rest of the app.
//
// Performance: every slot of the warehouse is ONE instanced mesh (one draw
// call), and rack frames are three more. Clicks resolve through instanceId.
// The canvas renders on demand, so an idle view costs nothing.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  type Scene3D, type PlacedRack, type PlacedSlot,
  SLOT_W, SLOT_H, RACK_D, BASE_Y, STATE_3D, GHOST_COLOR, boundsOf, rackToWorld,
} from './scene-geometry';

export interface SceneApi {
  zoom: (factor: number) => void;
  rotate: (dAzimuth: number, dPolar: number) => void;
  reset: () => void;
  top: () => void;
  focus: (x: number, z: number) => void;
}
export interface CameraInfo { x: number; z: number; tx: number; tz: number }

type Bounds = ReturnType<typeof boundsOf>;
type Controls = ComponentRef<typeof OrbitControls>;

const MAX_POLAR = Math.PI / 2 - 0.08; // never look from below the floor
const DRAG_PX = 5;                     // a pointer that moved more than this was a drag, not a click

// ─── Instanced boxes (slots and rack frames) ─────────────────────────────────

interface BoxItem { pos: [number, number, number]; scale: [number, number, number]; rotY: number; color?: string }

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

function BoxInstances({ items, color, onClick, onHover, roughness = 0.85, metalness = 0 }: {
  items: BoxItem[]; color: string;
  onClick?: (i: number, e: ThreeEvent<MouseEvent>) => void;
  onHover?: (i: number | null) => void;
  roughness?: number; metalness?: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const perInstanceColor = items.some((it) => it.color);

  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    items.forEach((it, i) => {
      o.position.set(...it.pos);
      o.rotation.set(0, it.rotY, 0);
      o.scale.set(...it.scale);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (perInstanceColor) { c.set(it.color ?? color); m.setColorAt(i, c); }
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    // Raycasting uses these; they must follow the instances or clicks miss.
    m.computeBoundingBox();
    m.computeBoundingSphere();
    invalidate();
  }, [items, color, perInstanceColor, invalidate]);

  if (!items.length) return null;
  return (
    <instancedMesh
      // A new count needs a new mesh: the instance buffers are fixed-size.
      key={items.length}
      ref={ref}
      args={[UNIT_BOX, undefined, items.length]}
      onClick={onClick ? (e) => { e.stopPropagation(); if (e.instanceId != null) onClick(e.instanceId, e); } : undefined}
      onPointerMove={onHover ? (e) => { e.stopPropagation(); onHover(e.instanceId ?? null); } : undefined}
      onPointerOut={onHover ? () => onHover(null) : undefined}
    >
      <meshStandardMaterial color={perInstanceColor ? '#ffffff' : color} roughness={roughness} metalness={metalness} />
    </instancedMesh>
  );
}

// ─── Rack frames ───────────────────────────────────────────────────────────────

function useRackFrames(racks: PlacedRack[], active: Set<string> | null) {
  return useMemo(() => {
    const posts: BoxItem[] = [], beams: BoxItem[] = [], decks: BoxItem[] = [];
    for (const p of racks) {
      const on = !active || active.has(p.rack.id);
      const top = p.height + 0.08;
      // Uprights at every column boundary, front and back.
      for (let c = 0; c <= p.columns; c++) {
        const lx = c * SLOT_W - p.length / 2;
        for (const lz of [-RACK_D / 2, RACK_D / 2]) {
          const [x, z] = rackToWorld(p, lx, lz);
          posts.push({ pos: [x, top / 2, z], scale: [0.07, top, 0.07], rotY: p.rotY, color: on ? '#64748b' : '#cbd5e1' });
        }
      }
      // Beams (brand green) and a deck under every level, plus a top beam.
      for (let l = 0; l <= p.levels; l++) {
        const y = BASE_Y + l * SLOT_H;
        for (const lz of [-RACK_D / 2, RACK_D / 2]) {
          const [x, z] = rackToWorld(p, 0, lz);
          beams.push({ pos: [x, y, z], scale: [p.length, 0.07, 0.06], rotY: p.rotY, color: on ? '#15803d' : '#d1d5db' });
        }
        if (l < p.levels) {
          const [x, z] = rackToWorld(p, 0, 0);
          decks.push({ pos: [x, y - 0.01, z], scale: [p.length, 0.03, RACK_D], rotY: p.rotY, color: on ? '#e5e7eb' : '#f1f5f9' });
        }
      }
    }
    return { posts, beams, decks };
  }, [racks, active]);
}

// ─── Camera rig: smooth moves for buttons, filters and reset ─────────────────

function viewFor(b: Bounds, dir: THREE.Vector3, aspect = 1.6) {
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 6);
  // Narrow (portrait) views see less sideways, so back off further.
  const dist = (size * 1.05 + b.maxY * 1.5 + 3) * Math.max(1, 1.3 / aspect);
  const target = new THREE.Vector3(cx, 0, cz);
  return { target, pos: target.clone().add(dir.clone().normalize().multiplyScalar(dist)) };
}
const HOME_DIR = new THREE.Vector3(-0.55, 0.95, 1);

function CameraRig({ apiRef, homeBounds, fitBounds, fitKey, onCamera }: {
  apiRef: RefObject<SceneApi | null>;
  homeBounds: Bounds; fitBounds: Bounds; fitKey: string;
  onCamera?: (c: CameraInfo) => void;
}) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useThree((s) => s.controls) as Controls | null;
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const placed = useRef(false);
  const lastReport = useRef(0);
  const size = useThree((s) => s.size);
  const aspect = () => (size.height > 0 ? size.width / size.height : 1.6);

  const report = () => {
    if (!onCamera || !controls) return;
    const now = performance.now();
    if (now - lastReport.current < 80) return;
    lastReport.current = now;
    onCamera({ x: camera.position.x, z: camera.position.z, tx: controls.target.x, tz: controls.target.z });
  };

  // Frame the filtered racks whenever the filter (or the data) changes. The
  // very first frame jumps; later ones glide.
  useEffect(() => {
    if (!controls) return;
    const v = viewFor(fitBounds, HOME_DIR, aspect());
    if (!placed.current) {
      camera.position.copy(v.pos); controls.target.copy(v.target); controls.update();
      placed.current = true;
      report();
    } else {
      goal.current = v;
    }
    invalidate();
  }, [fitKey, controls]); // eslint-disable-line react-hooks/exhaustive-deps

  // A user drag cancels any glide in progress; every change updates the minimap.
  useEffect(() => {
    if (!controls) return;
    const stop = () => { goal.current = null; };
    const change = () => report();
    controls.addEventListener('start', stop);
    controls.addEventListener('change', change);
    return () => { controls.removeEventListener('start', stop); controls.removeEventListener('change', change); };
  }); // re-bound each render so `report` sees the latest onCamera

  useFrame((_, dt) => {
    const g = goal.current;
    if (!g || !controls) return;
    const a = 1 - Math.pow(0.0008, Math.min(dt, 0.05));
    camera.position.lerp(g.pos, a);
    controls.target.lerp(g.target, a);
    controls.update();
    if (camera.position.distanceTo(g.pos) < 0.02 && controls.target.distanceTo(g.target) < 0.02) goal.current = null;
    else invalidate();
  });

  useEffect(() => {
    const current = () => ({
      pos: (goal.current?.pos ?? camera.position).clone(),
      target: (goal.current?.target ?? controls?.target ?? new THREE.Vector3()).clone(),
    });
    const go = (pos: THREE.Vector3, target: THREE.Vector3) => { goal.current = { pos, target }; invalidate(); };
    apiRef.current = {
      zoom: (f) => {
        if (!controls) return;
        const { pos, target } = current();
        const dir = pos.clone().sub(target);
        const len = THREE.MathUtils.clamp(dir.length() * f, controls.minDistance, controls.maxDistance);
        go(target.clone().add(dir.setLength(len)), target);
      },
      rotate: (dAz, dPol) => {
        const { pos, target } = current();
        const sph = new THREE.Spherical().setFromVector3(pos.clone().sub(target));
        sph.theta += dAz;
        sph.phi = THREE.MathUtils.clamp(sph.phi + dPol, 0.05, MAX_POLAR);
        go(target.clone().add(new THREE.Vector3().setFromSpherical(sph)), target);
      },
      reset: () => { const v = viewFor(homeBounds, HOME_DIR, aspect()); go(v.pos, v.target); },
      top: () => {
        const { pos, target } = current();
        const d = pos.distanceTo(target);
        go(target.clone().add(new THREE.Vector3(0, d, 0.01)), target);
      },
      focus: (x, z) => {
        const { pos, target } = current();
        const shift = new THREE.Vector3(x - target.x, 0, z - target.z);
        go(pos.add(shift), target.add(shift));
      },
    };
    return () => { apiRef.current = null; };
  }, [apiRef, camera, controls, homeBounds, invalidate, size]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

// ─── Selection / hover outline ─────────────────────────────────────────────────

const OUTLINE_GEOM = new THREE.EdgesGeometry(new THREE.BoxGeometry(SLOT_W * 0.92, SLOT_H * 0.78, RACK_D * 0.9));

function Outline({ s, rotY, color }: { s: PlacedSlot; rotY: number; color: string }) {
  return (
    <group position={s.pos} rotation={[0, rotY, 0]}>
      <lineSegments geometry={OUTLINE_GEOM}>
        <lineBasicMaterial color={color} />
      </lineSegments>
    </group>
  );
}

// ─── Labels: one plain DOM layer over the canvas ─────────────────────────────
// Positioned every rendered frame by projecting world points, writing styles
// directly (no React re-render). Avoids drei <Html>, which mounts a separate
// React root per label.

interface Label3D { key: string; pos: [number, number, number] }

function LabelProjector({ labels, els }: { labels: Label3D[]; els: RefObject<Map<string, HTMLElement>> }) {
  const invalidate = useThree((s) => s.invalidate);
  const v = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => { invalidate(); }, [labels, invalidate]);
  useFrame(({ camera, size }) => {
    for (const l of labels) {
      const el = els.current?.get(l.key);
      if (!el) continue;
      v.set(l.pos[0], l.pos[1], l.pos[2]).project(camera);
      if (v.z > 1 || v.z < -1) { el.style.visibility = 'hidden'; continue; }
      el.style.visibility = 'visible';
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -50%)`;
    }
  });
  return null;
}

// ─── Scene ─────────────────────────────────────────────────────────────────────

function SceneContent({ scene, active, selectedSlotId, onSelectSlot, apiRef, onCamera, labels, labelEls }: Scene3DProps & {
  labels: Label3D[]; labelEls: RefObject<Map<string, HTMLElement>>;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const rackById = useMemo(() => new Map(scene.racks.map((p) => [p.rack.id, p])), [scene]);
  const isOn = (rackId: string) => !active || active.has(rackId);

  const slotItems = useMemo<BoxItem[]>(() => scene.slots.map((s) => {
    const p = rackById.get(s.rack.id)!;
    return {
      pos: s.pos, rotY: p.rotY,
      scale: [SLOT_W * 0.84, SLOT_H * 0.68, RACK_D * 0.82],
      color: !active || active.has(s.rack.id) ? STATE_3D[s.state].color : GHOST_COLOR,
    };
  }), [scene, rackById, active]);

  const frames = useRackFrames(scene.racks, active);

  const homeBounds = useMemo(() => boundsOf(scene.racks), [scene]);
  const activeRacks = useMemo(() => (active ? scene.racks.filter((p) => active.has(p.rack.id)) : scene.racks), [scene, active]);
  const fitBounds = useMemo(() => boundsOf(activeRacks), [activeRacks]);
  const fitKey = useMemo(() => activeRacks.map((p) => p.rack.id).join(','), [activeRacks]);

  const b = scene.bounds;
  const floorW = b.maxX - b.minX + 24, floorD = b.maxZ - b.minZ + 24;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const maxDist = Math.max(floorW, floorD) * 2.2 + 20;

  const selected = selectedSlotId ? scene.slots.find((s) => s.slot.id === selectedSlotId) : undefined;
  const hovered = hover != null ? scene.slots[hover] : undefined;

  const pickSlot = (i: number, e: ThreeEvent<MouseEvent>) => {
    if (e.delta > DRAG_PX) return;
    const s = scene.slots[i];
    if (s && isOn(s.rack.id)) onSelectSlot(s.slot.id);
  };
  const hoverSlot = (i: number | null) => {
    const ok = i != null && scene.slots[i] && isOn(scene.slots[i].rack.id);
    setHover(ok ? i : null);
    document.body.style.cursor = ok ? 'pointer' : '';
  };
  useEffect(() => () => { document.body.style.cursor = ''; }, []);

  return (
    <>
      <color attach="background" args={['#f8fafc']} />
      <hemisphereLight args={['#ffffff', '#cbd5e1', 1.1]} />
      <directionalLight position={[cx - 20, 40, cz + 30]} intensity={1.4} />
      <directionalLight position={[cx + 25, 20, cz - 20]} intensity={0.45} />

      {/* Floor, grid and zone areas */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.01, cz]}>
        <planeGeometry args={[floorW, floorD]} />
        <meshStandardMaterial color="#eef2f0" roughness={1} />
      </mesh>
      <gridHelper args={[Math.ceil(Math.max(floorW, floorD) / 2) * 2, Math.ceil(Math.max(floorW, floorD) / 2), '#d6dbd8', '#e3e7e5']} position={[cx, 0, cz]} />
      {scene.zones.map((z) => (
        <group key={z.zone}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(z.minX + z.maxX) / 2, 0.006, (z.minZ + z.maxZ) / 2]}>
            <planeGeometry args={[z.maxX - z.minX, z.maxZ - z.minZ]} />
            <meshBasicMaterial color="#dcfce7" transparent opacity={0.55} />
          </mesh>
        </group>
      ))}

      {/* Racks and slots */}
      <BoxInstances items={frames.decks} color="#e5e7eb" />
      <BoxInstances items={frames.posts} color="#64748b" metalness={0.2} roughness={0.6} />
      <BoxInstances items={frames.beams} color="#15803d" roughness={0.6} />
      <BoxInstances items={slotItems} color="#ffffff" onClick={pickSlot} onHover={hoverSlot} />

      <LabelProjector labels={labels} els={labelEls} />

      {hovered && hovered.slot.id !== selectedSlotId && (
        <Outline s={hovered} rotY={rackById.get(hovered.rack.id)?.rotY ?? 0} color="#334155" />
      )}
      {selected && (
        <Outline s={selected} rotY={rackById.get(selected.rack.id)?.rotY ?? 0} color="#14532d" />
      )}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.12}
        screenSpacePanning={false}
        maxPolarAngle={MAX_POLAR}
        minDistance={3}
        maxDistance={maxDist}
      />
      <CameraRig apiRef={apiRef} homeBounds={homeBounds} fitBounds={fitBounds} fitKey={fitKey} onCamera={onCamera} />
    </>
  );
}

export interface Scene3DProps {
  scene: Scene3D;
  /** Racks in the current filter; null = all. Others are drawn faded and are not clickable. */
  active: Set<string> | null;
  selectedSlotId: string | null;
  onSelectSlot: (slotId: string) => void;
  onSelectRack: (rackId: string) => void;
  apiRef: RefObject<SceneApi | null>;
  onCamera?: (c: CameraInfo) => void;
}

export default function WarehouseScene3D(props: Scene3DProps) {
  const { scene, active, selectedSlotId, onSelectRack } = props;
  const labelEls = useRef(new Map<string, HTMLElement>());
  const selected = selectedSlotId ? scene.slots.find((s) => s.slot.id === selectedSlotId) : undefined;

  const labels = useMemo<Label3D[]>(() => {
    const out: Label3D[] = [];
    for (const z of scene.zones) out.push({ key: `z:${z.zone}`, pos: [z.minX + 1.6, 0.02, z.maxZ + 0.5] });
    for (const p of scene.racks) {
      const [x, z] = rackToWorld(p, -p.length / 2, 0);
      out.push({ key: `r:${p.rack.id}`, pos: [x, p.height + 0.45, z] });
    }
    if (selected) out.push({ key: 'sel', pos: [selected.pos[0], selected.pos[1] + SLOT_H * 0.8, selected.pos[2]] });
    return out;
  }, [scene, selected]);

  const reg = (key: string) => (el: HTMLElement | null) => {
    if (el) labelEls.current.set(key, el); else labelEls.current.delete(key);
  };
  const place = 'absolute left-0 top-0 invisible will-change-transform';

  return (
    <div className="absolute inset-0">
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ fov: 45, near: 0.1, far: 3000, position: [-20, 30, 30] }}
        gl={{ antialias: true }}
        className="touch-none"
      >
        <SceneContent {...props} labels={labels} labelEls={labelEls} />
      </Canvas>

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {scene.zones.map((z) => (
          <span key={z.zone} ref={reg(`z:${z.zone}`)} className={`${place} whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-emerald-700/80`}>
            {z.zone === '—' ? 'No zone' : `Zone ${z.zone}`}
          </span>
        ))}
        {scene.racks.map((p) => {
          const on = !active || active.has(p.rack.id);
          return (
            <button
              key={p.rack.id}
              ref={reg(`r:${p.rack.id}`)}
              type="button"
              onClick={() => onSelectRack(p.rack.id)}
              title={`Rack ${p.rack.code}${p.rack.zone ? ` · Zone ${p.rack.zone}` : ''}`}
              className={`${place} pointer-events-auto whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] shadow-sm ${
                on ? 'border-emerald-600 bg-white font-semibold text-emerald-800 hover:bg-emerald-50' : 'border-slate-200 bg-white/80 font-medium text-slate-400'
              }`}
            >
              {p.rack.code}
            </button>
          );
        })}
        {selected && (
          <span ref={reg('sel')} className={`${place} whitespace-nowrap rounded-md border border-emerald-700 bg-white px-2 py-0.5 font-mono text-xs font-semibold text-emerald-800 shadow-sm`}>
            {selected.slot.code}
          </span>
        )}
      </div>
    </div>
  );
}
