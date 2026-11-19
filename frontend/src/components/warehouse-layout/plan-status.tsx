'use client';

// RQ13 — where a floor plan stands: drawn, waiting for a decision, or agreed.
//
// The plan itself is one per warehouse and everyone keeps seeing the same one;
// this strip says who signed it off and lets the right people move it along.
// Approval governs the drawing only — it never touches stock (decision C5).

import { useState } from 'react';
import { CheckCircle2, Clock, FileEdit, Send, Undo2, Box, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import type { LayoutApproval, LayoutStatus, WarehouseLayout } from '@/lib/api';

/** The name of whoever decided the chain, when the engine recorded one. */
function deciderName(approval?: LayoutApproval | null): string | null {
  const steps = approval?.steps ?? [];
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].status === 'APPROVED' && steps[i].actorName) return steps[i].actorName as string;
  }
  return null;
}

const TONE: Record<LayoutStatus, string> = {
  DRAFT: 'border-slate-200 bg-slate-50 text-slate-600',
  PENDING: 'border-amber-200 bg-amber-50 text-amber-800',
  PUBLISHED: 'border-green-200 bg-green-50 text-green-800',
};

export function PlanStatusBar({
  layout, approval, canEdit, canApprove, isDirty, currentUserId, busy, onSubmit, onDecide, onPreview3D,
}: {
  layout: WarehouseLayout;
  approval?: LayoutApproval | null;
  /** May draw on this plan (SYSTEM_ADMIN / WAREHOUSE_MANAGER). */
  canEdit: boolean;
  /** May decide it. The API refuses self-approval whatever this says. */
  canApprove: boolean;
  isDirty: boolean;
  currentUserId?: string;
  busy: boolean;
  onSubmit: () => void;
  onDecide: (approved: boolean, notes?: string) => void;
  onPreview3D?: () => void;
}) {
  const { m, t, fmt } = useT();
  const L = m.layout3d.floor.lifecycle;
  const [rejectOpen, setRejectOpen] = useState(false);
  const [notes, setNotes] = useState('');

  const status: LayoutStatus = layout.status ?? 'DRAFT';
  const when = (iso?: string | null) => (iso ? fmt.dateTime(new Date(iso)) : '—');
  const who = deciderName(approval);
  const ownSubmission = !!currentUserId && layout.submittedById === currentUserId;

  const label = status === 'PUBLISHED' ? L.published : status === 'PENDING' ? L.pending : L.draft;
  const Icon = status === 'PUBLISHED' ? CheckCircle2 : status === 'PENDING' ? Clock : FileEdit;
  const hint = status === 'PUBLISHED'
    ? (who ? t(L.publishedHintBy, { when: when(layout.publishedAt), who }) : t(L.publishedHint, { when: when(layout.publishedAt) }))
    : status === 'PENDING'
      ? `${L.pendingHint} · ${t(L.submittedAt, { when: when(layout.submittedAt) })}`
      : L.draftHint;

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2', TONE[status])}>
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
        <Icon className="h-4 w-4" /> {label}
      </span>
      {/* min-width, not min-w-0: in a wrapping row the hint must drop to its own
          line rather than squeeze into a one-word-per-line column. */}
      <p className="min-w-[16rem] flex-1 text-xs">
        {hint}
        {status === 'DRAFT' && layout.rejectedReason && (
          <span className="mt-0.5 block text-amber-800">{t(L.rejected, { reason: layout.rejectedReason })}</span>
        )}
      </p>

      <div className="flex items-center gap-2">
        {onPreview3D && (
          <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-white text-xs" onClick={onPreview3D} title={L.preview3dHint}>
            <Box className="h-3.5 w-3.5" /> {L.preview3d}
          </Button>
        )}
        {canEdit && status === 'DRAFT' && (
          <Button size="sm" className="h-8 gap-1.5 bg-green-600 text-xs text-white hover:bg-green-700"
            onClick={onSubmit} disabled={busy || isDirty}
            title={isDirty ? L.saveFirst : L.submit}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {busy ? L.submitting : L.submit}
          </Button>
        )}
        {canApprove && status === 'PENDING' && (
          <>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-white text-xs"
              onClick={() => { setNotes(''); setRejectOpen(true); }} disabled={busy}>
              <Undo2 className="h-3.5 w-3.5" /> {L.reject}
            </Button>
            <Button size="sm" className="h-8 gap-1.5 bg-green-600 text-xs text-white hover:bg-green-700"
              onClick={() => onDecide(true)} disabled={busy || ownSubmission}
              title={ownSubmission ? L.ownSubmission : L.approve}>
              <CheckCircle2 className="h-3.5 w-3.5" /> {L.approve}
            </Button>
          </>
        )}
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="w-full sm:max-w-md">
          <DialogHeader><DialogTitle>{L.rejectTitle}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-500">{L.rejectHint}</p>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={L.rejectPlaceholder} />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRejectOpen(false)}>{m.common.actions.cancel}</Button>
            <Button size="sm" className="bg-amber-600 text-white hover:bg-amber-700"
              onClick={() => { setRejectOpen(false); onDecide(false, notes.trim() || undefined); }} disabled={busy}>
              {L.reject}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
