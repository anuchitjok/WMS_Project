'use client';

// The 3D scene of the Smart Warehouse. Client only, loaded with next/dynamic.
//
// A pure view: it draws the layout it is given, colours it from filters,
// selection, view mode and status colours, and reports hover / picks back.
// It knows nothing about where the data came from.
//
// Picking is real raycasting against two invisible instanced meshes:
//   • slot volumes (one per slot, inset between the beams), and
//   • rack shells (top cap and both end frames of each rack, outside every slot).
// The nearest hit that is inside the current filter wins; filtered-out parts
// are skipped, so they never block a click on what is behind them. Visible
// parts (beams, cartons, …) are not pick targets at all.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useT } from '@/i18n';
import type { Filters } from '../filter-search';
import { rackMatches } from '../filter-search';
import { type Bounds, type WarehouseLayout, BAY_W, LEVEL_H, boundsOf, frontNormal, toWorld } from '../layout';
import type { StatusColors } from '../status-colors';
import type { CameraRequest, PickMode, Selection, ViewMode } from '../store';
import { InstancedParts, UNIT_BOX } from './instanced-parts';
import { buildParts, slotCentre, type PartItem } from './parts';

export const SCENE_COLORS = {
  background: '#f3f5f7',
  upright: '#1d4ed8',
  uprightSelected: '#15803d',
  beam: '#ea580c',
  pallet: '#a47148',
  carton: '#c49a6c',
  ghost: '#dde1e6',
  ghostDark: '#cdd3da',
  hover: '#334155',
  select: '#16a34a',
} as const;

const DRAG_PX = 5;
const MAX_POLAR = Math.PI / 2 - 0.06;

export interface Hover { rack: number | null; slot: number | null }

export interface SmartSceneProps {
  layout: WarehouseLayout;
  filters: Filters;
  selection: Selection;
  viewMode: ViewMode;
  pickMode: PickMode;
  statusColors: StatusColors;
  camera: CameraRequest;
  onPick: (sel: Selection, focus: boolean) => void;
}

// ─── Derived per-render state ─────────────────────────────────────────────────

function useSceneState(layout: WarehouseLayout, filters: Filters, selection: Selection) {
  const rackOn = useMemo(() => layout.racks.map((r) => rackMatches(r.rack, filters)), [layout, filters]);
  const slotOn = useMemo(() => {
    const set = new Set(filters.statuses);
    return layout.slots.map((s) => rackOn[s.rackIndex] && set.has(s.slot.status));
  }, [layout, filters.statuses, rackOn]);
  const selSlot = selection?.kind === 'slot' ? layout.slotIndex.get(selection.id) ?? -1 : -1;
  const selRack = selection?.kind === 'rack'
    ? layout.rackIndex.get(selection.id) ?? -1
    : selSlot >= 0 ? layout.slots[selSlot].rackIndex : -1;
  return { rackOn, slotOn, selSlot, selRack };
}

// ─── Camera ───────────────────────────────────────────────────────────────────

type Goal = { pos: THREE.Vector3; target: THREE.Vector3 };

/**
 * Camera distance from `target` along `dir` at which every point in `pts` is on
 * screen, filling about `fill` of the view. Starts from a bounding-sphere guess
 * and tightens by projecting the points (a sphere alone leaves a lot of space).
 */
