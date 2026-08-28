'use client';

// Editor state for the Floor Plan (Sprint 5).
//
// Everything is edited locally and flushed to the server in one batch. That is
// not just an optimisation: the API sits behind a global 100 req/min throttle,
// so a request per drag would exhaust it in well under a minute.
//
// Undo/redo works on whole-state snapshots. A floor plan is hundreds of objects,
// not thousands, so snapshotting is cheaper and far less bug-prone than diffing.

import { useCallback, useMemo, useReducer } from 'react';
import type { LayoutObject, LayoutObjectType } from '@/lib/api';

export const TEMP_PREFIX = 'tmp_';
export const isTempId = (id: string) => id.startsWith(TEMP_PREFIX);

const HISTORY_LIMIT = 50;

export interface EditorState {
  objects: Record<string, LayoutObject>;
  order: string[];
  selection: string[];
  dirty: string[];   // created or modified, awaiting flush
  deleted: string[]; // server ids removed, awaiting flush
  past: Snapshot[];
  future: Snapshot[];
  seq: number;
}

type Snapshot = Pick<EditorState, 'objects' | 'order' | 'selection' | 'dirty' | 'deleted'>;

// The minimum a caller must supply to create an object; everything else is
// defaulted when the object is materialised.
export type NewObjectInput =
  Partial<LayoutObject>
  & Pick<LayoutObject, 'objectType' | 'name' | 'x' | 'y' | 'width' | 'height'>;

type Action =
  | { type: 'reset'; objects: LayoutObject[] }
  | { type: 'select'; ids: string[]; additive?: boolean }
  | { type: 'add'; object: NewObjectInput }
  | { type: 'patch'; ids: string[]; patch: Partial<LayoutObject>; history?: boolean }
  | { type: 'remove'; ids: string[] }
  | { type: 'duplicate'; ids: string[] }
  | { type: 'checkpoint' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'saved'; objects: LayoutObject[] };

const snap = (s: EditorState): Snapshot => ({
  objects: s.objects, order: s.order, selection: s.selection, dirty: s.dirty, deleted: s.deleted,
});

const push = (s: EditorState): Pick<EditorState, 'past' | 'future'> => ({
  past: [...s.past, snap(s)].slice(-HISTORY_LIMIT),
  future: [],
});

function indexObjects(objects: LayoutObject[]) {
  const map: Record<string, LayoutObject> = {};
  for (const o of objects) map[o.id] = o;
  return { objects: map, order: objects.map((o) => o.id) };
}

const uniq = (xs: string[]) => [...new Set(xs)];

export const EMPTY: EditorState = {
  objects: {}, order: [], selection: [], dirty: [], deleted: [], past: [], future: [], seq: 0,
};

function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'reset':
    case 'saved': {
      // Server response is authoritative: it replaces local state entirely and
      // clears the pending sets. History is dropped so undo can never resurrect
      // an object the server has already deleted.
      return { ...EMPTY, ...indexObjects(action.objects), seq: state.seq };
    }

    case 'select':
      return {
        ...state,
        selection: action.additive
          ? (state.selection.includes(action.ids[0])
              ? state.selection.filter((id) => !action.ids.includes(id))
              : uniq([...state.selection, ...action.ids]))
          : action.ids,
      };

    case 'checkpoint':
      // Called once at the start of a drag/resize so the whole gesture is a
      // single undo step rather than one per pointermove.
      return { ...state, ...push(state) };

    case 'add': {
      const id = `${TEMP_PREFIX}${state.seq + 1}`;
      const object: LayoutObject = {
        id, layoutId: '', parentObjectId: null, code: null,
        rotation: 0, zIndex: 0, displayOrder: state.order.length,
        slotId: null, rackId: null, capacity: null, color: null,
        status: 'ACTIVE', metadata: null, updatedAt: new Date().toISOString(),
        ...action.object,
      } as LayoutObject;
      return {
        ...state, ...push(state),
        objects: { ...state.objects, [id]: object },
        order: [...state.order, id],
        selection: [id],
        dirty: uniq([...state.dirty, id]),
        seq: state.seq + 1,
      };
    }

    case 'patch': {
      const objects = { ...state.objects };
      for (const id of action.ids) {
        if (!objects[id]) continue;
        objects[id] = { ...objects[id], ...action.patch };
      }
      return {
        ...state,
        ...(action.history === false ? {} : push(state)),
        objects,
        dirty: uniq([...state.dirty, ...action.ids.filter((id) => state.objects[id])]),
      };
    }

    case 'remove': {
      // Removing a parent removes its subtree locally too, mirroring what the
      // server does, so the canvas never shows an orphan mid-edit.
      const doomed = new Set<string>();
      const walk = (id: string) => {
        if (doomed.has(id)) return;
        doomed.add(id);
        for (const cid of state.order) if (state.objects[cid]?.parentObjectId === id) walk(cid);
      };
      action.ids.forEach(walk);

      const objects = { ...state.objects };
      doomed.forEach((id) => delete objects[id]);
      return {
        ...state, ...push(state),
        objects,
        order: state.order.filter((id) => !doomed.has(id)),
        selection: [],
        dirty: state.dirty.filter((id) => !doomed.has(id)),
        deleted: uniq([...state.deleted, ...[...doomed].filter((id) => !isTempId(id))]),
      };
    }

    case 'duplicate': {
      // Local-only copy so the gesture stays instant and undoable. Copies drop
      // slotId/rackId/code exactly as the server's duplicate endpoint does.
      const objects = { ...state.objects };
      const order = [...state.order];
      const newIds: string[] = [];
      let seq = state.seq;
      for (const id of action.ids) {
        const src = state.objects[id];
        if (!src) continue;
        const nid = `${TEMP_PREFIX}${++seq}`;
        objects[nid] = {
          ...src, id: nid, name: `${src.name} copy`, code: null,
          slotId: null, rackId: null,
          x: src.x + 2, y: src.y + 2,
        };
        order.push(nid);
        newIds.push(nid);
      }
      if (!newIds.length) return state;
      return {
        ...state, ...push(state),
        objects, order, selection: newIds,
        dirty: uniq([...state.dirty, ...newIds]),
        seq,
      };
    }

    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        ...state, ...prev,
        past: state.past.slice(0, -1),
        future: [snap(state), ...state.future].slice(0, HISTORY_LIMIT),
      };
    }

    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state, ...next,
        past: [...state.past, snap(state)].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
      };
    }

    default:
      return state;
  }
}

