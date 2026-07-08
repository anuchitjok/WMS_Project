'use client';

import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { doaApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { STOCK_STATUS_COLORS } from '@/lib/utils';
import type { StockStatus } from '@/types';

export default function DoaPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await doaApi.list()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function createRtv(id: string) {
    try { await doaApi.createRtv(id); toast.success('RTV case created'); load(); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="DOA / Defective Management" subtitle="DOA recording, quarantine and RTV trigger" icon={AlertTriangle} />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">Stock Item</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Product / Serial</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Reason</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Location</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Action</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No DOA / defective items</td></tr>
              : rows.map((i) => (
                <tr key={i.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{i.id.slice(-8)}</td>
                  <td className="px-4 py-3"><span className="font-medium text-slate-800">{i.product?.name}</span><br /><span className="text-xs text-slate-400">{i.serialNumber ?? i.product?.code}</span></td>
                  <td className="px-4 py-3 text-sm text-slate-600 max-w-xs truncate" title={i.notes ?? ''}>{i.notes ?? '—'}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className={STOCK_STATUS_COLORS[i.status as StockStatus]}>{i.status.replace(/_/g, ' ')}</Badge></td>
                  <td className="px-4 py-3 text-xs text-slate-600">{i.warehouse?.name ?? '—'}</td>
                  <td className="px-4 py-3">{i.status !== 'RTV_PENDING' && <Button size="sm" className="h-7 bg-red-600 hover:bg-red-700 text-white" onClick={() => createRtv(i.id)}>Create RTV</Button>}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