function fitPoints(pts: THREE.Vector3[], target: THREE.Vector3, dir: THREE.Vector3, cam: THREE.PerspectiveCamera, aspect: number, fill = 0.85): Goal {
  let radius = 0;
  for (const p of pts) radius = Math.max(radius, p.distanceTo(target));
  const vfov = THREE.MathUtils.degToRad(cam.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const n = dir.clone().normalize();
  let dist = Math.max(3, radius / Math.sin(Math.min(vfov, hfov) / 2));
  const probe = new THREE.PerspectiveCamera(cam.fov, aspect, 0.1, 10000);
  const v = new THREE.Vector3();
  for (let i = 0; i < 4; i++) {
    probe.position.copy(target).addScaledVector(n, dist);
    if (Math.abs(n.y) > 0.999) probe.up.set(0, 0, -1); else probe.up.set(0, 1, 0);
    probe.lookAt(target);
    probe.updateMatrixWorld();
    let extent = 0;
    for (const p of pts) {
      v.copy(p).project(probe);
      extent = Math.max(extent, Math.abs(v.x), Math.abs(v.y));
    }
    if (!Number.isFinite(extent) || extent <= 0) break;
    dist = Math.max(3, dist * (extent / fill));
  }
  return { target, pos: target.clone().addScaledVector(n, dist) };
}

/** Frame an axis-aligned box (the racks in view). */
function fitView(b: Bounds, dir: THREE.Vector3, cam: THREE.PerspectiveCamera, aspect: number): Goal {
  const target = new THREE.Vector3((b.minX + b.maxX) / 2, b.maxY * 0.3, (b.minZ + b.maxZ) / 2);
  const pts: THREE.Vector3[] = [];
  for (const x of [b.minX, b.maxX]) for (const y of [0, b.maxY]) for (const z of [b.minZ, b.maxZ]) pts.push(new THREE.Vector3(x, y, z));
  return fitPoints(pts, target, dir, cam, aspect);
}

/** The 8 corners of a rack (it may be rotated). */
function rackPoints(r: WarehouseLayout['racks'][number]) {
  const pts: THREE.Vector3[] = [];
  for (const lx of [-r.length / 2, r.length / 2]) for (const lz of [-r.depth / 2, r.depth / 2]) {
    const [x, z] = toWorld(r, lx, lz);
    pts.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, r.height, z));
  }
  return pts;
}

const DIRS = {
  iso: new THREE.Vector3(-0.75, 0.95, 1),
  top: new THREE.Vector3(0, 1, 0.0015),
  front: new THREE.Vector3(0, 0.32, 1),
};

