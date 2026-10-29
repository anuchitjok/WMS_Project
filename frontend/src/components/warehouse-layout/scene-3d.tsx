'use client';

// The WebGL part of the 3D view. Loaded only on the client, and only when the
// 3D tab opens (next/dynamic with ssr: false in warehouse-3d.tsx).
//
// Performance: every slot is drawn with a handful of instanced meshes (pallet,
// carton, tape, invisible hit box) — a few draw calls whatever the slot count.
// Colour changes (view modes, filters) only rewrite instance colours. Clicks
// resolve through instanceId on the hit boxes. The canvas renders on demand.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode, type RefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  type Scene3D, type PlacedRack, type PlacedSlot,
  SLOT_W, SLOT_H, RACK_D, BASE_Y, GHOST_COLOR, PALLET_COLOR, boundsOf, rackToWorld,
} from './scene-geometry';
import { isOccupied, isBlocked, slotUtil } from './occupancy';

export interface SceneApi {
  zoom: (factor: number) => void;
  rotate: (dAzimuth: number, dPolar: number) => void;
  reset: () => void;
  top: () => void;
  focus: (x: number, z: number) => void;
  flyTo: (slotId: string) => void;
}
export interface CameraInfo { x: number; z: number; tx: number; tz: number }

type Bounds = ReturnType<typeof boundsOf>;
type Controls = ComponentRef<typeof OrbitControls>;

const MAX_POLAR = Math.PI / 2 - 0.08; // never look from below the floor
const DRAG_PX = 5;                     // moved further than this = a drag, not a click
const CARTON_W = SLOT_W * 0.8, CARTON_D = RACK_D * 0.8;

// ─── Instanced boxes ───────────────────────────────────────────────────────────

interface BoxItem { pos: [number, number, number]; scale: [number, number, number]; rotY: number; color?: string }

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const ZERO: [number, number, number] = [0, 0, 0];

