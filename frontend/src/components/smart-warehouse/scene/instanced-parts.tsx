'use client';

// One InstancedMesh for one list of parts. Geometry (matrices) is written when
// the list changes; colours are written separately when `colorOf` changes, so
// filtering and selection never rebuild geometry.

import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { PartItem } from './parts';

export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

export function InstancedParts({
  items, colorOf, meshRef, kind = 'standard', roughness = 0.8, metalness = 0, opacity, visible = true,
}: {
  items: PartItem[];
  /** Colour for one part (hex). Called for every part when it changes. */
  colorOf?: (item: PartItem) => string;
  meshRef?: RefObject<THREE.InstancedMesh | null>;
  /** 'hit' = invisible pick target: raycastable, draws nothing. */
  kind?: 'standard' | 'basic' | 'hit';
  roughness?: number; metalness?: number; opacity?: number; visible?: boolean;
}) {
  const own = useRef<THREE.InstancedMesh>(null);
  const ref = meshRef ?? own;
  const invalidate = useThree((s) => s.invalidate);
  const cache = useMemo(() => new Map<string, THREE.Color>(), []);

  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    o.rotation.order = 'YXZ'; // rack heading first, then the brace tilt in rack space
    items.forEach((it, i) => {
      o.position.set(it.pos[0], it.pos[1], it.pos[2]);
      o.rotation.set(it.rotX ?? 0, it.rotY, 0);
      o.scale.set(Math.max(it.scale[0], 1e-4), Math.max(it.scale[1], 1e-4), Math.max(it.scale[2], 1e-4));
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingBox();
    m.computeBoundingSphere();
    invalidate();
  }, [items, ref, invalidate]);

  useLayoutEffect(() => {
    const m = ref.current;
    if (!m || !colorOf || kind === 'hit') return;
    const c = new THREE.Color();
    items.forEach((it, i) => {
      const hex = colorOf(it);
      let base = cache.get(hex);
      if (!base) { base = new THREE.Color(hex); cache.set(hex, base); }
      c.copy(base);
      if (it.shade != null) c.multiplyScalar(it.shade);
      m.setColorAt(i, c);
    });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    invalidate();
  }, [items, colorOf, kind, ref, cache, invalidate]);

  if (!items.length) return null;
  return (
    <instancedMesh ref={ref} args={[UNIT_BOX, undefined, items.length]} visible={visible} frustumCulled>
      {kind === 'hit'
        ? <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        : kind === 'basic'
          ? <meshBasicMaterial color="#ffffff" transparent={opacity != null} opacity={opacity ?? 1} depthWrite={opacity == null} />
          : <meshStandardMaterial color="#ffffff" roughness={roughness} metalness={metalness}
              transparent={opacity != null} opacity={opacity ?? 1} depthWrite={opacity == null} />}
    </instancedMesh>
  );
}
