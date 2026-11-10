'use client';

// The WebGL part of the 3D view. Loaded only on the client, and only when the
// 3D tab opens (next/dynamic with ssr: false in warehouse-3d.tsx).
//
// Looks like a selective pallet-rack warehouse: blue upright frames with
// diagonal bracing, orange load beams, wooden pallets and kraft cartons (count
// follows real slot fill; an empty slot is an empty shelf). In the Status colour
// mode the strong status colour (deck, front strip, carton tint) is used only
// where stock sits or the slot is blocked; free slots stay pale. Racks and stock
// outside a focus / filter turn see-through. Pallet-on-floor areas are marked in
// yellow. No walls or dock doors are drawn in any view mode:
//   • open — floor (real warehouse size + dimension lines when measured), aisle
//            and zone markings, operational areas from the 2D plan
//   • full — open + slim columns (corners, middle of the long sides), optional roof
//   • rack — racks and stock only, on a plain grid
//
// Performance: every repeated part is one InstancedMesh — a fixed number of draw
// calls whatever the slot count. Geometry (instance matrices) is built from the
// scene only; filters, colour mode and status changes rewrite instance colours
// and nothing else. Clicks resolve through instanceId on invisible hit boxes.
// The canvas renders on demand.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode, type RefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useT } from '@/i18n';
import {
  type Scene3D, type PlacedRack, type PlacedSlot, type ViewMode, type EnvMode, type AreaRect,
  BASE_Y, PALLET_H, COLORS, NO_ZONE, STATE_3D, DECK_STATUS, boundsOf, rackToWorld, frameColumns, bracingPanels,
  cartonGrid, cartonCount, cartonLayout, rackCorners,
} from './scene-geometry';
import { isOccupied, isBlocked } from './occupancy';

export type CameraPreset = 'iso' | 'top' | 'front';