function BoxInstances({ items, color, onClick, onHover, roughness = 0.85, metalness = 0, opacity, hit }: {
  items: BoxItem[]; color: string;
  onClick?: (i: number, e: ThreeEvent<MouseEvent>) => void;
  onHover?: (i: number | null) => void;
  roughness?: number; metalness?: number; opacity?: number;
  /** Invisible pick target: raycastable, draws nothing. */
  hit?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const perInstanceColor = !hit && items.some((it) => it.color);

  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    items.forEach((it, i) => {
      o.position.set(...it.pos);
      o.rotation.set(0, it.rotY, 0);
      // A zero scale makes the matrix non-invertible for raycasting; use a tiny one.
      o.scale.set(Math.max(it.scale[0], 1e-4), Math.max(it.scale[1], 1e-4), Math.max(it.scale[2], 1e-4));
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (perInstanceColor) { c.set(it.color ?? color); m.setColorAt(i, c); }
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingBox();
    m.computeBoundingSphere();
    invalidate();
  }, [items, color, perInstanceColor, invalidate]);

  if (!items.length) return null;
  return (
    <instancedMesh
      key={items.length}
      ref={ref}
      args={[UNIT_BOX, undefined, items.length]}
      onClick={onClick ? (e) => { e.stopPropagation(); if (e.instanceId != null) onClick(e.instanceId, e); } : undefined}
      onPointerMove={onHover ? (e) => { e.stopPropagation(); onHover(e.instanceId ?? null); } : undefined}
      onPointerOut={onHover ? () => onHover(null) : undefined}
    >
      {hit
        ? <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        : <meshStandardMaterial color={perInstanceColor ? '#ffffff' : color} roughness={roughness} metalness={metalness}
            transparent={opacity != null} opacity={opacity ?? 1} />}
    </instancedMesh>
  );
}

// ─── Rack frames ───────────────────────────────────────────────────────────────

function useRackFrames(racks: PlacedRack[], active: Set<string> | null) {
  return useMemo(() => {
    const posts: BoxItem[] = [], beams: BoxItem[] = [], decks: BoxItem[] = [];
    for (const p of racks) {
      const on = !active || active.has(p.rack.id);
      const top = p.height + 0.1;
      for (let c = 0; c <= p.columns; c++) {
        const lx = c * SLOT_W - p.length / 2;
        for (const lz of [-RACK_D / 2, RACK_D / 2]) {
          const [x, z] = rackToWorld(p, lx, lz);
          posts.push({ pos: [x, top / 2, z], scale: [0.08, top, 0.08], rotY: p.rotY, color: on ? '#1e3a5f' : '#cbd5e1' });
        }
      }
      for (let l = 0; l <= p.levels; l++) {
        const y = BASE_Y + l * SLOT_H;
        for (const lz of [-RACK_D / 2, RACK_D / 2]) {
          const [x, z] = rackToWorld(p, 0, lz);
          beams.push({ pos: [x, y, z], scale: [p.length, 0.09, 0.07], rotY: p.rotY, color: on ? '#15803d' : '#d1d5db' });
        }
        if (l < p.levels) {
          const [x, z] = rackToWorld(p, 0, 0);
          decks.push({ pos: [x, y - 0.015, z], scale: [p.length, 0.025, RACK_D], rotY: p.rotY, color: on ? '#d6dbe1' : '#eef1f4' });
        }
      }
    }
    return { posts, beams, decks };
  }, [racks, active]);
}

// ─── Slot visuals: pallet, carton (height = fill), tape, hit box ────────────────

function useSlotVisuals(scene: Scene3D, rackById: Map<string, PlacedRack>, colors: (string | null)[], active: Set<string> | null) {
  return useMemo(() => {
    const pallets: BoxItem[] = [], cartons: BoxItem[] = [], tapes: BoxItem[] = [], hits: BoxItem[] = [];
    scene.slots.forEach((s, i) => {
      const p = rackById.get(s.rack.id)!;
      const on = !active || active.has(s.rack.id);
      const floorY = s.pos[1] - SLOT_H * 0.38; // deck surface of this level
      const [x, , z] = s.pos;
      const blockedEmpty = isBlocked(s.slot) && !isOccupied(s.slot);
      pallets.push({ pos: [x, floorY + 0.03, z], scale: [CARTON_W + 0.06, 0.06, CARTON_D + 0.06], rotY: p.rotY,
        color: !on ? '#eef1f4' : blockedEmpty ? '#f87171' : PALLET_COLOR });
      const occ = isOccupied(s.slot);
      // Carton height follows fill: a lightly used slot is a short carton, a full one fills the level.
      const h = occ ? SLOT_H * (0.3 + 0.42 * Math.min(1, slotUtil(s.slot) / 100)) : 0;
      const cy = floorY + 0.06 + h / 2;
      cartons.push({ pos: [x, cy, z], scale: occ ? [CARTON_W, h, CARTON_D] : ZERO, rotY: p.rotY,
        color: on ? (colors[i] ?? PALLET_COLOR) : GHOST_COLOR });
      tapes.push({ pos: [x, cy + h / 2 + 0.004, z], scale: occ && on ? [0.12, 0.008, CARTON_D * 1.01] : ZERO, rotY: p.rotY });
      hits.push({ pos: [x, s.pos[1], z], scale: [SLOT_W * 0.96, SLOT_H * 0.9, RACK_D * 0.96], rotY: p.rotY });
    });
    return { pallets, cartons, tapes, hits };
  }, [scene, rackById, colors, active]);
}

// ─── Camera rig ────────────────────────────────────────────────────────────────

function viewFor(b: Bounds, dir: THREE.Vector3, aspect = 1.6) {
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 6);
  // Narrow (portrait) views see less sideways, so back off further.
  const dist = (size * 0.95 + b.maxY * 1.4 + 3) * Math.max(1, 1.3 / aspect);
  const target = new THREE.Vector3(cx, 0, cz);
  return { target, pos: target.clone().add(dir.clone().normalize().multiplyScalar(dist)) };
}
const HOME_DIR = new THREE.Vector3(-0.62, 1.05, 1);

