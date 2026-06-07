'use client';

import { useEffect, useState, useCallback } from 'react';
import { MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { putawayApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export default function PutawayPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await putawayApi.pending()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function confirm(item: any) {
    try {
      await putawayApi.confirm(item.id, { warehouseId: item.warehouseId, rackId: item.rackId, slotId: item.slotId });
      toast.success('Putaway confirmed — stock is now Available');
      load();
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Putaway Management" subtitle="Assign location and confirm storage" icon={MapPin} />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">Stock Item</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Product</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Qty</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Suggested Location</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Action</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No items awaiting putaway</td></tr>
              : rows.map((i) => (
                <tr key={i.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{i.id.slice(-8)}</td>
                  <td className="px-4 py-3"><span className="font-medium text-slate-800">{i.product?.name}</span><br /><span className="text-xs text-slate-400">{i.product?.code}</span></td>
                  <td className="px-4 py-3 font-medium">{i.quantity}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{[i.warehouse?.code, i.rack?.code, i.slot?.code].filter(Boolean).join(' › ') || '—'}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className="bg-amber-100 text-amber-700">Pending Putaway</Badge></td>
                  <td className="px-4 py-3"><Button size="sm" className="h-7 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => confirm(i)}>Confirm</Button></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
