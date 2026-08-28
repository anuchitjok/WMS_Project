'use client';

// Print / export the floor plan (Sprint 7).
//
// Client-side only, reusing the approach already proven by printLabel in the
// Control Center: open a window, write self-contained HTML, let the browser
// print or "Save as PDF". No new dependency and no server round trip.
//
// The printed plan always shows the WHOLE floor, not the operator's current
// zoom — a printout cropped to whatever happened to be on screen is a bug, not
// a feature.

import type { LayoutObject, WarehouseLayout, LayoutOccupancy } from '@/lib/api';

const PAD = 1;

export function printFloorPlan({ svg, layout, warehouseName, objects, occupancy }: {
  svg: SVGSVGElement | null;
  layout: WarehouseLayout;
  warehouseName: string;
  objects: LayoutObject[];
  occupancy: LayoutOccupancy[];
}): boolean {
  if (!svg) return false;

  // Clone so the live canvas keeps the user's zoom untouched.
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('viewBox', `${-PAD} ${-PAD} ${layout.widthUnits + PAD * 2} ${layout.heightUnits + PAD * 2}`);
  clone.setAttribute('width', '100%');
  clone.setAttribute('height', 'auto');
  clone.removeAttribute('class');
  // Selection outlines and focus rings are screen affordances, not part of the plan.
  clone.querySelectorAll('rect[stroke="#15803d"]').forEach((el) => el.remove());

  const linked = occupancy.filter((o) => !o.orphaned);
  const orphans = occupancy.filter((o) => o.orphaned).length;
  const totalQty = linked.reduce((a, o) => a + o.quantity, 0);
  const avgUtil = linked.length
    ? Math.round(linked.reduce((a, o) => a + o.utilizationPct, 0) / linked.length)
    : 0;

  const win = window.open('', '_blank', 'width=1100,height=800');
  if (!win) return false;

  const printedOn = new Date().toLocaleString();
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

  win.document.write(`<!DOCTYPE html><html><head><title>Floor Plan — ${esc(warehouseName)}</title>
<style>
  @page { size: A3 landscape; margin: 12mm; }
  body { font-family: Segoe UI, system-ui, sans-serif; margin: 0; padding: 24px; color: #0f172a; }
  header { display: flex; justify-content: space-between; align-items: flex-end;
           border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 16px; }
  h1 { font-size: 20px; margin: 0; }
  .sub { font-size: 12px; color: #64748b; margin-top: 2px; }
  .meta { font-size: 11px; color: #64748b; text-align: right; line-height: 1.6; }
  .plan { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; }
  .stats { display: flex; gap: 28px; margin-top: 14px; font-size: 12px; }
  .stats b { display: block; font-size: 17px; font-variant-numeric: tabular-nums; }
  .warn { margin-top: 12px; padding: 8px 10px; border: 1px solid #fcd34d; background: #fffbeb;
          color: #92400e; font-size: 12px; border-radius: 6px; }
  @media print { .noprint { display: none; } }
</style></head><body>
<header>
  <div>
    <h1>${esc(warehouseName)} — Floor Plan</h1>
    <div class="sub">${esc(layout.name)} · ${layout.widthUnits} × ${layout.heightUnits} ${esc(layout.unitLabel)}</div>
  </div>
  <div class="meta">Printed ${esc(printedOn)}<br>Layout version ${layout.version}</div>
</header>
<div class="plan">${clone.outerHTML}</div>
<div class="stats">
  <div>Objects <b>${objects.length}</b></div>
  <div>Linked bins <b>${linked.length}</b></div>
  <div>Total quantity <b>${totalQty.toLocaleString()}</b></div>
  <div>Average utilization <b>${avgUtil}%</b></div>
</div>
${orphans ? `<div class="warn">${orphans} drawn bin${orphans === 1 ? '' : 's'} point at a WMS slot that no longer exists.</div>` : ''}
<p class="noprint" style="margin-top:20px;color:#64748b;font-size:12px">
  Use your browser's print dialog to print, or choose "Save as PDF" to export.
</p>
</body></html>`);
  win.document.close();
  // Give the cloned SVG a tick to lay out before the print dialog measures it.
  win.setTimeout(() => win.print(), 250);
  return true;
}
