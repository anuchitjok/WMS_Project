'use client';

// The WebGL part of the 3D view. Loaded only on the client, and only when the
// 3D tab opens (next/dynamic with ssr: false in warehouse-3d.tsx).
//
// Looks like a selective pallet-rack warehouse: blue upright frames with
// diagonal bracing, orange load beams, light decks, wooden pallets and brown
// cartons (count follows real slot fill; an empty slot is an empty shelf),
// pallet-on-floor areas marked in yellow, grey concrete floor with yellow aisle
// lines and an overhead sign per rack. Colours and simple materials only — no
// photo textures.
//
// Performance: every repeated part (uprights, braces, beams, decks, pallets,
// cartons, tape, floor lines, invisible hit boxes) is one InstancedMesh — a
// fixed number of draw calls whatever the slot count. Clicks resolve through
// instanceId on the hit boxes. The canvas renders on demand.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode, type RefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useT } from '@/i18n';
import {
  type Scene3D, type PlacedRack, type PlacedSlot,
  BASE_Y, PALLET_H, COLORS, NO_ZONE, boundsOf, rackToWorld, frameColumns, bracingPanels,
  cartonGrid, cartonCount, cartonLayout,
} from './scene-geometry';
import { isOccupied, isBlocked } from './occupancy';

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
const DECK_TOP = 0.06;                 // deck surface above the beam's base line
const SIGN_W = 1.1, SIGN_H = 0.42;     // overhead rack sign board

// ─── Instanced boxes ───────────────────────────────────────────────────────────