function CameraRig({ apiRef, homeBounds, fitBounds, fitKey, slotPos, onCamera }: {
  apiRef: RefObject<SceneApi | null>;
  homeBounds: Bounds; fitBounds: Bounds; fitKey: string;
  slotPos: (slotId: string) => [number, number, number] | null;
  onCamera?: (c: CameraInfo) => void;
}) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useThree((s) => s.controls) as Controls | null;
  const size = useThree((s) => s.size);
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const placed = useRef(false);
  const lastReport = useRef(0);
  const aspect = () => (size.height > 0 ? size.width / size.height : 1.6);

  const report = () => {
    if (!onCamera || !controls) return;
    const now = performance.now();
    if (now - lastReport.current < 80) return;
    lastReport.current = now;
    onCamera({ x: camera.position.x, z: camera.position.z, tx: controls.target.x, tz: controls.target.z });
  };

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

  useEffect(() => {
    if (!controls) return;
    const stop = () => { goal.current = null; };
    const change = () => report();
    controls.addEventListener('start', stop);
    controls.addEventListener('change', change);
    return () => { controls.removeEventListener('start', stop); controls.removeEventListener('change', change); };
  });

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
      flyTo: (slotId) => {
        const p = slotPos(slotId);
        if (!p) return;
        const { pos, target } = current();
        // Keep the current heading, but come in close and from at least ~35° above.
        const sph = new THREE.Spherical().setFromVector3(pos.clone().sub(target));
        sph.radius = 9;
        sph.phi = THREE.MathUtils.clamp(sph.phi, 0.35, 0.95);
        const t = new THREE.Vector3(p[0], p[1] * 0.6, p[2]);
        go(t.clone().add(new THREE.Vector3().setFromSpherical(sph)), t);
      },
    };
    return () => { apiRef.current = null; };
  }, [apiRef, camera, controls, homeBounds, invalidate, size, slotPos]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

// ─── Outline + DOM label projector ───────────────────────────────────────────

const OUTLINE_GEOM = new THREE.EdgesGeometry(new THREE.BoxGeometry(SLOT_W * 0.94, SLOT_H * 0.86, RACK_D * 0.94));

function Outline({ s, rotY, color }: { s: PlacedSlot; rotY: number; color: string }) {
  return (
    <group position={s.pos} rotation={[0, rotY, 0]}>
      <lineSegments geometry={OUTLINE_GEOM}>
        <lineBasicMaterial color={color} />
      </lineSegments>
    </group>
  );
}

interface Label3D { key: string; pos: [number, number, number] }