function CameraController({ layout, fitBounds, request, selRack, selSlot, onReady }: {
  layout: WarehouseLayout; fitBounds: Bounds; request: CameraRequest; selRack: number; selSlot: number;
  onReady?: () => void;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void; addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void; minDistance: number; maxDistance: number } | null;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const goal = useRef<Goal | null>(null);
  const placed = useRef(false);
  const lastN = useRef(-1);
  const aspect = size.height > 0 ? size.width / size.height : 1.6;

  // Until the user moves the view, keep the home framing right for the canvas size
  // (the canvas can still be settling — panels collapsing, window resizing).
  const touched = useRef(false);
  useEffect(() => {
    if (!controls || !placed.current || touched.current) return;
    const home = fitView(layout.bounds, DIRS.iso, camera, aspect);
    camera.position.copy(home.pos); controls.target.copy(home.target); controls.update();
    invalidate();
  }, [size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop any flight as soon as the user grabs the view.
  useEffect(() => {
    if (!controls) return;
    const stop = () => { goal.current = null; touched.current = true; };
    controls.addEventListener('start', stop);
    return () => controls.removeEventListener('start', stop);
  }, [controls]);

  useFrame((_, dt) => {
    const g = goal.current;
    if (!g || !controls) return;
    const a = 1 - Math.pow(0.0006, Math.min(dt, 0.05));
    camera.position.lerp(g.pos, a);
    controls.target.lerp(g.target, a);
    controls.update();
    if (camera.position.distanceTo(g.pos) < 0.01 && controls.target.distanceTo(g.target) < 0.01) goal.current = null;
    else invalidate();
  });

  useEffect(() => {
    if (!controls) return;
    const home = fitView(layout.bounds, DIRS.iso, camera, aspect);
    if (!placed.current) {
      camera.position.copy(home.pos); controls.target.copy(home.target); controls.update();
      placed.current = true;
      invalidate(); onReady?.();
      // A search into another warehouse mounts a new scene with a pending
      // focus request: start from home, then fly to the target.
      if (request.view !== 'focus' || (selRack < 0 && selSlot < 0)) { lastN.current = request.n; return; }
    }
    if (request.n === lastN.current) return;
    lastN.current = request.n;
    touched.current = true;
    const cur = { pos: (goal.current?.pos ?? camera.position).clone(), target: (goal.current?.target ?? controls.target).clone() };
    let next: Goal | null = null;
    switch (request.view) {
      case 'reset': next = home; break;
      case 'fit': case 'iso': next = fitView(fitBounds, DIRS.iso, camera, aspect); break;
      case 'top': next = fitView(fitBounds, DIRS.top, camera, aspect); break;
      case 'front': next = fitView(fitBounds, DIRS.front, camera, aspect); break;
      case 'zoomIn': case 'zoomOut': {
        const dir = cur.pos.clone().sub(cur.target);
        const len = THREE.MathUtils.clamp(dir.length() * (request.view === 'zoomIn' ? 0.7 : 1.4), controls.minDistance, controls.maxDistance);
        next = { pos: cur.target.clone().add(dir.setLength(len)), target: cur.target };
        break;
      }
      case 'focus': {
        if (selSlot >= 0) {
          // Stand in the aisle in front of the slot, a little to the side and
          // above it — never inside the rack across the aisle.
          const s = layout.slots[selSlot];
          const r = layout.racks[s.rackIndex];
          const [nx, nz] = frontNormal(r);
          const t = new THREE.Vector3(...slotCentre(s));
          // Far enough to show about three bays across the narrower side of the view.
          const vfov = THREE.MathUtils.degToRad(camera.fov);
          const half = Math.min(vfov, 2 * Math.atan(Math.tan(vfov / 2) * aspect)) / 2;
          const d = Math.max(3.5, 2.1 / Math.tan(half));
          const dir = new THREE.Vector3(nx * 2.6 + nz * 0.9, 2.0, nz * 2.6 - nx * 0.9).normalize().multiplyScalar(d);
          // Stay inside the aisle: any distance beyond it goes into height instead.
          const along = dir.x * nx + dir.z * nz;
          const maxOut = r.depth / 2 + 2.8; // from the rack centre line; the aisle is 3.2 m wide
          if (along > maxOut) {
            const k = maxOut / along;
            const lost = Math.hypot(dir.x, dir.z) * (1 - k);
            dir.x *= k; dir.z *= k; dir.y += lost;
          }
          next = { target: t, pos: t.clone().add(dir) };
        } else if (selRack >= 0) {
          // From the aisle side, high enough to look over the rack opposite.
          const r = layout.racks[selRack];
          const [nx, nz] = frontNormal(r);
          const t = new THREE.Vector3(r.cx, r.height * 0.45, r.cz);
          next = fitPoints(rackPoints(r), t, new THREE.Vector3(nx * 0.8 + nz * 0.3, 1.05, nz * 0.8 - nx * 0.3), camera, aspect, 0.8);
        }
        break;
      }
    }
    if (next) { goal.current = next; invalidate(); }
  }, [request, controls]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

// ─── Picking ──────────────────────────────────────────────────────────────────

function Picker({ slotHit, rackHit, slotHitItems, rackHitItems, slotRack, slotOn, rackOn, onHover, onClick }: {
  slotHit: RefObject<THREE.InstancedMesh | null>; rackHit: RefObject<THREE.InstancedMesh | null>;
  slotHitItems: PartItem[]; rackHitItems: PartItem[];
  /** Rack index of each slot index. */
  slotRack: number[];
  slotOn: boolean[]; rackOn: boolean[];
  onHover: (h: Hover) => void;
  onClick: (h: Hover | null) => void;
}) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const latest = useRef({ slotHitItems, rackHitItems, slotRack, slotOn, rackOn, onHover, onClick });
  useEffect(() => { latest.current = { slotHitItems, rackHitItems, slotRack, slotOn, rackOn, onHover, onClick }; });

  useEffect(() => {
    const el = gl.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;
    let frame = 0;
    let lastMove: PointerEvent | null = null;

    const pickAt = (cx: number, cy: number): Hover | null => {
      const L = latest.current;
      const rect = el.getBoundingClientRect();
      ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const targets = [slotHit.current, rackHit.current].filter((m): m is THREE.InstancedMesh => !!m);
      for (const h of ray.intersectObjects(targets, false)) {
        if (h.instanceId == null) continue;
        if (h.object === slotHit.current) {
          const si = L.slotHitItems[h.instanceId]?.owner;
          if (si == null || !L.slotOn[si]) continue;
          return { slot: si, rack: L.slotRack[si] ?? -1 };
        }
        const ri = L.rackHitItems[h.instanceId]?.owner;
        if (ri == null || !L.rackOn[ri]) continue;
        return { slot: null, rack: ri };
      }
      return null;
    };

    const move = (e: PointerEvent) => {
      if (e.buttons) return; // dragging the view: keep the current hover
      lastMove = e;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!lastMove) return;
        const h = pickAt(lastMove.clientX, lastMove.clientY);
        el.style.cursor = h ? 'pointer' : '';
        latest.current.onHover(h ?? { rack: null, slot: null });
      });
    };
    const leave = () => { lastMove = null; el.style.cursor = ''; latest.current.onHover({ rack: null, slot: null }); };
    const pdown = (e: PointerEvent) => { down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null; };
    const pup = (e: PointerEvent) => {
      if (!down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > DRAG_PX) return;
      latest.current.onClick(pickAt(e.clientX, e.clientY));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('pointerdown', pdown);
    el.addEventListener('pointerup', pup);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('pointerdown', pdown);
      el.removeEventListener('pointerup', pup);
      el.style.cursor = '';
    };
  }, [gl, camera, slotHit, rackHit]);

  return null;
}

