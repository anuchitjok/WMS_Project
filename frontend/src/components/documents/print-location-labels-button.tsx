'use client';

// Location label printing (plan P5 5.4): per slot, per rack or per warehouse.
import { useState } from 'react';
import { Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { printLocationLabels, type LocationLabelTarget } from '@/lib/api-documents';
import { getT, useT } from '@/i18n';

export function PrintLocationLabelsButton({
  target, label, fileName, size = 'sm', variant = 'outline', className,
}: {
  target: LocationLabelTarget;
  /** Defaults by target: slot → "Print label", rack → "Print rack labels", warehouse → "Print location labels". */
  label?: string;
  fileName?: string;
  size?: 'xs' | 'sm' | 'default';
  variant?: 'outline' | 'ghost' | 'default';
  className?: string;
}) {
  const { m } = useT();
  const L = m.documents.labels;
  const [busy, setBusy] = useState(false);
  const text = label
    ?? (target.warehouseIds?.length ? L.printWarehouse : target.rackIds?.length ? L.printRack : L.printSlot);

  async function run() {
    setBusy(true);
    try {
      await printLocationLabels(target, fileName);
      toast.success(getT().m.documents.labels.done);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" variant={variant} size={size} className={className} onClick={run} disabled={busy} aria-busy={busy}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
      {busy ? L.printing : text}
    </Button>
  );
}