interface BoxItem {
  pos: [number, number, number];
  scale: [number, number, number];
  rotY: number;
  /** Tilt around the rack's own X axis (diagonal braces). */
  rotX?: number;
  color?: string;
  /** Brightness multiplier, so cartons in a stack don't look identical. */
  shade?: number;
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

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
  const perInstanceColor = !hit && items.some((it) => it.color || it.shade != null);

  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    o.rotation.order = 'YXZ'; // rack heading first, then the brace tilt in rack space
    const c = new THREE.Color();
    items.forEach((it, i) => {
      o.position.set(...it.pos);
      o.rotation.set(it.rotX ?? 0, it.rotY, 0);
      // A zero scale makes the matrix non-invertible for raycasting; use a tiny one.
      o.scale.set(Math.max(it.scale[0], 1e-4), Math.max(it.scale[1], 1e-4), Math.max(it.scale[2], 1e-4));
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (perInstanceColor) { c.set(it.color ?? color); if (it.shade != null) c.multiplyScalar(it.shade); m.setColorAt(i, c); }
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

// ─── Rack structure: uprights, braces, beams, decks, floor markings, signs ─────

/** Point on a rack at (lx, y, lz) in world space. */
const at = (p: PlacedRack, lx: number, y: number, lz: number): [number, number, number] => {
  const [x, z] = rackToWorld(p, lx, lz);
  return [x, y, z];
};

/** Flat floor strip from local (x0,z0) to (x1,z1) — axis-aligned in rack space. */
function strip(p: PlacedRack, x0: number, z0: number, x1: number, z1: number, w: number, color?: string): BoxItem {
  return {
    pos: at(p, (x0 + x1) / 2, 0.006, (z0 + z1) / 2),
    scale: [Math.max(Math.abs(x1 - x0), w), 0.004, Math.max(Math.abs(z1 - z0), w)],
    rotY: p.rotY, color,
  };
}

/** Sign board centre (rack-local x, y) — over the rack's left end, facing the aisle. */
export function signSpot(p: PlacedRack) {
  const w = Math.min(SIGN_W, p.length);
  return { lx: -p.length / 2 + w / 2, y: Math.max(p.height + 0.6, p.kind === 'floor' ? 2.6 : 0), w };
}

function useRackStructure(racks: PlacedRack[], active: Set<string> | null) {
  return useMemo(() => {
    const uprights: BoxItem[] = [], braces: BoxItem[] = [], beams: BoxItem[] = [], decks: BoxItem[] = [];
    const lines: BoxItem[] = [], signs: BoxItem[] = [], hangers: BoxItem[] = [];
    for (const p of racks) {
      const on = !active || active.has(p.rack.id);
      const hz = p.depth / 2, hx = p.length / 2;

      // Overhead sign with two hanger rods.
      const sg = signSpot(p);
      signs.push({ pos: at(p, sg.lx, sg.y, 0), scale: [sg.w, SIGN_H, 0.04], rotY: p.rotY, color: on ? COLORS.sign : COLORS.ghost });
      for (const dx of [-sg.w * 0.4, sg.w * 0.4]) {
        hangers.push({ pos: at(p, sg.lx + dx, sg.y + SIGN_H / 2 + 0.5, 0), scale: [0.015, 1, 0.015], rotY: p.rotY });
      }

      if (p.kind === 'floor') {
        // Yellow outline round the area, thinner lines between pallet positions.
        const line = on ? COLORS.line : COLORS.ghost;
        lines.push(strip(p, -hx, -hz, hx, -hz, 0.1, line), strip(p, -hx, hz, hx, hz, 0.1, line),
          strip(p, -hx, -hz, -hx, hz, 0.1, line), strip(p, hx, -hz, hx, hz, 0.1, line));
        for (let c = 1; c < p.columns; c++) {
          const lx = c * p.slotW - hx;
          lines.push(strip(p, lx, -hz, lx, hz, 0.04, line));
        }
        for (let r = 1; r < p.levels; r++) {
          const lz = r * p.rowD - hz;
          lines.push(strip(p, -hx, lz, hx, lz, 0.04, line));
        }
        continue;
      }

      const top = p.height + 0.05;
      const blue = on ? COLORS.upright : COLORS.ghost;
      const orange = on ? COLORS.beam : COLORS.ghost;
      const deck = on ? COLORS.deck : '#eef0f2';
      const frames = frameColumns(p.columns, p.slotW);

      // Upright frames: two posts, zig-zag diagonal bracing, horizontals top and bottom.
      for (const c of frames) {
        const lx = c * p.slotW - hx;
        for (const lz of [-hz, hz]) uprights.push({ pos: at(p, lx, top / 2, lz), scale: [0.08, top, 0.07], rotY: p.rotY, color: blue });
        bracingPanels(top).forEach(([y0, y1], i) => {
          const dy = y1 - y0;
          const len = Math.hypot(p.depth, dy);
          const tilt = Math.atan2(dy, p.depth);
          braces.push({ pos: at(p, lx, (y0 + y1) / 2, 0), scale: [0.035, 0.035, len], rotY: p.rotY, rotX: i % 2 ? tilt : -tilt, color: blue });
        });
        for (const y of [0.1, top - 0.05]) braces.push({ pos: at(p, lx, y, 0), scale: [0.035, 0.035, p.depth], rotY: p.rotY, color: blue });
      }

      // Load beams (front and back) and a deck per level, one per bay.
      for (let b = 0; b < frames.length - 1; b++) {
        const x0 = frames[b] * p.slotW - hx, x1 = frames[b + 1] * p.slotW - hx;
        const span = x1 - x0, mid = (x0 + x1) / 2;
        for (let l = 0; l < p.levels; l++) {
          const y = BASE_Y + l * p.levelH;
          for (const lz of [-hz, hz]) beams.push({ pos: at(p, mid, y, lz), scale: [span - 0.08, 0.1, 0.05], rotY: p.rotY, color: orange });
          decks.push({ pos: at(p, mid, y + DECK_TOP - 0.01, 0), scale: [span - 0.1, 0.02, p.depth - 0.04], rotY: p.rotY, color: deck });
        }
      }

      // Yellow aisle lines along both long sides.
      const off = hz + 0.35;
      lines.push(strip(p, -hx - 0.3, -off, hx + 0.3, -off, 0.08, on ? COLORS.line : COLORS.ghost),
        strip(p, -hx - 0.3, off, hx + 0.3, off, 0.08, on ? COLORS.line : COLORS.ghost));
    }
    return { uprights, braces, beams, decks, lines, signs, hangers };
  }, [racks, active]);
}

// ─── Slot contents: pallet, cartons (count = fill), tape, hit box ─────────────

/** Small stable brightness variation per carton (0.9 … 1.06). */
const shadeOf = (i: number, j: number) => 0.9 + (((i * 73 + j * 151) % 17) / 16) * 0.16;

function useSlotVisuals(scene: Scene3D, rackById: Map<string, PlacedRack>, colors: (string | null)[], active: Set<string> | null) {
  return useMemo(() => {
    const boards: BoxItem[] = [], runners: BoxItem[] = [], cartons: BoxItem[] = [], tapes: BoxItem[] = [], marks: BoxItem[] = [], hits: BoxItem[] = [];
    scene.slots.forEach((s, i) => {
      const p = rackById.get(s.rack.id)!;
      const on = !active || active.has(s.rack.id);
      const [w, h, d] = s.size;
      const surface = s.kind === 'floor' ? 0 : s.baseY + DECK_TOP;
      const place = (lx: number, y: number, lz: number): [number, number, number] => {
        const c = Math.cos(p.rotY), sn = Math.sin(p.rotY);
        return [s.pos[0] + lx * c + lz * sn, y, s.pos[2] - lx * sn + lz * c];
      };
      hits.push({ pos: s.pos, scale: [w * 0.96, h * 0.94, d * 0.96], rotY: p.rotY });

      const occ = isOccupied(s.slot);
      if (!occ) {
        // Empty shelf. A blocked one gets a red plate so it's never missed.
        if (isBlocked(s.slot)) marks.push({ pos: [s.pos[0], surface + 0.012, s.pos[2]], scale: [w * 0.8, 0.02, d * 0.8], rotY: p.rotY, color: on ? '#ef4444' : COLORS.ghost });
        return;
      }

      // Wooden pallet: deck boards on three runners.
      const pw = Math.min(w * 0.86, 1.2), pd = Math.min(d * 0.86, 1.0);
      const palletColor = on ? COLORS.pallet : COLORS.ghost;
      boards.push({ pos: [s.pos[0], surface + PALLET_H - 0.015, s.pos[2]], scale: [pw, 0.03, pd], rotY: p.rotY, color: palletColor });
      for (const lz of [-pd / 2 + 0.05, 0, pd / 2 - 0.05]) {
        runners.push({ pos: place(0, surface + (PALLET_H - 0.03) / 2, lz), scale: [pw, PALLET_H - 0.03, 0.1], rotY: p.rotY, color: palletColor });
      }

      // Cartons, as many as the slot's fill — up to what fits.
      const room = s.kind === 'floor' ? h - PALLET_H : h - DECK_TOP - PALLET_H - 0.08;
      const layers = s.kind === 'floor' ? 4 : 3;
      const grid = cartonGrid(pw, pd, Math.max(room, 0.15), layers);
      const boxes = cartonLayout(cartonCount(s.slot, grid.cap), pw, pd, Math.max(room, 0.15), layers);
      const color = on ? (colors[i] ?? COLORS.carton) : COLORS.ghost;
      const y0 = surface + PALLET_H;
      boxes.forEach((b, j) => {
        cartons.push({ pos: place(b.x, y0 + b.y, b.z), scale: [b.sx, b.sy, b.sz], rotY: p.rotY, color, shade: on ? shadeOf(i, j) : 1 });
        if (on) tapes.push({ pos: place(b.x, y0 + b.y + b.sy / 2 + 0.003, b.z), scale: [Math.min(0.07, b.sx * 0.2), 0.006, b.sz * 1.01], rotY: p.rotY });
      });
    });
    return { boards, runners, cartons, tapes, marks, hits };
  }, [scene, rackById, colors, active]);
}

/** Thin concrete-slab joints every 4 m, inside the floor rectangle. */
function floorJoints(f: Scene3D['floor']): BoxItem[] {
  const out: BoxItem[] = [];
  const STEP = 4;
  const x0 = f.cx - f.w / 2, z0 = f.cz - f.d / 2;
  for (let x = STEP; x < f.w - 0.5; x += STEP) out.push({ pos: [x0 + x, 0.002, f.cz], scale: [0.03, 0.002, f.d], rotY: 0 });
  for (let z = STEP; z < f.d - 0.5; z += STEP) out.push({ pos: [f.cx, 0.002, z0 + z], scale: [f.w, 0.002, 0.03], rotY: 0 });
  return out;
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

const OUTLINE_GEOM = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));

function Outline({ s, color }: { s: PlacedSlot; color: string }) {
  return (
    <group position={s.pos} rotation={[0, s.rotY, 0]} scale={[s.size[0] * 0.94, s.size[1] * 0.9, s.size[2] * 0.94]}>
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
  const rs = useRackStructure(scene.racks, active);
  const joints = useMemo(() => floorJoints(scene.floor), [scene]);

  const homeBounds = useMemo(() => boundsOf(scene.racks), [scene]);
  const activeRacks = useMemo(() => (active ? scene.racks.filter((p) => active.has(p.rack.id)) : scene.racks), [scene, active]);
  const fitBounds = useMemo(() => boundsOf(activeRacks), [activeRacks]);
  const fitKey = useMemo(() => activeRacks.map((p) => p.rack.id).join(','), [activeRacks]);
  const slotIdx = useMemo(() => new Map(scene.slots.map((s, i) => [s.slot.id, i])), [scene]);
  const slotPos = useMemo(() => (id: string) => {
    const i = slotIdx.get(id);
    return i == null ? null : scene.slots[i].pos;
  }, [slotIdx, scene]);

  const f = scene.floor;
  const fx1 = f.cx + f.w / 2, fz0 = f.cz - f.d / 2;
  const wallH = Math.max(4, scene.bounds.maxY + 2);
  const maxDist = Math.max(f.w, f.d) * 2.2 + 20;

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
      <color attach="background" args={['#eef1f3']} />
      <hemisphereLight args={['#ffffff', '#c7ccd1', 1.05]} />
      <directionalLight position={[f.cx - 30, 45, f.cz + 35]} intensity={1.5} />
      <directionalLight position={[f.cx + 30, 25, f.cz - 25]} intensity={0.45} />

      {/* Concrete floor with slab joints */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[f.cx, -0.005, f.cz]}>
        <planeGeometry args={[f.w, f.d]} />
        <meshStandardMaterial color={COLORS.floor} roughness={0.95} />
      </mesh>
      <BoxInstances items={joints} color={COLORS.floorJoint} roughness={1} />

      {/* Back walls (the two far from the default camera) */}
      <mesh position={[f.cx, wallH / 2, fz0]}><boxGeometry args={[f.w, wallH, 0.2]} /><meshStandardMaterial color="#f1f5f9" roughness={0.9} /></mesh>
      <mesh position={[fx1, wallH / 2, f.cz]}><boxGeometry args={[0.2, wallH, f.d]} /><meshStandardMaterial color="#e9eef3" roughness={0.9} /></mesh>
      <mesh position={[f.cx, 0.5, fz0 + 0.11]}><boxGeometry args={[f.w, 1, 0.02]} /><meshStandardMaterial color="#94a3b8" roughness={0.9} /></mesh>
      <mesh position={[fx1 - 0.11, 0.5, f.cz]}><boxGeometry args={[0.02, 1, f.d]} /><meshStandardMaterial color="#94a3b8" roughness={0.9} /></mesh>

      {/* Zones: a quiet dashed boundary */}
      {scene.zones.map((z) => (
        <Line key={z.zone}
          points={[[z.minX, 0.012, z.minZ], [z.maxX, 0.012, z.minZ], [z.maxX, 0.012, z.maxZ], [z.minX, 0.012, z.maxZ], [z.minX, 0.012, z.minZ]]}
          color="#94a3b8" lineWidth={1.2} dashed dashSize={0.5} gapSize={0.35}
        />
      ))}

      {/* Yellow floor markings: aisle lines and pallet-on-floor areas */}
      <BoxInstances items={rs.lines} color={COLORS.line} roughness={0.7} />

      {/* Soft shadows under racks and stock (rendered once per data change) */}
      <ContactShadows key={`${scene.slots.length}:${scene.racks.length}`}
        position={[f.cx, 0.003, f.cz]} scale={[f.w, f.d]} width={f.w} height={f.d}
        opacity={0.35} blur={2.2} far={5} resolution={1024} frames={1} color="#1f2937" />

      {/* Racks */}
      <BoxInstances items={rs.decks} color={COLORS.deck} metalness={0.3} roughness={0.6} />
      <BoxInstances items={rs.uprights} color={COLORS.upright} metalness={0.3} roughness={0.5} />
      <BoxInstances items={rs.braces} color={COLORS.upright} metalness={0.3} roughness={0.5} />
      <BoxInstances items={rs.beams} color={COLORS.beam} metalness={0.2} roughness={0.5} />
      <BoxInstances items={rs.signs} color={COLORS.sign} roughness={0.6} />
      <BoxInstances items={rs.hangers} color="#64748b" metalness={0.4} roughness={0.5} />

      {/* Slot contents */}
      <BoxInstances items={vis.runners} color={COLORS.pallet} roughness={0.95} />
      <BoxInstances items={vis.boards} color={COLORS.pallet} roughness={0.95} />
      <BoxInstances items={vis.cartons} color={COLORS.carton} roughness={0.9} />
      <BoxInstances items={vis.tapes} color="#ffffff" opacity={0.4} />
      <BoxInstances items={vis.marks} color="#ef4444" opacity={0.85} />
      <BoxInstances items={vis.hits} color="#000000" hit onClick={pickSlot} onHover={hoverSlot} />

      <LabelProjector labels={labels} els={labelEls} />

      {hovered && hovered.slot.id !== selectedSlotId && <Outline s={hovered} color="#334155" />}
      {selected && <Outline s={selected} color="#16a34a" />}

      <OrbitControls makeDefault enableDamping dampingFactor={0.12} screenSpacePanning={false}
        maxPolarAngle={MAX_POLAR} minDistance={2} maxDistance={maxDist} />
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
  const { m, t } = useT();
  const L = m.layout3d.view;
  const labelEls = useRef(new Map<string, HTMLElement>());
  const selected = selectedSlotId ? scene.slots.find((s) => s.slot.id === selectedSlotId) : undefined;

  const labels = useMemo<Label3D[]>(() => {
    const out: Label3D[] = [];
    for (const z of scene.zones) out.push({ key: `z:${z.zone}`, pos: [z.minX + 0.3, 0.02, z.maxZ - 0.35] });
    for (const p of scene.racks) {
      const sg = signSpot(p);
      const [x, z] = rackToWorld(p, sg.lx, 0);
      out.push({ key: `r:${p.rack.id}`, pos: [x, sg.y, z] });
    }
    if (selected) out.push({ key: 'sel', pos: [selected.pos[0], selected.pos[1] + selected.size[1] * 0.55, selected.pos[2]] });
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
            className={`${place} whitespace-nowrap text-xs font-semibold uppercase tracking-[0.18em] text-slate-500`}>
            {z.zone === NO_ZONE ? L.noZone : t(L.zoneN, { zone: z.zone })}
          </span>
        ))}
        {/* Overhead rack signs: the 3D board carries the code as readable DOM text. */}
        {scene.racks.map((p) => {
          const on = !active || active.has(p.rack.id);
          return (
            <button key={p.rack.id} ref={reg(`r:${p.rack.id}`)} type="button" onClick={() => onSelectRack(p.rack.id)}
              title={t(p.rack.zone ? L.rackSignTitleZone : L.rackSignTitle, { rack: p.rack.code, zone: p.rack.zone ?? '' })}
              className={`${place} pointer-events-auto whitespace-nowrap rounded-[4px] border-2 px-2.5 py-0.5 text-sm font-bold tracking-wider shadow-sm ${
                on ? 'border-white bg-blue-900 text-white hover:bg-blue-800' : 'border-slate-200 bg-white/85 text-slate-400'
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
