'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useT } from '@/i18n';

// Shown when a user tries to close a form with unsaved changes (outside click, Escape,
// X button, or Cancel). Dismissing this dialog any way other than "Discard" is treated
// as "keep editing" — data is never lost by accident, only by an explicit choice.
export function DiscardChangesDialog({
  open,
  onKeepEditing,
  onDiscard,
}: {
  open: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  const D = useT().m.common.discard;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onKeepEditing(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="w-4 h-4" /> {D.title}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-600">{D.body}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onKeepEditing}>{D.keep}</Button>
          <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={onDiscard}>{D.discard}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