export interface SceneApi {
  zoom: (factor: number) => void;
  rotate: (dAzimuth: number, dPolar: number) => void;
  /** Isometric view of the whole warehouse. */
  reset: () => void;
  preset: (p: CameraPreset) => void;
  focus: (x: number, z: number) => void;
  flyTo: (slotId: string) => void;
  focusSelectedSlot: () => void;
  focusSelectedRack: () => void;
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
  /** Index of the owning rack (structure) or slot (contents) — drives the colour. */
  ref?: number;
  /** Brightness multiplier, so cartons in a stack don't look identical. */
  shade?: number;
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const TINY = 1e-4;
const noRaycast = () => null;

/**
 * One InstancedMesh (plus a see-through copy when some instances are ghosted).
 * `items` sets the matrices; `colors` sets per-instance colours in a separate
 * pass. `ghost` moves an instance into the transparent copy: racks and stock
 * outside the focus / filter turn see-through instead of grey, so they never
 * hide what is in focus. Each instance lives in exactly one of the two meshes
 * (a near-zero scale hides it in the other).
 */
function BoxInstances({ items, color, colors, ghost, onClick, onHover, roughness = 0.85, metalness = 0, opacity, hit, castShadow = false, receiveShadow = false }: {
  items: BoxItem[]; color: string;
  /** Per-instance colour (same length as items). */
  colors?: string[];
  /** Per-instance: draw see-through (outside the focus / filter). */
  ghost?: boolean[] | null;
  onClick?: (i: number, e: ThreeEvent<MouseEvent>) => void;
  onHover?: (i: number | null) => void;
  roughness?: number; metalness?: number; opacity?: number;
  /** Invisible pick target: raycastable, draws nothing. */
  hit?: boolean;
  /** Drop a sun shadow (racks, pallets, cartons) / show shadows falling on it. */
  castShadow?: boolean;
  receiveShadow?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const ghostRef = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const perInstance = !hit && !!colors;
  const anyGhost = !hit && !!ghost && ghost.some(Boolean);

  useLayoutEffect(() => {
    const o = new THREE.Object3D();
    o.rotation.order = 'YXZ'; // rack heading first, then the brace tilt in rack space
    const write = (m: THREE.InstancedMesh | null, show: (i: number) => boolean) => {
      if (!m) return;
      items.forEach((it, i) => {
        o.position.set(...it.pos);
        o.rotation.set(it.rotX ?? 0, it.rotY, 0);
        // A zero scale makes the matrix non-invertible for raycasting; use a tiny one.
        const k = show(i) ? 1 : 0;
        o.scale.set(Math.max(it.scale[0] * k, TINY), Math.max(it.scale[1] * k, TINY), Math.max(it.scale[2] * k, TINY));
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
      });
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingBox();
      m.computeBoundingSphere();
    };
    const g = anyGhost ? ghost : null;
    write(ref.current, (i) => !g?.[i]);
    write(ghostRef.current, (i) => !!g?.[i]);
    invalidate();
  }, [items, ghost, anyGhost, invalidate]);

  useLayoutEffect(() => {
    const m = ref.current;
    if (!m || !perInstance || !colors) return;
    const c = new THREE.Color();
    for (let i = 0; i < items.length; i++) {
      c.set(colors[i] ?? color);
      const sh = items[i].shade;
      if (sh != null) c.multiplyScalar(sh);
      m.setColorAt(i, c);
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    invalidate();
  }, [colors, items, color, perInstance, invalidate]);

  if (!items.length) return null;
  return (
    <>
      <instancedMesh
        key={items.length}
        ref={ref}
        args={[UNIT_BOX, undefined, items.length]}
        castShadow={castShadow && !hit && opacity == null}
        receiveShadow={receiveShadow && !hit}
        onClick={onClick ? (e) => { e.stopPropagation(); if (e.instanceId != null) onClick(e.instanceId, e); } : undefined}
        onPointerMove={onHover ? (e) => { e.stopPropagation(); onHover(e.instanceId ?? null); } : undefined}
        onPointerOut={onHover ? () => onHover(null) : undefined}
      >
        {hit
          ? <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
          : <meshStandardMaterial color={perInstance ? '#ffffff' : color} roughness={roughness} metalness={metalness}
              transparent={opacity != null} opacity={opacity ?? 1} />}
      </instancedMesh>
      {anyGhost && (
        <instancedMesh key={`g${items.length}`} ref={ghostRef} args={[UNIT_BOX, undefined, items.length]} renderOrder={2} raycast={noRaycast}>
          <meshBasicMaterial color={GHOST_TINT} transparent opacity={GHOST_OPACITY} depthWrite={false} />
        </instancedMesh>
      )}
    </>
  );
}

const GHOST_TINT = '#8f9ba3';
const GHOST_OPACITY = 0.3; // faded but still readable: the racks around the focus stay in view

// ─── Rack structure: uprights, braces, beams, signs, floor markings ───────────

/** Point on a rack at (lx, y, lz) in world space. */
const at = (p: PlacedRack, lx: number, y: number, lz: number): [number, number, number] => {
  const [x, z] = rackToWorld(p, lx, lz);
  return [x, y, z];
};

/** Flat floor strip from local (x0,z0) to (x1,z1) — axis-aligned in rack space. */
function strip(p: PlacedRack, ref: number, x0: number, z0: number, x1: number, z1: number, w: number): BoxItem {
  return {
    pos: at(p, (x0 + x1) / 2, 0.006, (z0 + z1) / 2),
    scale: [Math.max(Math.abs(x1 - x0), w), 0.004, Math.max(Math.abs(z1 - z0), w)],
    rotY: p.rotY, ref,
  };
}

/** Sign board centre (rack-local x, y) — over the rack's left end, facing the aisle. */
export function signSpot(p: PlacedRack) {
  const w = Math.min(SIGN_W, p.length);
  return { lx: -p.length / 2 + w / 2, y: Math.max(p.height + 0.6, p.kind === 'floor' ? 2.6 : 0), w };
}

/** Geometry only — depends on the racks, never on filters or colours. */
function useRackStructure(racks: PlacedRack[]) {
  return useMemo(() => {
    const uprights: BoxItem[] = [], braces: BoxItem[] = [], beams: BoxItem[] = [];
    const floorLines: BoxItem[] = [], aisleLines: BoxItem[] = [], signs: BoxItem[] = [], hangers: BoxItem[] = [];
    racks.forEach((p, ref) => {
      const hz = p.depth / 2, hx = p.length / 2;

      // Overhead sign with two hanger rods.
      const sg = signSpot(p);
      signs.push({ pos: at(p, sg.lx, sg.y, 0), scale: [sg.w, SIGN_H, 0.04], rotY: p.rotY, ref });
      for (const dx of [-sg.w * 0.4, sg.w * 0.4]) {
        hangers.push({ pos: at(p, sg.lx + dx, sg.y + SIGN_H / 2 + 0.5, 0), scale: [0.015, 1, 0.015], rotY: p.rotY, ref });
      }

      if (p.kind === 'floor') {
        // Yellow outline round the area, thinner lines between pallet positions (part of the rack).
        floorLines.push(strip(p, ref, -hx, -hz, hx, -hz, 0.1), strip(p, ref, -hx, hz, hx, hz, 0.1),
          strip(p, ref, -hx, -hz, -hx, hz, 0.1), strip(p, ref, hx, -hz, hx, hz, 0.1));
        for (let c = 1; c < p.columns; c++) { const lx = c * p.slotW - hx; floorLines.push(strip(p, ref, lx, -hz, lx, hz, 0.04)); }
        for (let r = 1; r < p.levels; r++) { const lz = r * p.rowD - hz; floorLines.push(strip(p, ref, -hx, lz, hx, lz, 0.04)); }
        return;
      }

      const top = p.height + 0.05;
      const frames = frameColumns(p.columns, p.slotW);

      // Upright frames: two posts, zig-zag diagonal bracing, horizontals top and bottom.
      for (const c of frames) {
        const lx = c * p.slotW - hx;
        for (const lz of [-hz, hz]) uprights.push({ pos: at(p, lx, top / 2, lz), scale: [0.08, top, 0.07], rotY: p.rotY, ref });
        bracingPanels(top).forEach(([y0, y1], i) => {
          const dy = y1 - y0;
          const len = Math.hypot(p.depth, dy);
          const tilt = Math.atan2(dy, p.depth);
          braces.push({ pos: at(p, lx, (y0 + y1) / 2, 0), scale: [0.035, 0.035, len], rotY: p.rotY, rotX: i % 2 ? tilt : -tilt, ref });
        });
        for (const y of [0.1, top - 0.05]) braces.push({ pos: at(p, lx, y, 0), scale: [0.035, 0.035, p.depth], rotY: p.rotY, ref });
      }

      // Load beams (front and back), one per bay and level.
      for (let b = 0; b < frames.length - 1; b++) {
        const x0 = frames[b] * p.slotW - hx, x1 = frames[b + 1] * p.slotW - hx;
        const span = x1 - x0, mid = (x0 + x1) / 2;
        for (let l = 0; l < p.levels; l++) {
          const y = BASE_Y + l * p.levelH;
          for (const lz of [-hz, hz]) beams.push({ pos: at(p, mid, y, lz), scale: [span - 0.08, 0.1, 0.05], rotY: p.rotY, ref });
        }
      }

      // Yellow aisle lines along both long sides (floor marking, hidden in Rack Only).
      const off = hz + 0.35;
      aisleLines.push(strip(p, ref, -hx - 0.3, -off, hx + 0.3, -off, 0.08), strip(p, ref, -hx - 0.3, off, hx + 0.3, off, 0.08));
    });
    return { uprights, braces, beams, floorLines, aisleLines, signs, hangers };
  }, [racks]);
}

/** Per instance: its rack is outside the focus / filter → draw see-through. null = nothing ghosted. */
function rackGhost(items: BoxItem[], racks: PlacedRack[], active: Set<string> | null) {
  return active ? items.map((it) => !active.has(racks[it.ref ?? 0]?.rack.id)) : null;
}

// ─── Slot contents: status deck, pallet, cartons (count = fill), tape, hit box ─

/** Small stable brightness variation per carton (0.9 … 1.06). */
const shadeOf = (i: number, j: number) => 0.9 + (((i * 73 + j * 151) % 17) / 16) * 0.16;

/** Geometry only — depends on the scene, never on filters or colours. */
function useSlotGeometry(scene: Scene3D, rackById: Map<string, PlacedRack>) {
  return useMemo(() => {
    const decks: BoxItem[] = [], boards: BoxItem[] = [], runners: BoxItem[] = [], cartons: BoxItem[] = [];
    const tapes: BoxItem[] = [], marks: BoxItem[] = [], hits: BoxItem[] = [], strips: BoxItem[] = [];
    scene.slots.forEach((s, i) => {
      const p = rackById.get(s.rack.id)!;
      const [w, h, d] = s.size;
      const surface = s.kind === 'floor' ? 0 : s.baseY + DECK_TOP;
      const place = (lx: number, y: number, lz: number): [number, number, number] => {
        const c = Math.cos(p.rotY), sn = Math.sin(p.rotY);
        return [s.pos[0] + lx * c + lz * sn, y, s.pos[2] - lx * sn + lz * c];
      };
      hits.push({ pos: s.pos, scale: [w * 0.96, h * 0.94, d * 0.96], rotY: p.rotY, ref: i });

      // Status deck: a shelf board per slot (racks) or a floor plate (pallet on floor).
      if (s.kind === 'floor') decks.push({ pos: [s.pos[0], 0.008, s.pos[2]], scale: [w * 0.9, 0.01, d * 0.9], rotY: p.rotY, ref: i });
      else decks.push({ pos: [s.pos[0], surface - 0.02, s.pos[2]], scale: [w - 0.05, 0.035, d + 0.02], rotY: p.rotY, ref: i });

      // Status strip on both faces of the deck, only where stock sits or the slot is blocked.
      if (s.kind !== 'floor' && (isOccupied(s.slot) || isBlocked(s.slot))) {
        for (const lz of [-(d / 2 + 0.035), d / 2 + 0.035]) strips.push({ pos: place(0, surface - 0.09, lz), scale: [w - 0.1, 0.16, 0.03], rotY: p.rotY, ref: i });
      }

      if (!isOccupied(s.slot)) {
        // A blocked empty slot gets a red plate on top so it is never missed in any colour mode.
        if (isBlocked(s.slot)) marks.push({ pos: [s.pos[0], surface + 0.012, s.pos[2]], scale: [w * 0.8, 0.02, d * 0.8], rotY: p.rotY, ref: i });
        return;
      }

      // Wooden pallet: deck boards on three runners.
      const pw = Math.min(w * 0.86, 1.2), pd = Math.min(d * 0.86, 1.0);
      boards.push({ pos: [s.pos[0], surface + PALLET_H - 0.015, s.pos[2]], scale: [pw, 0.03, pd], rotY: p.rotY, ref: i });
      for (const lz of [-pd / 2 + 0.05, 0, pd / 2 - 0.05]) {
        runners.push({ pos: place(0, surface + (PALLET_H - 0.03) / 2, lz), scale: [pw, PALLET_H - 0.03, 0.1], rotY: p.rotY, ref: i });
      }

      // Cartons, as many as the slot's fill — up to what fits.
      const room = s.kind === 'floor' ? h - PALLET_H : h - DECK_TOP - PALLET_H - 0.08;
      const layers = s.kind === 'floor' ? 4 : 3;
      const grid = cartonGrid(pw, pd, Math.max(room, 0.15), layers);
      const boxes = cartonLayout(cartonCount(s.slot, grid.cap), pw, pd, Math.max(room, 0.15), layers);
      const y0 = surface + PALLET_H;
      boxes.forEach((b, j) => {
        cartons.push({ pos: place(b.x, y0 + b.y, b.z), scale: [b.sx, b.sy, b.sz], rotY: p.rotY, ref: i, shade: shadeOf(i, j) });
        tapes.push({ pos: place(b.x, y0 + b.y + b.sy / 2 + 0.003, b.z), scale: [Math.min(0.07, b.sx * 0.2), 0.006, b.sz * 1.01], rotY: p.rotY, ref: i });
      });
    });
    return { decks, boards, runners, cartons, tapes, marks, hits, strips };
  }, [scene, rackById]);
}

/** Solid yellow floor line round each zone (0.1 m wide). */
function zoneLines(zones: Scene3D['zones']): BoxItem[] {
  const out: BoxItem[] = [], w = 0.1;
  for (const z of zones) {
    const cx = (z.minX + z.maxX) / 2, cz = (z.minZ + z.maxZ) / 2, lx = z.maxX - z.minX, lz = z.maxZ - z.minZ;
    out.push(
      { pos: [cx, 0.012, z.minZ], scale: [lx + w, 0.006, w], rotY: 0 }, { pos: [cx, 0.012, z.maxZ], scale: [lx + w, 0.006, w], rotY: 0 },
      { pos: [z.minX, 0.012, cz], scale: [w, 0.006, lz], rotY: 0 }, { pos: [z.maxX, 0.012, cz], scale: [w, 0.006, lz], rotY: 0 },
    );
  }
  return out;
}

/**
 * Main cross aisles, worked out from the layout (no stored aisle data): where the
 * floor between the rack block and the next operational area (or the wall) in
 * front of / behind it is wide enough, paint two solid yellow edges, a dashed
 * white centre line and a pedestrian crossing in the middle of the floor.
 */
function mainAisles(scene: Scene3D): { yellow: BoxItem[]; white: BoxItem[] } {
  const yellow: BoxItem[] = [], white: BoxItem[] = [];
  const f = scene.floor, b = scene.bounds;
  if (!scene.racks.length) return { yellow, white };
  const x0 = f.cx - f.w / 2 + 1, x1 = f.cx + f.w / 2 - 1, fz0 = f.cz - f.d / 2, fz1 = f.cz + f.d / 2;
  const ZONE_PAD = 1.2, HALF = 1.3, MIN_FREE = 2 * HALF + 1;
  const front = Math.min(fz1, ...scene.areas.filter((a) => a.minZ >= b.maxZ).map((a) => a.minZ));
  const back = Math.max(fz0, ...scene.areas.filter((a) => a.maxZ <= b.minZ).map((a) => a.maxZ));
  const lanes: number[] = [];
  if (front - (b.maxZ + ZONE_PAD) >= MIN_FREE) lanes.push((b.maxZ + ZONE_PAD + front) / 2);
  if ((b.minZ - ZONE_PAD) - back >= MIN_FREE) lanes.push((b.minZ - ZONE_PAD + back) / 2);
  for (const z of lanes) {
    for (const e of [z - HALF, z + HALF]) yellow.push({ pos: [(x0 + x1) / 2, 0.012, e], scale: [x1 - x0, 0.006, 0.1], rotY: 0 });
    for (let x = x0 + 1; x + 1.2 < x1 - 1; x += 2.4) white.push({ pos: [x + 0.6, 0.012, z], scale: [1.2, 0.006, 0.12], rotY: 0 });
    for (let i = -3; i <= 3; i++) white.push({ pos: [f.cx + i * 0.6, 0.014, z], scale: [0.35, 0.006, 2.2], rotY: 0 });
  }
  return { yellow, white };
}

/** Polished concrete: light grey with fine grain, soft patches and a slab joint every 6 m. */
function concreteTexture(w: number, d: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#d6dad6'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 14000; i++) {
    const v = 188 + Math.floor(Math.random() * 46);
    g.fillStyle = `rgba(${v},${v + 3},${v},.35)`; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  for (let i = 0; i < 18; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = 30 + Math.random() * 80;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(160,168,163,.10)'); gr.addColorStop(1, 'rgba(160,168,163,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.strokeStyle = 'rgba(110,120,115,.45)'; g.lineWidth = 2;
  for (let k = 0; k <= 512; k += 256) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k, 512); g.stroke();
    g.beginPath(); g.moveTo(0, k); g.lineTo(512, k); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(w / 12, d / 12);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Zone name painted on the floor, inside the front edge of the zone outline. */
function ZoneFloorText({ zones, names }: { zones: Scene3D['zones']; names: Record<string, string> }) {
  const items = useMemo(() => zones.map((z) => {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    const g = c.getContext('2d');
    if (g) {
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(55,66,61,.55)';
      g.font = '700 120px ui-sans-serif, system-ui, sans-serif';
      g.fillText((names[z.zone] ?? z.zone).toUpperCase(), 512, 132, 1000);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 8; tex.colorSpace = THREE.SRGBColorSpace;
    const w = Math.max(1, Math.min(3.4, z.maxX - z.minX - 0.4));
    return { key: z.zone, tex, w, pos: [(z.minX + z.maxX) / 2, 0.016, z.maxZ - 0.6] as [number, number, number] };
  }), [zones, names]);
  useEffect(() => () => items.forEach((i) => i.tex.dispose()), [items]);
  return (
    <>
      {items.map((i) => (
        <mesh key={i.key} position={i.pos} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[i.w, i.w / 4]} />
          <meshBasicMaterial map={i.tex} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

/** Dark band round the floor edge (the warehouse boundary). */
function edgeBand(f: Scene3D['floor']): BoxItem[] {
  const x0 = f.cx - f.w / 2, x1 = f.cx + f.w / 2, z0 = f.cz - f.d / 2, z1 = f.cz + f.d / 2, b = 0.3;
  return [
    { pos: [f.cx, 0.004, z0 + b / 2], scale: [f.w, 0.006, b], rotY: 0 }, { pos: [f.cx, 0.004, z1 - b / 2], scale: [f.w, 0.006, b], rotY: 0 },
    { pos: [x0 + b / 2, 0.004, f.cz], scale: [b, 0.006, f.d], rotY: 0 }, { pos: [x1 - b / 2, 0.004, f.cz], scale: [b, 0.006, f.d], rotY: 0 },
  ];
}

const DIM_GAP = 1.4; // dimension lines sit this far outside the floor edge (m)

/** Real-size dimension lines along the front and left floor edges (only when the warehouse is measured). */
function Dimensions({ floor }: { floor: Scene3D['floor'] }) {
  if (!floor.real) return null;
  const x0 = floor.cx - floor.w / 2, x1 = floor.cx + floor.w / 2, z0 = floor.cz - floor.d / 2, z1 = floor.cz + floor.d / 2;
  const y = 0.02, zf = z1 + DIM_GAP, xl = x0 - DIM_GAP, t = 0.5;
  const segs: [number, number, number][][] = [
    [[x0, y, zf], [x1, y, zf]], [[x0, y, zf - t], [x0, y, zf + t]], [[x1, y, zf - t], [x1, y, zf + t]],
    [[xl, y, z0], [xl, y, z1]], [[xl - t, y, z0], [xl + t, y, z0]], [[xl - t, y, z1], [xl + t, y, z1]],
  ];
  return <>{segs.map((p, i) => <Line key={i} points={p} color="#64748b" lineWidth={1.2} />)}</>;
}

/** Where the dimension labels sit (world space). */
export function dimensionSpots(floor: Scene3D['floor']) {
  if (!floor.real) return null;
  return {
    w: [floor.cx, 0.03, floor.cz + floor.d / 2 + DIM_GAP] as [number, number, number],
    d: [floor.cx - floor.w / 2 - DIM_GAP, 0.03, floor.cz] as [number, number, number],
  };
}

// ─── Environment: operational areas, building structure (no walls) ────────────

const AREA_TINT: Record<AreaRect['type'], string> = {
  RECEIVING_AREA: '#dbeafe', SHIPPING_AREA: '#dcfce7', STAGING_AREA: '#fef3c7', QC_AREA: '#f3e8ff',
  WORK_AREA: '#e0f2fe', STORAGE_AREA: '#f1f5f9', CUSTOM_AREA: '#f1f5f9',
};

function Areas({ areas }: { areas: AreaRect[] }) {
  return (
    <>
      {areas.map((a) => {
        const hw = a.w / 2, hd = a.d / 2;
        const edge = 0.12;
        return (
          <group key={a.id} position={[a.cx, 0, a.cz]} rotation={[0, a.rotY, 0]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} receiveShadow>
              <planeGeometry args={[a.w, a.d]} />
              <meshStandardMaterial color={AREA_TINT[a.type]} roughness={0.95} />
            </mesh>
            {[[0, -hd, a.w, edge], [0, hd, a.w, edge], [-hw, 0, edge, a.d], [hw, 0, edge, a.d]].map(([x, z, sx, sz], i) => (
              <mesh key={i} position={[x, 0.008, z]} receiveShadow>
                <boxGeometry args={[sx, 0.006, sz]} />
                <meshStandardMaterial color={COLORS.line} roughness={0.7} />
              </mesh>
            ))}
          </group>
        );
      })}
    </>
  );
}

/**
 * Light building structure for Full Warehouse (no walls, no dock doors): slim
 * columns only at the corners and the middle of the long sides, optional roof frame.
 */
function Building({ floor, height, roof }: { floor: Scene3D['floor']; height: number; roof: boolean }) {
  const items = useMemo(() => {
    const cols: BoxItem[] = [], truss: BoxItem[] = [];
    const x0 = floor.cx - floor.w / 2, x1 = floor.cx + floor.w / 2, z0 = floor.cz - floor.d / 2, z1 = floor.cz + floor.d / 2;
    const alongX = floor.w >= floor.d;
    const col = (x: number, z: number) => cols.push({ pos: [x, height / 2, z], scale: [0.2, height, 0.2], rotY: 0 });
    if (alongX) {
      for (const x of [x0, floor.cx, x1]) { col(x, z0); col(x, z1); truss.push({ pos: [x, height, floor.cz], scale: [0.12, 0.24, floor.d], rotY: 0 }); }
    } else {
      for (const z of [z0, floor.cz, z1]) { col(x0, z); col(x1, z); truss.push({ pos: [floor.cx, height, z], scale: [floor.w, 0.24, 0.12], rotY: 0 }); }
    }
    return { cols, truss };
  }, [floor, height]);
  return (
    <>
      <BoxInstances items={items.cols} color="#b8c2ca" metalness={0.2} roughness={0.6} />
      {roof && (
        <>
          <BoxInstances items={items.truss} color="#b8c2ca" metalness={0.2} roughness={0.6} />
          <mesh position={[floor.cx, height + 0.2, floor.cz]}>
            <boxGeometry args={[floor.w + 0.4, 0.1, floor.d + 0.4]} />
            <meshStandardMaterial color="#9aa7a1" transparent opacity={0.28} depthWrite={false} />
          </mesh>
        </>
      )}
    </>
  );
}

// ─── Camera rig ────────────────────────────────────────────────────────────────

const FOV = 42;
const FIT = 0.9; // fraction of the screen the framed box may use

/**
 * Camera position that looks along `dir` at the centre of `b` from the closest
 * distance at which every corner of the box (floor to rack tops) is on screen.
 */
function viewFor(b: Bounds, dir: THREE.Vector3, aspect = 1.6, top = 0) {
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const target = new THREE.Vector3(cx, 0, cz);
  const d = dir.clone().normalize();
  const cam = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 5000);
  const corners: THREE.Vector3[] = [];
  for (const x of [b.minX, b.maxX]) for (const y of [0, b.maxY]) for (const z of [b.minZ, b.maxZ]) corners.push(new THREE.Vector3(x, y, z));
  const v = new THREE.Vector3();
  // `top` (0…0.6, clip-space units) is kept free for overlays floating over the
  // top of the stage; the box is centred in the band that is left.
  const hiY = FIT - top, loY = -FIT, mid = (hiY + loY) / 2;
  const look = () => {
    cam.up.set(0, 1, 0);
    if (Math.abs(d.y) > 0.999) cam.up.set(0, 0, -1); // straight down
    cam.lookAt(target);
    cam.updateMatrixWorld();
  };
  const fits = (dist: number) => {
    cam.position.copy(target).addScaledVector(d, dist);
    look();
    return corners.every((c) => {
      v.copy(c).project(cam);
      const y = v.y - mid;
      return v.z < 1 && Math.abs(v.x) <= FIT && y <= hiY - mid && y >= loY - mid;
    });
  };
  let lo = 2, hi = 20;
  while (!fits(hi) && hi < 4000) hi *= 2;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
  if (!mid) return { target, pos: target.clone().addScaledVector(d, hi) };
  // Slide camera and target together so the box centre lands at screen y = mid
  // (mid < 0: below the centre). Looking higher by |mid|/2 of the view height does that.
  cam.position.copy(target).addScaledVector(d, hi);
  look();
  const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  const h = 2 * hi * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const off = up.multiplyScalar((-mid / 2) * h);
  return { target: target.clone().add(off), pos: target.clone().addScaledVector(d, hi).add(off) };
}

/** A focus frames the racks plus this much floor round them (m), so the zone and the faded neighbours stay in view. */
const FOCUS_PAD = 3;
const padded = (b: Bounds, m = FOCUS_PAD): Bounds => ({ ...b, minX: b.minX - m, maxX: b.maxX + m, minZ: b.minZ - m, maxZ: b.maxZ + m });

/** Same horizontal heading as `dir`, looking down at about 50° (focused racks stay clear of those in front). */
function focusDir(dir: THREE.Vector3) {
  const d = dir.clone();
  d.y = 0;
  if (d.lengthSq() < 1e-6) d.set(-0.5, 0, 1);
  return d.normalize().setY(1.2);
}

const PRESET_DIR: Record<CameraPreset, THREE.Vector3> = {
  iso: new THREE.Vector3(-0.5, 0.74, 1),
  top: new THREE.Vector3(0, 1, 0.001),
  front: new THREE.Vector3(0, 0.32, 1),
};

/** Keep the look-at point over the floor (plus a small margin) and between floor and rack tops. */
function clampTarget(v: THREE.Vector3, floor: Scene3D['floor'], maxY: number) {
  const m = 2;
  v.x = THREE.MathUtils.clamp(v.x, floor.cx - floor.w / 2 - m, floor.cx + floor.w / 2 + m);
  v.z = THREE.MathUtils.clamp(v.z, floor.cz - floor.d / 2 - m, floor.cz + floor.d / 2 + m);
  v.y = THREE.MathUtils.clamp(v.y, 0, Math.max(1, maxY));
  return v;
}

function CameraRig({ apiRef, homeBounds, fitBounds, fitKey, focused, topInset, floor, maxY, slotPos, selectedSlotId, rackOfSlot, onCamera, onUserCamera }: {
  apiRef: RefObject<SceneApi | null>;
  homeBounds: Bounds; fitBounds: Bounds; fitKey: string;
  /** A subset of racks is in focus (filter / rack or zone label). */
  focused: boolean;
  /** Pixels at the top of the stage covered by floating overlays. */
  topInset: number;
  floor: Scene3D['floor']; maxY: number;
  slotPos: (slotId: string) => [number, number, number] | null;
  selectedSlotId: string | null;
  rackOfSlot: (slotId: string) => PlacedRack | null;
  onCamera?: (c: CameraInfo) => void;
  onUserCamera?: () => void;
}) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useThree((s) => s.controls) as Controls | null;
  const size = useThree((s) => s.size);
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const placed = useRef(false);
  const lastReport = useRef(0);
  const sel = useRef(selectedSlotId);
  sel.current = selectedSlotId;
  const aspect = () => (size.height > 0 ? size.width / size.height : 1.6);
  const top = () => (size.height > 0 ? Math.min(0.6, (topInset / size.height) * 2) : 0);
  const frame = (b: Bounds, dir: THREE.Vector3) => viewFor(b, dir, aspect(), top());

  const report = () => {
    if (!onCamera || !controls) return;
    const now = performance.now();
    if (now - lastReport.current < 80) return;
    lastReport.current = now;
    onCamera({ x: camera.position.x, z: camera.position.z, tx: controls.target.x, tz: controls.target.z });
  };

  useEffect(() => {
    if (!controls) return;
    const v = frame(fitBounds, PRESET_DIR.iso);
    if (!placed.current) {
      camera.position.copy(v.pos); controls.target.copy(v.target); controls.update();
      placed.current = true;
      report();
    } else {
      // Keep the current heading when a filter re-frames the view; a focus also looks down ~50°.
      const raw = camera.position.clone().sub(controls.target);
      const dir = raw.lengthSq() > 0 ? raw : PRESET_DIR.iso;
      goal.current = focused ? frame(padded(fitBounds), focusDir(dir)) : frame(fitBounds, dir);
    }
    invalidate();
  }, [fitKey, controls, topInset]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!controls) return;
    const start = () => { goal.current = null; onUserCamera?.(); };
    // Panning can't leave the warehouse: pull the target (and camera with it) back inside.
    const change = () => {
      const t = controls.target;
      const c = clampTarget(t.clone(), floor, maxY);
      if (!c.equals(t)) { const d = c.sub(t); t.add(d); camera.position.add(d); }
      report();
    };
    controls.addEventListener('start', start);
    controls.addEventListener('change', change);
    return () => { controls.removeEventListener('start', start); controls.removeEventListener('change', change); };
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
    const go = (pos: THREE.Vector3, target: THREE.Vector3) => {
      const t = clampTarget(target.clone(), floor, maxY);
      goal.current = { pos: pos.clone().add(t.clone().sub(target)), target: t };
      invalidate();
    };
    const flyTo = (slotId: string) => {
      const p = slotPos(slotId);
      if (!p) return;
      const { pos, target } = current();
      // Keep the current heading, but come in close and from ~35–55° above.
      const sph = new THREE.Spherical().setFromVector3(pos.clone().sub(target));
      sph.radius = 10;
      sph.phi = THREE.MathUtils.clamp(sph.phi, 0.6, 1.0);
      const t = new THREE.Vector3(p[0], p[1], p[2]);
      go(t.clone().add(new THREE.Vector3().setFromSpherical(sph)), t);
    };
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
      reset: () => { const v = frame(homeBounds, PRESET_DIR.iso); go(v.pos, v.target); },
      preset: (p) => { const v = frame(homeBounds, PRESET_DIR[p]); go(v.pos, v.target); },
      focus: (x, z) => {
        const { pos, target } = current();
        const shift = new THREE.Vector3(x - target.x, 0, z - target.z);
        go(pos.add(shift), target.add(shift));
      },
      flyTo,
      focusSelectedSlot: () => { if (sel.current) flyTo(sel.current); },
      focusSelectedRack: () => {
        const r = sel.current ? rackOfSlot(sel.current) : null;
        if (!r) return;
        const { pos, target } = current();
        const dir = pos.clone().sub(target);
        const v = frame(padded(boundsOf([r])), focusDir(dir.lengthSq() > 0 ? dir : PRESET_DIR.iso));
        go(v.pos, v.target);
      },
    };
    return () => { apiRef.current = null; };
  }, [apiRef, camera, controls, homeBounds, invalidate, size, slotPos, floor, maxY, rackOfSlot, topInset]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

// ─── Selection highlight + DOM label projector ───────────────────────────────

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

/** Selected slot: translucent cyan volume with a bright edge (the 3D accent colour). */
function Highlight({ s }: { s: PlacedSlot }) {
  return (
    <group position={s.pos} rotation={[0, s.rotY, 0]} scale={[s.size[0] * 1.02, s.size[1] * 0.98, s.size[2] * 1.06]}>
      <mesh geometry={UNIT_BOX} renderOrder={2}>
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.32} depthWrite={false} depthTest={false} />
      </mesh>
      <lineSegments geometry={OUTLINE_GEOM} renderOrder={3}>
        <lineBasicMaterial color="#06b6d4" />
      </lineSegments>
    </group>
  );
}

/**
 * `lod`: 'far' = only when zoomed out (zone names), 'near' = only when zoomed in
 * (rack signs). Both skip a label that would overlap one placed before it
 * (`keep` ones go first and always win). undefined = always shown.
 * `around`: a ground rectangle (zone outline). The label goes just outside it on
 * screen — below, above, left or right, the first spot that covers no rack and no
 * other label — and stays hidden if none is free.
 */
interface GroundBox { minX: number; minZ: number; maxX: number; maxZ: number }
interface Label3D { key: string; pos: [number, number, number]; lod?: 'far' | 'near'; keep?: boolean; around?: GroundBox }
interface ScreenRect { x0: number; y0: number; x1: number; y1: number }
const overlaps = (a: ScreenRect, b: ScreenRect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/** Below this many screen pixels per metre (at the look-at point) the view counts as zoomed out. */
const FAR_PX_PER_M = 9;

// Positions plain DOM labels every rendered frame by projecting world points,
// writing styles directly (no React re-render). Avoids drei <Html>, which
// mounts a separate React root per label.
function LabelProjector({ labels, els, racks }: { labels: Label3D[]; els: RefObject<Map<string, HTMLElement>>; racks: PlacedRack[] }) {
  const invalidate = useThree((s) => s.invalidate);
  const v = useMemo(() => new THREE.Vector3(), []);
  // Rack signs first that must stay (focused racks), then the rest in data order.
  const ordered = useMemo(() => [...labels.filter((l) => l.keep), ...labels.filter((l) => !l.keep)], [labels]);
  useEffect(() => { invalidate(); }, [labels, invalidate]);
  useFrame(({ camera, size, controls }) => {
    const target = (controls as Controls | null)?.target;
    const dist = target ? camera.position.distanceTo(target) : 50;
    const pxPerM = size.height / (2 * dist * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    const far = pxPerM < FAR_PX_PER_M;
    const taken: ScreenRect[] = [];
    // Screen boxes of the racks (footprint + height); zone tags must not cover them.
    let rackRects: ScreenRect[] | null = null;
    const screenBox = (pts: [number, number, number][]): ScreenRect | null => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [px, py, pz] of pts) {
        v.set(px, py, pz).project(camera);
        if (v.z > 1 || v.z < -1) return null;
        const sx = ((v.x + 1) / 2) * size.width, sy = ((1 - v.y) / 2) * size.height;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      return { x0, y0, x1, y1 };
    };
    for (const l of ordered) {
      const el = els.current?.get(l.key);
      if (!el) continue;
      if (l.around) {
        const b = l.around;
        const zb = !(l.lod === 'far' && !far) && screenBox([[b.minX, 0, b.minZ], [b.maxX, 0, b.minZ], [b.maxX, 0, b.maxZ], [b.minX, 0, b.maxZ]]);
        if (!zb) { el.style.visibility = 'hidden'; continue; }
        rackRects ??= racks.flatMap((p) => {
          const r = screenBox(rackCorners(p).flatMap(([x, z]) => [[x, 0, z], [x, p.height, z]] as [number, number, number][]));
          return r ? [r] : [];
        });
        const w = el.offsetWidth, h = el.offsetHeight, g = 4, cy = (zb.y0 + zb.y1) / 2;
        const spots: [number, number][] = [
          [zb.x0, zb.y1 + g], [zb.x0, zb.y0 - g - h], [zb.x0 - g - w, cy - h / 2], [zb.x1 + g, cy - h / 2],
        ];
        let at: ScreenRect | null = null;
        for (const [sx, sy] of spots) {
          const r = { x0: sx, y0: sy, x1: sx + w, y1: sy + h };
          if (r.x0 < 0 || r.y0 < 0 || r.x1 > size.width || r.y1 > size.height) continue;
          if (rackRects.some((o) => overlaps(r, o)) || taken.some((o) => overlaps(r, o))) continue;
          at = r; break;
        }
        if (!at) { el.style.visibility = 'hidden'; continue; }
        taken.push({ x0: at.x0 - 2, y0: at.y0 - 2, x1: at.x1 + 2, y1: at.y1 + 2 });
        el.style.visibility = 'visible';
        el.style.transform = `translate(${at.x0}px, ${at.y0}px)`;
        continue;
      }
      v.set(l.pos[0], l.pos[1], l.pos[2]).project(camera);
      const hidden = v.z > 1 || v.z < -1 || (l.lod === 'far' && !far) || (l.lod === 'near' && far && !l.keep);
      if (hidden) { el.style.visibility = 'hidden'; continue; }
      const x = ((v.x + 1) / 2) * size.width, y = ((1 - v.y) / 2) * size.height;
      if (l.lod === 'near') {
        // Signs are centred on their point; skip one that would cover a sign already placed.
        const w = el.offsetWidth, h = el.offsetHeight;
        const r = { x0: x - w / 2 - 2, y0: y - h / 2 - 2, x1: x + w / 2 + 2, y1: y + h / 2 + 2 };
        if (taken.some((t) => overlaps(r, t))) { el.style.visibility = 'hidden'; continue; }
        taken.push(r);
      } else if (!l.keep) {
        // Always-on labels (floor areas, dimensions) come first, so zone tags steer around them.
        const w = el.offsetWidth, h = el.offsetHeight;
        taken.push({ x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 });
      }
      el.style.visibility = 'visible';
      el.style.transform = `translate(${x}px, ${y}px) translate(var(--ax, -50%), var(--ay, -50%))`;
    }
  });
  return null;
}

// ─── Rack data warnings ────────────────────────────────────────────────────────

const FLAG_COLOR = '#dc2626';
const FLAG_MARGIN = 0.25; // m around the rack footprint
const FLAG_W = 0.14;      // line width on the floor

/** Red line round the floor footprint of each flagged rack (rack data looks wrong). */
function flagOutline(racks: PlacedRack[], flagged: Set<string> | undefined): BoxItem[] {
  if (!flagged?.size) return [];
  const out: BoxItem[] = [];
  for (const p of racks) {
    if (!flagged.has(p.rack.id)) continue;
    const grown: PlacedRack = { ...p, length: p.length + FLAG_MARGIN * 2, depth: p.depth + FLAG_MARGIN * 2 };
    const c = rackCorners(grown);
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = c[i], [x1, z1] = c[(i + 1) % 4];
      const len = Math.hypot(x1 - x0, z1 - z0) + FLAG_W;
      out.push({ pos: [(x0 + x1) / 2, 0.012, (z0 + z1) / 2], scale: [len, 0.012, FLAG_W], rotY: -Math.atan2(z1 - z0, x1 - x0) });
    }
  }
  return out;
}

// ─── Sun shadows ───────────────────────────────────────────────────────────────

// Same sun as the mock-up: high and opposite the default camera, so shadows fall
// beside the racks where they can be seen (not hidden behind them).
const SUN_DIR = new THREE.Vector3(18, 30, 14).normalize();

/**
 * Key light that casts the real shadows of racks and stock on the floor (as in
 * the design mock-up). The shadow box is fitted to the floor so shadows stay sharp
 * on small floors and still cover big ones; the shadow map only re-renders with
 * the scene (frameloop "demand").
 */
function SunLight({ floor, maxY }: { floor: { cx: number; cz: number; w: number; d: number }; maxY: number }) {
  const ref = useRef<THREE.DirectionalLight>(null);
  const r = Math.hypot(floor.w, floor.d) / 2 + 2;
  const dist = r + Math.max(maxY, 6) + 20;
  const mapSize = r > 60 ? 4096 : 2048;
  useLayoutEffect(() => {
    const l = ref.current;
    if (!l) return;
    l.target.position.set(floor.cx, 0, floor.cz);
    l.target.updateMatrixWorld();
    const cam = l.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = 1; cam.far = dist + r + Math.max(maxY, 6);
    cam.updateProjectionMatrix();
    l.shadow.needsUpdate = true;
  }, [floor.cx, floor.cz, r, dist, maxY]);
  return (
    <directionalLight ref={ref} castShadow intensity={1.7}
      position={[floor.cx + SUN_DIR.x * dist, SUN_DIR.y * dist, floor.cz + SUN_DIR.z * dist]}
      shadow-mapSize={[mapSize, mapSize]} shadow-bias={-0.0005} shadow-normalBias={0.02} shadow-radius={3}>
      <object3D attach="target" />
    </directionalLight>
  );
}

// ─── Scene ─────────────────────────────────────────────────────────────────────

function SceneContent({ scene, active, slotOn, colors, colorMode, envMode, roof, hideBoxes, flagged, topInset = 0, selectedSlotId, onSelectSlot, apiRef, onCamera, onUserCamera, labels, labelEls, zoneNames }: Scene3DProps & {
  labels: Label3D[]; labelEls: RefObject<Map<string, HTMLElement>>; zoneNames: Record<string, string>;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const rackById = useMemo(() => new Map(scene.racks.map((p) => [p.rack.id, p])), [scene]);
  const slotIsOn = (i: number) => !slotOn || !!slotOn[i];

  // Geometry: rebuilt only when the scene (warehouse data / layout) changes.
  const geo = useSlotGeometry(scene, rackById);
  const rs = useRackStructure(scene.racks);
  const concrete = useMemo(() => concreteTexture(scene.floor.w, scene.floor.d), [scene]);
  useEffect(() => () => concrete?.dispose(), [concrete]);
  const zLines = useMemo(() => zoneLines(scene.zones), [scene]);
  const aisles = useMemo(() => mainAisles(scene), [scene]);
  const edge = useMemo(() => edgeBand(scene.floor), [scene]);
  const flags = useMemo(() => flagOutline(scene.racks, flagged), [scene, flagged]);

  // Focus / filter: racks and stock outside it turn see-through (never grey, never hiding the focus).
  const rg = useMemo(() => ({
    uprights: rackGhost(rs.uprights, scene.racks, active),
    braces: rackGhost(rs.braces, scene.racks, active),
    beams: rackGhost(rs.beams, scene.racks, active),
    signs: rackGhost(rs.signs, scene.racks, active),
    hangers: rackGhost(rs.hangers, scene.racks, active),
    floorLines: rackGhost(rs.floorLines, scene.racks, active),
  }), [rs, scene, active]);
  const sg = useMemo(() => {
    const off = (items: BoxItem[]) => (slotOn ? items.map((it) => !slotOn[it.ref ?? 0]) : null);
    return {
      decks: off(geo.decks), boards: off(geo.boards), runners: off(geo.runners), cartons: off(geo.cartons),
      tapes: off(geo.tapes), marks: off(geo.marks), strips: off(geo.strips),
    };
  }, [geo, slotOn]);
  // Colours: strong status colour only where stock sits; free slots stay pale.
  const sc = useMemo(() => ({
    decks: geo.decks.map((it) => (colorMode === 'status' ? DECK_STATUS[scene.slots[it.ref ?? 0].state] : COLORS.deck)),
    cartons: geo.cartons.map((it) => colors[it.ref ?? 0] ?? COLORS.carton),
    strips: geo.strips.map((it) => STATE_3D[scene.slots[it.ref ?? 0].state].color),
  }), [geo, colors, colorMode, scene]);

  // Home view frames the racks and the operational areas around them.
  const homeBounds = useMemo(() => {
    const b = boundsOf(scene.racks);
    for (const a of scene.areas) {
      b.minX = Math.min(b.minX, a.minX); b.maxX = Math.max(b.maxX, a.maxX);
      b.minZ = Math.min(b.minZ, a.minZ); b.maxZ = Math.max(b.maxZ, a.maxZ);
    }
    return b;
  }, [scene]);
  const activeRacks = useMemo(() => (active ? scene.racks.filter((p) => active.has(p.rack.id)) : scene.racks), [scene, active]);
  const fitBounds = useMemo(() => (active && activeRacks.length ? boundsOf(activeRacks) : homeBounds), [active, activeRacks, homeBounds]);
  const fitKey = useMemo(() => activeRacks.map((p) => p.rack.id).join(','), [activeRacks]);
  const slotIdx = useMemo(() => new Map(scene.slots.map((s, i) => [s.slot.id, i])), [scene]);
  const slotPos = useMemo(() => (id: string) => {
    const i = slotIdx.get(id);
    return i == null ? null : scene.slots[i].pos;
  }, [slotIdx, scene]);
  const rackOfSlot = useMemo(() => (id: string) => {
    const i = slotIdx.get(id);
    return i == null ? null : rackById.get(scene.slots[i].rack.id) ?? null;
  }, [slotIdx, scene, rackById]);

  const f = scene.floor;
  const maxDist = Math.max(f.w, f.d) * 2.2 + 20;
  const showFloor = envMode !== 'rack';
  const buildingH = Math.max(6, scene.bounds.maxY + 2.5);
  const bg = envMode === 'rack' ? '#f5f7f8' : '#e9edf0';
  const span = Math.max(f.w, f.d);

  const selIdx = selectedSlotId ? slotIdx.get(selectedSlotId) : undefined;
  const selected = selIdx != null ? scene.slots[selIdx] : undefined;
  const hovered = hover != null ? scene.slots[hover] : undefined;

  const pickSlot = (i: number, e: ThreeEvent<MouseEvent>) => {
    if (e.delta > DRAG_PX) return;
    const s = scene.slots[i];
    if (s && slotIsOn(i)) onSelectSlot(s.slot.id);
  };
  const hoverSlot = (i: number | null) => {
    const ok = i != null && !!scene.slots[i] && slotIsOn(i);
    setHover(ok ? i : null);
    document.body.style.cursor = ok ? 'pointer' : '';
  };
  useEffect(() => () => { document.body.style.cursor = ''; }, []);

  return (
    <>
      <color attach="background" args={[bg]} />
      {/* Light fog: far parts of a big floor fade into the background. */}
      <fog attach="fog" args={[bg, span * 1.6 + 20, span * 4 + 60]} />
      <hemisphereLight args={['#ffffff', '#c7ccd1', 0.85]} />
      <SunLight floor={f} maxY={scene.bounds.maxY} />
      {/* Soft fill from the camera side so rack faces in the sun's shade stay readable */}
      <directionalLight position={[f.cx - 30, 25, f.cz + 30]} intensity={0.4} />

      {showFloor ? (
        <>
          {/* Polished concrete floor (slab joints are in the texture) */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[f.cx, -0.005, f.cz]} receiveShadow>
            <planeGeometry args={[f.w, f.d]} />
            <meshStandardMaterial map={concrete} color={concrete ? '#ffffff' : COLORS.floor} roughness={0.55} metalness={0.05} />
          </mesh>
          {/* Floor edge = the real warehouse boundary when it is measured */}
          <BoxInstances items={edge} color="#46504c" roughness={0.9} receiveShadow />
          <Dimensions floor={f} />

          {/* Operational areas from the 2D plan */}
          <Areas areas={scene.areas} />

          {/* Zones: solid yellow line round each zone, zone name painted in front */}
          <BoxInstances items={zLines} color={COLORS.line} roughness={0.5} receiveShadow />
          <ZoneFloorText zones={scene.zones} names={zoneNames} />
          {/* Main cross aisles from the layout: yellow edges, dashed white centre, crossing */}
          <BoxInstances items={aisles.yellow} color={COLORS.line} roughness={0.5} receiveShadow />
          <BoxInstances items={aisles.white} color="#f4f6f5" roughness={0.5} receiveShadow />

          {/* Yellow aisle markings (floor paint stays solid, even outside a focus) */}
          <BoxInstances items={rs.aisleLines} color={COLORS.line} roughness={0.7} receiveShadow />

          {envMode === 'full' && <Building floor={f} height={buildingH} roof={roof} />}
        </>
      ) : (
        <>
        {/* Racks-only mode: an invisible floor that only shows the shadows */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[f.cx, -0.002, f.cz]} receiveShadow>
          <planeGeometry args={[f.w, f.d]} />
          <shadowMaterial opacity={0.18} />
        </mesh>
        <gridHelper args={[Math.ceil(Math.max(f.w, f.d) / 2) * 2, Math.ceil(Math.max(f.w, f.d) / 2), '#cbd5e1', '#e2e8f0']} position={[f.cx, 0, f.cz]} />
        </>
      )}

      {/* Racks whose master data looks wrong (setup health) */}
      <BoxInstances items={flags} color={FLAG_COLOR} roughness={0.6} />

      {/* Pallet-on-floor markings belong to the rack, so they show in every mode */}
      <BoxInstances items={rs.floorLines} ghost={rg.floorLines} color={COLORS.line} roughness={0.7} receiveShadow />

      {/* Soft shadows under racks and stock (rendered once per data change) */}
      <ContactShadows key={`${scene.slots.length}:${scene.racks.length}`}
        position={[f.cx, 0.003, f.cz]} scale={[f.w, f.d]} width={f.w} height={f.d}
        opacity={0.3} blur={2.2} far={5} resolution={1024} frames={1} color="#1f2937" />

      {/* Racks */}
      <BoxInstances items={rs.uprights} ghost={rg.uprights} color={COLORS.upright} metalness={0.3} roughness={0.5} castShadow receiveShadow />
      <BoxInstances items={rs.braces} ghost={rg.braces} color={COLORS.upright} metalness={0.3} roughness={0.5} castShadow receiveShadow />
      <BoxInstances items={rs.beams} ghost={rg.beams} color={COLORS.beam} metalness={0.2} roughness={0.5} castShadow receiveShadow />
      <BoxInstances items={rs.signs} ghost={rg.signs} color={COLORS.sign} roughness={0.6} castShadow receiveShadow />
      <BoxInstances items={rs.hangers} ghost={rg.hangers} color="#64748b" metalness={0.4} roughness={0.5} castShadow receiveShadow />

      {/* Slot contents */}
      <BoxInstances items={geo.decks} ghost={sg.decks} colors={sc.decks} color={COLORS.deck} metalness={0.15} roughness={0.6} castShadow receiveShadow />
      {colorMode === 'status' && <BoxInstances items={geo.strips} ghost={sg.strips} colors={sc.strips} color={STATE_3D.inUse.color} roughness={0.5} />}
      {!hideBoxes && (
        <>
          <BoxInstances items={geo.runners} ghost={sg.runners} color={COLORS.pallet} roughness={0.95} castShadow receiveShadow />
          <BoxInstances items={geo.boards} ghost={sg.boards} color={COLORS.pallet} roughness={0.95} castShadow receiveShadow />
          <BoxInstances items={geo.cartons} ghost={sg.cartons} colors={sc.cartons} color={COLORS.carton} roughness={0.9} castShadow receiveShadow />
          <BoxInstances items={geo.tapes} ghost={sg.tapes} color="#ffffff" opacity={0.4} />
        </>
      )}
      <BoxInstances items={geo.marks} ghost={sg.marks} color={STATE_3D.blocked.color} opacity={0.85} />
      <BoxInstances items={geo.hits} color="#000000" hit onClick={pickSlot} onHover={hoverSlot} />

      <LabelProjector labels={labels} els={labelEls} racks={scene.racks} />

      {hovered && hovered.slot.id !== selectedSlotId && <Outline s={hovered} color="#334155" />}
      {selected && <Highlight s={selected} />}

      <OrbitControls makeDefault enableDamping dampingFactor={0.12} screenSpacePanning={false}
        maxPolarAngle={MAX_POLAR} minDistance={2} maxDistance={maxDist} />
      <CameraRig apiRef={apiRef} homeBounds={homeBounds} fitBounds={fitBounds} fitKey={fitKey}
        focused={!!active && activeRacks.length > 0 && activeRacks.length < scene.racks.length} topInset={topInset}
        floor={f} maxY={scene.bounds.maxY} slotPos={slotPos} selectedSlotId={selectedSlotId} rackOfSlot={rackOfSlot}
        onCamera={onCamera} onUserCamera={onUserCamera} />
    </>
  );
}

export interface Scene3DProps {
  scene: Scene3D;
  /** Racks that keep slots in the current filter; null = all. Others are drawn faded. */
  active: Set<string> | null;
  /** Per scene.slots index: in the filter (clickable, coloured) or not; null = no filter. */
  slotOn: boolean[] | null;
  /** Carton colour per scene.slots index (null = empty slot). */
  colors: (string | null)[];
  colorMode: ViewMode;
  envMode: EnvMode;
  roof: boolean;
  /** Hide pallets and cartons so the status decks / strips read on their own. */
  hideBoxes?: boolean;
  /** Rack ids to outline in red on the floor (master data looks wrong). */
  flagged?: Set<string>;
  /** Pixels at the top of the stage covered by floating overlays (filter bar, presets). */
  topInset?: number;
  selectedSlotId: string | null;
  onSelectSlot: (slotId: string) => void;
  onSelectRack: (rackId: string) => void;
  /** A zone name on the floor was clicked: focus every rack in that zone. */
  onSelectZone?: (zone: string) => void;
  apiRef: RefObject<SceneApi | null>;
  onCamera?: (c: CameraInfo) => void;
  /** The user started dragging / zooming the camera themselves. */
  onUserCamera?: () => void;
  /** Card shown above the selected slot. */
  tooltip?: ReactNode;
}

export default function WarehouseScene3D(props: Scene3DProps) {
  const { scene, active, envMode, selectedSlotId, onSelectRack, onSelectZone, tooltip } = props;
  const { m, t, fmt } = useT();
  const L = m.layout3d.view, A = m.layout3d.w3d.area;
  const labelEls = useRef(new Map<string, HTMLElement>());
  const selected = selectedSlotId ? scene.slots.find((s) => s.slot.id === selectedSlotId) : undefined;
  const showFloor = envMode !== 'rack';
  const dims = showFloor ? dimensionSpots(scene.floor) : null;
  // A zone is "on" while at least one of its racks is in the focus / filter.
  const zoneOn = (zone: string) => !active || scene.racks.some((p) => p.zone === zone && active.has(p.rack.id));

  const zoneNames = useMemo(
    () => Object.fromEntries(scene.zones.map((z) => [z.zone, z.zone === NO_ZONE ? L.noZone : t(L.zoneN, { zone: z.zone })])),
    [scene, L, t],
  );
  const labels = useMemo<Label3D[]>(() => {
    const out: Label3D[] = [];
    // Floor areas and dimensions first: labels placed later steer around them.
    if (showFloor) for (const a of scene.areas) out.push({ key: `a:${a.id}`, pos: [a.cx, 0.02, a.cz] });
    if (dims) { out.push({ key: 'dim:w', pos: dims.w }, { key: 'dim:d', pos: dims.d }); }
    // Zone names: small tags just outside the zone outline, never over a rack, only when
    // zoomed out (rack signs take over when zoomed in).
    for (const z of scene.zones) out.push({ key: `z:${z.zone}`, pos: [z.minX, 0, z.minZ], lod: 'far', around: z });
    for (const p of scene.racks) {
      const sg = signSpot(p);
      const [x, z] = rackToWorld(p, sg.lx, 0);
      out.push({ key: `r:${p.rack.id}`, pos: [x, sg.y, z], lod: 'near', keep: !!active && active.has(p.rack.id) });
    }
    if (selected) out.push({ key: 'sel', pos: [selected.pos[0], selected.pos[1] + selected.size[1] * 0.55, selected.pos[2]] });
    return out;
  }, [scene, selected, showFloor, active, dims?.w[0], dims?.w[2], dims?.d[0], dims?.d[2]]); // eslint-disable-line react-hooks/exhaustive-deps

  const reg = (key: string) => (el: HTMLElement | null) => {
    if (el) labelEls.current.set(key, el); else labelEls.current.delete(key);
  };
  const place = 'absolute left-0 top-0 invisible will-change-transform';

  return (
    <div className="absolute inset-0">
      <Canvas frameloop="demand" dpr={[1, 2]} shadows="percentage" camera={{ fov: FOV, near: 0.1, far: 3000, position: [-20, 30, 30] }}
        gl={{ antialias: true }} className="touch-none">
        <SceneContent {...props} labels={labels} labelEls={labelEls} zoneNames={zoneNames} />
      </Canvas>

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {scene.zones.map((z) => {
          const on = zoneOn(z.zone);
          const name = z.zone === NO_ZONE ? L.noZone : t(L.zoneN, { zone: z.zone });
          return (
            <button key={z.zone} ref={reg(`z:${z.zone}`)} type="button" disabled={!onSelectZone}
              onClick={() => onSelectZone?.(z.zone)} title={t(L.zoneFocusTitle, { zone: name })}
              className={`${place} pointer-events-auto whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider shadow-sm ring-1 transition-colors ${
                on ? 'bg-white/90 text-slate-700 ring-slate-300 hover:bg-white hover:text-emerald-700' : 'bg-white/60 text-slate-400 ring-slate-200'
              }`}>
              {name}
            </button>
          );
        })}
        {dims && (['w', 'd'] as const).map((k) => (
          <span key={k} ref={reg(`dim:${k}`)}
            className={`${place} whitespace-nowrap rounded bg-slate-50/90 px-1.5 text-xs font-semibold tabular-nums text-slate-600`}>
            {t(L.metres, { value: fmt.number(k === 'w' ? scene.floor.real!.w : scene.floor.real!.d, 1) })}
          </span>
        ))}
        {showFloor && scene.areas.map((a) => (
          <span key={a.id} ref={reg(`a:${a.id}`)}
            className={`${place} whitespace-nowrap text-center leading-tight text-slate-600/80`}>
            <span className="block text-sm font-bold uppercase tracking-[0.2em]">{A[a.type]}</span>
            {a.name && a.name !== A[a.type] && <span className="block text-[11px] font-medium">{a.name}</span>}
          </span>
        ))}
        {/* Overhead rack signs: the 3D board carries the code as readable DOM text. */}
        {scene.racks.map((p) => {
          const on = !active || active.has(p.rack.id);
          return (
            <button key={p.rack.id} ref={reg(`r:${p.rack.id}`)} type="button" onClick={() => onSelectRack(p.rack.id)}
              title={t(p.rack.zone ? L.rackSignTitleZone : L.rackSignTitle, { rack: p.rack.code, zone: p.rack.zone ?? '' })}
              className={`${place} pointer-events-auto whitespace-nowrap rounded-[4px] border-2 px-2.5 py-0.5 text-sm font-bold tracking-wider shadow-sm ${
                on ? 'border-white bg-blue-800 text-white hover:bg-blue-700' : 'border-slate-200 bg-white/60 text-slate-400 opacity-70 hover:opacity-100'
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