// ─── Highlights ───────────────────────────────────────────────────────────────

const EDGES = new THREE.EdgesGeometry(UNIT_BOX);

function BoxOutline({ pos, size, rotY, color, fill, fillOpacity = 0.12 }: {
  pos: [number, number, number]; size: [number, number, number]; rotY: number; color: string; fill?: boolean; fillOpacity?: number;
}) {
  return (
    <group position={pos} rotation={[0, rotY, 0]} scale={size}>
      <lineSegments geometry={EDGES} renderOrder={2}>
        <lineBasicMaterial color={color} depthTest={false} transparent opacity={0.95} />
      </lineSegments>
      {fill && (
        <mesh geometry={UNIT_BOX} renderOrder={1}>
          <meshBasicMaterial color={color} transparent opacity={fillOpacity} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

function rackBox(layout: WarehouseLayout, ri: number) {
  const r = layout.racks[ri];
  return { pos: [r.cx, r.height / 2, r.cz] as [number, number, number], size: [r.length + 0.16, r.height + 0.08, r.depth + 0.16] as [number, number, number], rotY: r.rotY };
}
function slotBox(layout: WarehouseLayout, si: number) {
  const s = layout.slots[si];
  const c = slotCentre(s);
  return { pos: c, size: [BAY_W - 0.1, LEVEL_H - 0.1, s.size[2] + 0.04] as [number, number, number], rotY: s.rotY };
}

function SelectionPin({ layout, si }: { layout: WarehouseLayout; si: number }) {
  const s = layout.slots[si];
  const r = layout.racks[s.rackIndex];
  const y = r.height + 0.9;
  return (
    <group position={[s.pos[0], y, s.pos[2]]}>
      <mesh position={[0, -0.3, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.22, 0.55, 20]} />
        <meshStandardMaterial color={SCENE_COLORS.select} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.08, 0]}>
        <sphereGeometry args={[0.22, 20, 14]} />
        <meshStandardMaterial color={SCENE_COLORS.select} roughness={0.5} />
      </mesh>
      {/* Thin drop line down to the slot */}
      <mesh position={[0, -(y - slotCentre(s)[1]) / 2 - 0.3, 0]}>
        <boxGeometry args={[0.025, Math.max(0.1, y - slotCentre(s)[1] - 0.6), 0.025]} />
        <meshBasicMaterial color={SCENE_COLORS.select} transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

// ─── DOM labels, projected every frame (no React re-render) ───────────────────

export interface LabelDef { key: string; pos: [number, number, number]; maxDist?: number }

function LabelProjector({ labels, els }: { labels: LabelDef[]; els: RefObject<Map<string, HTMLElement>> }) {
  const invalidate = useThree((s) => s.invalidate);
  const v = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => { invalidate(); }, [labels, invalidate]);
  useFrame(({ camera, size }) => {
    for (const l of labels) {
      const el = els.current?.get(l.key);
      if (!el) continue;
      v.set(l.pos[0], l.pos[1], l.pos[2]);
      const far = l.maxDist != null && camera.position.distanceTo(v) > l.maxDist;
      v.project(camera);
      if (far || v.z > 1 || v.z < -1) { el.style.visibility = 'hidden'; continue; }
      el.style.visibility = 'visible';
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(var(--ax, -50%), var(--ay, -50%))`;
    }
  });
  return null;
}

// ─── Dev/test hook: screen position of a slot or rack ─────────────────────────

function DebugHook({ layout }: { layout: WarehouseLayout }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as unknown as { target?: THREE.Vector3 } | null;
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as unknown as { __smartWarehouse3d?: unknown };
    w.__smartWarehouse3d = {
      /** Client (page) coordinates of a slot centre or a rack's top cap. */
      project: (id: string) => {
        const si = layout.slotIndex.get(id);
        const ri = layout.rackIndex.get(id);
        let p: THREE.Vector3 | null = null;
        if (si != null) {
          // Centre of the slot's open front face — what a user clicks on.
          const sl = layout.slots[si];
          const r = layout.racks[sl.rackIndex];
          const [nx, nz] = frontNormal(r);
          const c = slotCentre(sl);
          p = new THREE.Vector3(c[0] + nx * (r.depth / 2 - 0.05), c[1] + 0.1, c[2] + nz * (r.depth / 2 - 0.05));
        }
        else if (ri != null) { const r = layout.racks[ri]; p = new THREE.Vector3(r.cx, r.height + 0.12, r.cz); }
        if (!p) return null;
        p.project(camera);
        const rect = gl.domElement.getBoundingClientRect();
        return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height, onScreen: Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 };
      },
      camera: () => ({
        x: camera.position.x, y: camera.position.y, z: camera.position.z,
        target: controls?.target ? { x: controls.target.x, y: controls.target.y, z: controls.target.z } : null,
      }),
      counts: () => ({ racks: layout.racks.length, slots: layout.slots.length, calls: gl.info.render.calls, triangles: gl.info.render.triangles }),
    };
    return () => { delete w.__smartWarehouse3d; };
  }, [layout, camera, gl, controls]);
  return null;
}

// ─── Scene content ────────────────────────────────────────────────────────────

function SceneContent(props: SmartSceneProps & {
  hover: Hover; setHover: (h: Hover) => void; labels: LabelDef[]; labelEls: RefObject<Map<string, HTMLElement>>;
}) {
  const { layout, filters, selection, viewMode, pickMode, statusColors, camera, onPick, hover, setHover, labels, labelEls } = props;
  const parts = useMemo(() => buildParts(layout), [layout]);
  const { rackOn, slotOn, selSlot, selRack } = useSceneState(layout, filters, selection);
  const slotRack = useMemo(() => layout.slots.map((s) => s.rackIndex), [layout]);

  const slotHit = useRef<THREE.InstancedMesh>(null);
  const rackHit = useRef<THREE.InstancedMesh>(null);

  const fitBounds = useMemo(() => {
    const on = layout.racks.filter((_, i) => rackOn[i]);
    return boundsOf(on.length ? on : layout.racks);
  }, [layout, rackOn]);

  // Colour rules ------------------------------------------------------------
  const C = SCENE_COLORS;
  const frameColor = useCallback((it: PartItem) => it.owner === selRack ? C.uprightSelected : rackOn[it.owner] ? C.upright : C.ghostDark, [rackOn, selRack, C]);
  const beamColor = useCallback((it: PartItem) => rackOn[layout.slots[it.owner].rackIndex] ? C.beam : C.ghost, [rackOn, layout, C]);
  const statusColor = useCallback((it: PartItem) => slotOn[it.owner] ? statusColors[layout.slots[it.owner].slot.status] : C.ghost, [slotOn, statusColors, layout, C]);
  const palletColor = useCallback((it: PartItem) => slotOn[it.owner] ? C.pallet : C.ghost, [slotOn, C]);
  const cartonColor = useCallback((it: PartItem) => slotOn[it.owner] ? C.carton : C.ghost, [slotOn, C]);

  // Interaction -------------------------------------------------------------
  const onHover = useCallback((h: Hover) => {
    if (h.rack !== hover.rack || h.slot !== hover.slot) setHover(h);
  }, [hover, setHover]);
  const onClick = useCallback((h: Hover | null) => {
    if (!h) { onPick(null, false); return; }
    if (h.slot != null && pickMode === 'slot') onPick({ kind: 'slot', id: layout.slots[h.slot].slot.id }, false);
    else if (h.rack != null && h.rack >= 0) onPick({ kind: 'rack', id: layout.racks[h.rack].rack.id }, true);
  }, [pickMode, layout, onPick]);

  const statusView = viewMode === 'status';
  const hoverRack = hover.rack != null && hover.rack >= 0 ? hover.rack : -1;
  const hoverSlot = pickMode === 'slot' && hover.slot != null ? hover.slot : -1;
  const b = layout.bounds;
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 10);

  return (
    <>
      <color attach="background" args={[C.background]} />
      <hemisphereLight args={['#ffffff', '#cfd5db', 1.1]} />
      <directionalLight position={[b.minX - 20, 40, b.maxZ + 30]} intensity={1.45} />
      <directionalLight position={[b.maxX + 25, 20, b.minZ - 20]} intensity={0.45} />

      {/* Zone outlines on the ground — lines only, no floor slab. */}
      {layout.zones.map((z) => (
        <Line key={z.id} points={[[z.minX, 0.01, z.minZ], [z.maxX, 0.01, z.minZ], [z.maxX, 0.01, z.maxZ], [z.minX, 0.01, z.maxZ], [z.minX, 0.01, z.minZ]]}
          color={filters.zoneId === z.id ? C.select : '#a3acb8'} lineWidth={filters.zoneId === z.id ? 2 : 1} dashed dashSize={0.6} gapSize={0.4} />
      ))}

      <ContactShadows key={layout.warehouseId} position={[(b.minX + b.maxX) / 2, 0.002, (b.minZ + b.maxZ) / 2]}
        scale={span + 8} opacity={0.22} blur={2.4} far={6} resolution={1024} frames={1} color="#1f2937" />

      {/* Rack structure */}
      <InstancedParts items={parts.uprights} colorOf={frameColor} metalness={0.3} roughness={0.5} />
      <InstancedParts items={parts.braces} colorOf={frameColor} metalness={0.3} roughness={0.5} />
      <InstancedParts items={parts.beams} colorOf={beamColor} metalness={0.2} roughness={0.5} />

      {/* Slots: status deck plate and front-beam tag on every slot */}
      <InstancedParts items={parts.plates} colorOf={statusColor} roughness={0.7} />
      <InstancedParts items={parts.tags} colorOf={statusColor} kind="basic" />

      {/* Stock: pallets and cartons (realistic view) or status blocks (status view) */}
      <InstancedParts items={parts.palletRunners} colorOf={palletColor} roughness={0.95} visible={!statusView} />
      <InstancedParts items={parts.palletTops} colorOf={palletColor} roughness={0.95} visible={!statusView} />
      <InstancedParts items={parts.cartons} colorOf={cartonColor} roughness={0.9} visible={!statusView} />
      <InstancedParts items={parts.volumes} colorOf={statusColor} opacity={0.55} roughness={0.8} visible={statusView} />

      {/* Pick targets */}
      <InstancedParts items={parts.hits} kind="hit" meshRef={slotHit} />
      <InstancedParts items={parts.rackHits} kind="hit" meshRef={rackHit} />

      {/* Highlights */}
      {hoverRack >= 0 && hoverRack !== selRack && <BoxOutline {...rackBox(layout, hoverRack)} color={C.hover} />}
      {selRack >= 0 && <BoxOutline {...rackBox(layout, selRack)} color={C.select} fill fillOpacity={0.06} />}
      {hoverSlot >= 0 && hoverSlot !== selSlot && <BoxOutline {...slotBox(layout, hoverSlot)} color={C.hover} fill fillOpacity={0.1} />}
      {selSlot >= 0 && <BoxOutline {...slotBox(layout, selSlot)} color={C.select} fill fillOpacity={0.3} />}
      {selSlot >= 0 && <SelectionPin layout={layout} si={selSlot} />}

      <LabelProjector labels={labels} els={labelEls} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} screenSpacePanning={false}
        maxPolarAngle={MAX_POLAR} minDistance={1.5} maxDistance={span * 4 + 40} />
      <CameraController layout={layout} fitBounds={fitBounds} request={camera} selRack={selRack} selSlot={selSlot} />
      <Picker slotHit={slotHit} rackHit={rackHit} slotHitItems={parts.hits} rackHitItems={parts.rackHits} slotRack={slotRack}
        slotOn={slotOn} rackOn={rackOn} onHover={onHover} onClick={onClick} />
      <DebugHook layout={layout} />
    </>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

export default function SmartScene(props: SmartSceneProps) {
  const { layout, filters, selection, pickMode } = props;
  const { m, t } = useT();
  const L = m.layout3d.smart.scene;
  const [hover, setHover] = useState<Hover>({ rack: null, slot: null });
  const labelEls = useRef(new Map<string, HTMLElement>());
  const { rackOn, selSlot, selRack } = useSceneState(layout, filters, selection);

  const aisleById = useMemo(() => new Map(layout.aisles.map((a) => [a.id, a.aisle])), [layout]);
  const rackLabel = (ri: number) => {
    const r = layout.racks[ri].rack;
    return `${aisleById.get(r.aisleId)?.code ?? ''}-${r.code}`;
  };

  const hoverRack = hover.rack != null && hover.rack >= 0 ? hover.rack : -1;
  const hoverSlot = pickMode === 'slot' && hover.slot != null ? hover.slot : -1;

  const labels = useMemo<LabelDef[]>(() => {
    const out: LabelDef[] = [];
    for (const z of layout.zones) out.push({ key: `z:${z.id}`, pos: [z.minX, 0.02, z.maxZ] });
    for (const a of layout.aisles) out.push({ key: `a:${a.id}`, pos: [a.label[0], 0.02, a.label[1]], maxDist: 90 });
    for (const r of layout.racks) out.push({ key: `r:${r.rack.id}`, pos: [r.cx, r.height + 0.35, r.cz], maxDist: 32 });
    if (selRack >= 0) {
      const r = layout.racks[selRack];
      for (let l = 1; l <= r.rack.levels; l++) {
        const [x, z] = toWorld(r, -r.length / 2 - 0.35, r.depth / 2);
        out.push({ key: `lv:${l}`, pos: [x, 0.15 + (l - 1) * LEVEL_H + LEVEL_H / 2, z] });
      }
      for (let bb = 1; bb <= r.rack.bays; bb++) {
        const [x, z] = toWorld(r, (bb - 0.5) * BAY_W - r.length / 2, r.depth / 2 + 0.1);
        out.push({ key: `bay:${bb}`, pos: [x, 0.02, z] });
      }
    }
    if (selSlot >= 0) {
      const s = layout.slots[selSlot];
      out.push({ key: 'sel', pos: [s.pos[0], layout.racks[s.rackIndex].height + 1.35, s.pos[2]] });
    }
    if (hoverRack >= 0 && hoverRack !== selRack) {
      const r = layout.racks[hoverRack];
      out.push({ key: 'hov', pos: [r.cx, r.height + 0.9, r.cz] });
    }
    if (hoverSlot >= 0 && hoverSlot !== selSlot) {
      out.push({ key: 'hovs', pos: slotCentre(layout.slots[hoverSlot]) });
    }
    return out;
  }, [layout, selRack, selSlot, hoverRack, hoverSlot]);

  const reg = (key: string) => (el: HTMLElement | null) => { if (el) labelEls.current.set(key, el); else labelEls.current.delete(key); };
  const base = 'absolute left-0 top-0 invisible whitespace-nowrap will-change-transform';
  const selRackNode = selRack >= 0 ? layout.racks[selRack] : null;

  return (
    <div className="absolute inset-0" data-testid="smart3d-scene">
      <Canvas frameloop="demand" dpr={[1, 2]} camera={{ fov: 42, near: 0.1, far: 4000, position: [-30, 30, 40] }}
        gl={{ antialias: true, powerPreference: 'high-performance' }} className="touch-none" onContextMenu={(e) => e.preventDefault()}>
        <SceneContent {...props} hover={hover} setHover={setHover} labels={labels} labelEls={labelEls} />
      </Canvas>

      {/* Labels never take pointer events, so they can't block a click on the scene. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden select-none" aria-hidden>
        {layout.zones.map((z) => (
          <span key={z.id} ref={reg(`z:${z.id}`)} style={{ ['--ax' as string]: '0%', ['--ay' as string]: '15%' }}
            className={`${base} text-xs font-semibold uppercase tracking-[0.16em] ${filters.zoneId && filters.zoneId !== z.id ? 'text-slate-300' : 'text-slate-500'}`}>
            {t(L.zone, { zone: z.zone.code })} · {z.zone.name}
          </span>
        ))}
        {layout.aisles.map((a) => (
          <span key={a.id} ref={reg(`a:${a.id}`)} style={{ ['--ax' as string]: '-100%' }}
            className={`${base} rounded bg-white/80 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200`}>
            {t(L.aisle, { aisle: a.aisle.code })}
          </span>
        ))}
        {layout.racks.map((r, i) => (
          <span key={r.rack.id} ref={reg(`r:${r.rack.id}`)}
            className={`${base} rounded px-1.5 py-px text-[10px] font-semibold tracking-wide ${
              i === selRack ? 'bg-green-700 text-white' : rackOn[i] ? 'bg-slate-800/80 text-white' : 'bg-white/70 text-slate-400'
            }`}>
            {rackLabel(i)}
          </span>
        ))}
        {selRackNode && Array.from({ length: selRackNode.rack.levels }, (_, i) => (
          <span key={`lv${i}`} ref={reg(`lv:${i + 1}`)} style={{ ['--ax' as string]: '-100%' }}
            className={`${base} rounded bg-white/90 px-1 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-300`}>
            {t(L.level, { n: i + 1 })}
          </span>
        ))}
        {selRackNode && Array.from({ length: selRackNode.rack.bays }, (_, i) => (
          <span key={`bay${i}`} ref={reg(`bay:${i + 1}`)} style={{ ['--ay' as string]: '0%' }}
            className={`${base} rounded bg-white/90 px-1 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-300`}>
            {t(L.bay, { n: String(i + 1).padStart(2, '0') })}
          </span>
        ))}
        {selSlot >= 0 && (
          <span ref={reg('sel')} style={{ ['--ay' as string]: '-100%' }}
            className={`${base} rounded-md bg-green-700 px-2 py-0.5 text-xs font-semibold text-white shadow`}>
            {t(L.slot, { id: layout.slots[selSlot].slot.id })}
          </span>
        )}
        {hoverRack >= 0 && hoverRack !== selRack && (
          <span ref={reg('hov')} style={{ ['--ay' as string]: '-100%' }}
            className={`${base} rounded-md bg-slate-900 px-2 py-0.5 text-xs font-medium text-white shadow`}>
            {t(L.rack, { id: layout.racks[hoverRack].rack.id })}
          </span>
        )}
        {hoverSlot >= 0 && hoverSlot !== selSlot && (
          <span ref={reg('hovs')}
            className={`${base} rounded bg-white/95 px-1.5 py-px text-[10px] font-medium text-slate-700 shadow ring-1 ring-slate-300`}>
            {`L${layout.slots[hoverSlot].slot.level}-B${String(layout.slots[hoverSlot].slot.bay).padStart(2, '0')}`}
          </span>
        )}
      </div>
    </div>
  );
}