// Positions plain DOM labels every rendered frame by projecting world points,
// writing styles directly (no React re-render). Avoids drei <Html>, which
// mounts a separate React root per label.
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
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(var(--ax, -50%), var(--ay, -50%))`;
    }
  });
  return null;
}

// ─── Scene ─────────────────────────────────────────────────────────────────────

function SceneContent({ scene, active, colors, selectedSlotId, onSelectSlot, apiRef, onCamera, labels, labelEls }: Scene3DProps & {
  labels: Label3D[]; labelEls: RefObject<Map<string, HTMLElement>>;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const rackById = useMemo(() => new Map(scene.racks.map((p) => [p.rack.id, p])), [scene]);
  const isOn = (rackId: string) => !active || active.has(rackId);

  const vis = useSlotVisuals(scene, rackById, colors, active);
  const frames = useRackFrames(scene.racks, active);

  const homeBounds = useMemo(() => boundsOf(scene.racks), [scene]);
  const activeRacks = useMemo(() => (active ? scene.racks.filter((p) => active.has(p.rack.id)) : scene.racks), [scene, active]);
  const fitBounds = useMemo(() => boundsOf(activeRacks), [activeRacks]);
  const fitKey = useMemo(() => activeRacks.map((p) => p.rack.id).join(','), [activeRacks]);
  const slotIdx = useMemo(() => new Map(scene.slots.map((s, i) => [s.slot.id, i])), [scene]);
  const slotPos = useMemo(() => (id: string) => {
    const i = slotIdx.get(id);
    return i == null ? null : scene.slots[i].pos;
  }, [slotIdx, scene]);

  const b = scene.bounds;
  const M = 5; // floor margin around the racks
  const fx0 = b.minX - M, fx1 = b.maxX + M, fz0 = b.minZ - M, fz1 = b.maxZ + M;
  const floorW = fx1 - fx0, floorD = fz1 - fz0;
  const cx = (fx0 + fx1) / 2, cz = (fz0 + fz1) / 2;
  const maxDist = Math.max(floorW, floorD) * 2.2 + 20;

  // Aisle guide lines: one dashed line along the open side of every rack.
  const aisles = useMemo(() => scene.racks.map((p) => {
    const a = rackToWorld(p, -p.length / 2 - 0.6, RACK_D / 2 + 1.35);
    const c = rackToWorld(p, p.length / 2 + 0.6, RACK_D / 2 + 1.35);
    return [[a[0], 0.012, a[1]], [c[0], 0.012, c[1]]] as [number, number, number][];
  }), [scene]);

  const selIdx = selectedSlotId ? slotIdx.get(selectedSlotId) : undefined;
  const selected = selIdx != null ? scene.slots[selIdx] : undefined;
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
      <color attach="background" args={['#f4f6f7']} />
      <hemisphereLight args={['#ffffff', '#c9d2cf', 1.05]} />
      <directionalLight position={[cx - 30, 45, cz + 35]} intensity={1.5} />
      <directionalLight position={[cx + 30, 25, cz - 25]} intensity={0.4} />

      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.005, cz]}>
        <planeGeometry args={[floorW, floorD]} />
        <meshStandardMaterial color="#e6eaec" roughness={1} />
      </mesh>
      <gridHelper args={[Math.ceil(Math.max(floorW, floorD) / 2) * 2, Math.ceil(Math.max(floorW, floorD) / 2), '#d9dfe1', '#dfe4e6']} position={[cx, 0.001, cz]} />

      {/* Back walls (the two far from the default camera) with a green base band */}
      <mesh position={[cx, 1.4, fz0]}><boxGeometry args={[floorW, 2.8, 0.2]} /><meshStandardMaterial color="#f8fafc" roughness={0.9} /></mesh>
      <mesh position={[fx1, 1.4, cz]}><boxGeometry args={[0.2, 2.8, floorD]} /><meshStandardMaterial color="#f1f5f9" roughness={0.9} /></mesh>
      <mesh position={[cx, 0.2, fz0 + 0.11]}><boxGeometry args={[floorW, 0.4, 0.02]} /><meshStandardMaterial color="#15803d" /></mesh>
      <mesh position={[fx1 - 0.11, 0.2, cz]}><boxGeometry args={[0.02, 0.4, floorD]} /><meshStandardMaterial color="#15803d" /></mesh>

      {/* Zones: tinted floor with a dashed green boundary */}
      {scene.zones.map((z) => (
        <group key={z.zone}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(z.minX + z.maxX) / 2, 0.004, (z.minZ + z.maxZ) / 2]}>
            <planeGeometry args={[z.maxX - z.minX, z.maxZ - z.minZ]} />
            <meshBasicMaterial color="#e3f1e8" transparent opacity={0.7} />
          </mesh>
          <Line
            points={[[z.minX, 0.015, z.minZ], [z.maxX, 0.015, z.minZ], [z.maxX, 0.015, z.maxZ], [z.minX, 0.015, z.maxZ], [z.minX, 0.015, z.minZ]]}
            color="#16a34a" lineWidth={1.4} dashed dashSize={0.5} gapSize={0.35}
          />
        </group>
      ))}
      {aisles.map((pts, i) => (
        <Line key={i} points={pts} color="#e2c25a" lineWidth={1.2} dashed dashSize={0.7} gapSize={0.5} />
      ))}

      {/* Soft shadows under racks and cartons (rendered once per data change) */}
      <ContactShadows key={`${scene.slots.length}:${scene.racks.length}`}
        position={[cx, 0.003, cz]} scale={[floorW, floorD]} width={floorW} height={floorD}
        opacity={0.38} blur={2.2} far={5} resolution={1024} frames={1} color="#1f2937" />

      {/* Racks */}
      <BoxInstances items={frames.decks} color="#d6dbe1" />
      <BoxInstances items={frames.posts} color="#1e3a5f" metalness={0.25} roughness={0.55} />
      <BoxInstances items={frames.beams} color="#15803d" roughness={0.55} />

      {/* Slots */}
      <BoxInstances items={vis.pallets} color={PALLET_COLOR} roughness={0.95} />
      <BoxInstances items={vis.cartons} color="#ffffff" roughness={0.78} />
      <BoxInstances items={vis.tapes} color="#ffffff" opacity={0.55} />
      <BoxInstances items={vis.hits} color="#000000" hit onClick={pickSlot} onHover={hoverSlot} />

      <LabelProjector labels={labels} els={labelEls} />

      {hovered && hovered.slot.id !== selectedSlotId && (
        <Outline s={hovered} rotY={rackById.get(hovered.rack.id)?.rotY ?? 0} color="#334155" />
      )}
      {selected && (
        <Outline s={selected} rotY={rackById.get(selected.rack.id)?.rotY ?? 0} color="#14532d" />
      )}

      <OrbitControls makeDefault enableDamping dampingFactor={0.12} screenSpacePanning={false}
        maxPolarAngle={MAX_POLAR} minDistance={3} maxDistance={maxDist} />
      <CameraRig apiRef={apiRef} homeBounds={homeBounds} fitBounds={fitBounds} fitKey={fitKey} slotPos={slotPos} onCamera={onCamera} />
    </>
  );
}

export interface Scene3DProps {
  scene: Scene3D;
  /** Racks in the current filter; null = all. Others are drawn faded and are not clickable. */
  active: Set<string> | null;
  /** Carton colour per scene.slots index (null = empty slot). */
  colors: (string | null)[];
  selectedSlotId: string | null;
  onSelectSlot: (slotId: string) => void;
  onSelectRack: (rackId: string) => void;
  apiRef: RefObject<SceneApi | null>;
  onCamera?: (c: CameraInfo) => void;
  /** Card shown above the selected slot. */
  tooltip?: ReactNode;
}

export default function WarehouseScene3D(props: Scene3DProps) {
  const { scene, active, selectedSlotId, onSelectRack, tooltip } = props;
  const labelEls = useRef(new Map<string, HTMLElement>());
  const selected = selectedSlotId ? scene.slots.find((s) => s.slot.id === selectedSlotId) : undefined;

  const labels = useMemo<Label3D[]>(() => {
    const out: Label3D[] = [];
    for (const z of scene.zones) out.push({ key: `z:${z.zone}`, pos: [z.minX + 0.3, 0.02, z.maxZ - 0.35] });
    for (const p of scene.racks) {
      const [x, z] = rackToWorld(p, -p.length / 2, RACK_D / 2);
      out.push({ key: `r:${p.rack.id}`, pos: [x, p.height + 0.35, z] });
    }
    if (selected) out.push({ key: 'sel', pos: [selected.pos[0], selected.pos[1] + SLOT_H * 0.55, selected.pos[2]] });
    return out;
  }, [scene, selected]);

  const reg = (key: string) => (el: HTMLElement | null) => {
    if (el) labelEls.current.set(key, el); else labelEls.current.delete(key);
  };
  const place = 'absolute left-0 top-0 invisible will-change-transform';

  return (
    <div className="absolute inset-0">
      <Canvas frameloop="demand" dpr={[1, 2]} camera={{ fov: 42, near: 0.1, far: 3000, position: [-20, 30, 30] }}
        gl={{ antialias: true }} className="touch-none">
        <SceneContent {...props} labels={labels} labelEls={labelEls} />
      </Canvas>

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {scene.zones.map((z) => (
          <span key={z.zone} ref={reg(`z:${z.zone}`)} style={{ ['--ax' as string]: '0%', ['--ay' as string]: '-100%' }}
            className={`${place} whitespace-nowrap text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700/75`}>
            {z.zone === '—' ? 'No zone' : `Zone ${z.zone}`}
          </span>
        ))}
        {scene.racks.map((p) => {
          const on = !active || active.has(p.rack.id);
          return (
            <button key={p.rack.id} ref={reg(`r:${p.rack.id}`)} type="button" onClick={() => onSelectRack(p.rack.id)}
              title={`Rack ${p.rack.code}${p.rack.zone ? ` · Zone ${p.rack.zone}` : ''} — click to filter`}
              className={`${place} pointer-events-auto whitespace-nowrap rounded-[5px] px-2 py-0.5 text-xs font-bold tracking-wide shadow-sm ring-1 ${
                on ? 'bg-emerald-800 text-white ring-emerald-950/30 hover:bg-emerald-700' : 'bg-white/85 text-slate-400 ring-slate-200'
              }`}>
              {p.rack.code}
            </button>
          );
        })}
        {selected && (
          <div ref={reg('sel')} style={{ ['--ay' as string]: '-100%' }} className={`${place} pb-2`}>
            {tooltip}
          </div>
        )}
      </div>
    </div>
  );
}