export function useLayoutEditor() {
  const [state, dispatch] = useReducer(reducer, EMPTY);

  const objects = useMemo(
    () => state.order.map((id) => state.objects[id]).filter(Boolean),
    [state.order, state.objects],
  );

  const selectedObjects = useMemo(
    () => state.selection.map((id) => state.objects[id]).filter(Boolean),
    [state.selection, state.objects],
  );

  const isDirty = state.dirty.length > 0 || state.deleted.length > 0;

  // The batch payload. Upserts carry the object's COMPLETE desired state, which
  // is what the API expects; temp ids are sent without an `id` so the server
  // creates them and hands back the real ones.
  const buildPayload = useCallback((version: number) => ({
    version,
    upserts: state.dirty
      .map((id) => state.objects[id])
      .filter(Boolean)
      .map((o) => ({
        ...(isTempId(o.id) ? {} : { id: o.id }),
        objectType: o.objectType,
        name: o.name,
        ...(o.code ? { code: o.code } : {}),
        ...(o.parentObjectId && !isTempId(o.parentObjectId) ? { parentObjectId: o.parentObjectId } : {}),
        x: round(o.x), y: round(o.y), width: round(o.width), height: round(o.height),
        rotation: o.rotation ?? 0,
        zIndex: o.zIndex ?? 0,
        displayOrder: o.displayOrder ?? 0,
        ...(o.capacity != null ? { capacity: o.capacity } : {}),
        ...(o.color ? { color: o.color } : {}),
        status: o.status,
        ...(o.metadata ? { metadata: o.metadata } : {}),
      })),
    deletes: state.deleted,
  }), [state.dirty, state.deleted, state.objects]);

  return {
    state,
    objects,
    selectedObjects,
    isDirty,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    buildPayload,
    reset: useCallback((objs: LayoutObject[]) => dispatch({ type: 'reset', objects: objs }), []),
    saved: useCallback((objs: LayoutObject[]) => dispatch({ type: 'saved', objects: objs }), []),
    select: useCallback((ids: string[], additive = false) => dispatch({ type: 'select', ids, additive }), []),
    add: useCallback((object: NewObjectInput) => dispatch({ type: 'add', object }), []),
    patch: useCallback((ids: string[], patch: Partial<LayoutObject>, history = true) =>
      dispatch({ type: 'patch', ids, patch, history }), []),
    remove: useCallback((ids: string[]) => dispatch({ type: 'remove', ids }), []),
    duplicate: useCallback((ids: string[]) => dispatch({ type: 'duplicate', ids }), []),
    checkpoint: useCallback(() => dispatch({ type: 'checkpoint' }), []),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
  };
}

// Geometry is stored as a float; trim drag noise so payloads stay readable.
const round = (n: number) => Math.round(n * 100) / 100;
