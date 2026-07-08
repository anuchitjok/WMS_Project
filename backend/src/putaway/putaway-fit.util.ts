// Rotation-tolerant box-vs-slot fit check: sort both dimension sets descending
// and compare pairwise. This answers "would this box fit an empty slot of this
// size in some orientation" — it does not account for what's already stored in
// the slot (no per-item dimension data exists) and is not a bin-packing solver.
export function boxFitsSlot(box: [number, number, number], slot: [number, number, number]): boolean {
  const b = [...box].sort((a, c) => c - a);
  const s = [...slot].sort((a, c) => c - a);
  return b[0] <= s[0] && b[1] <= s[1] && b[2] <= s[2];
}
