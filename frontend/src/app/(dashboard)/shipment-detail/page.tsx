'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Truck, CheckCircle2, Circle, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { fulfillmentApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/utils';

const STATUS_ICONS: Record<string, React.ReactNode> = {
  ALLOCATED: <Circle className="h-4 w-4 text-slate-400" />,
  PICKING: <Clock className="h-4 w-4 text-yellow-500" />,
  PICKED: <CheckCircle2 className="h-4 w-4 text-yellow-600" />,
  PACKING: <Clock className="h-4 w-4 text-orange-500" />,
  PACKED: <CheckCircle2 className="h-4 w-4 text-orange-600" />,
  READY_TO_SHIP: <Clock className="h-4 w-4 text-purple-500" />,
  SHIPPED: <Truck className="h-4 w-4 text-green-600" />,
  DELIVERED: <CheckCircle2 className="h-4 w-4 text-green-600" />,
  CLOSED: <CheckCircle2 className="h-4 w-4 text-slate-500" />,
};

function ShipmentDetailInner() {
  const params = useSearchParams();
  const taskId = params.get('taskId');
  const [task, setTask] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    try { setTask(await fulfillmentApi.get(taskId)); } finally { setLoading(false); }
  }, [taskId]);
  useEffect(() => { load(); }, [load]);

  async function markDelivered() {
    if (!task?.shipment?.id) return;
    try {
      await fulfillmentApi.confirmDelivery(task.shipment.id, {
        receiverName: task.requester?.fullName ?? 'Receiver',
      });
      toast.success('Delivered!');
      load();
    } catch (e: any) { toast.error(e.message); }
  }

  if (loading) return <div className="p-6"><Skeleton className="h-96 rounded-xl" /></div>;
  if (!task) return <div className="p-6 text-slate-400">Task not found</div>;

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader title={`Fulfillment: ${task.refNumber}`} subtitle={`Request: ${task.requestRef} · Status: ${task.status}`} icon={Truck}
        action={task.status === 'SHIPPED' ? <Button onClick={markDelivered} className="bg-green-600 hover:bg-green-700 text-white">Mark Delivered</Button> : undefined}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 mb-1">Progress</p>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold text-slate-900">{task.progressPct}%</span>
            {task.partialPick && <Badge variant="outline" className="bg-amber-100 text-amber-700 text-xs mb-1">Partial</Badge>}
          </div>
          <div className="h-2 bg-slate-100 rounded-full mt-2 overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${task.progressPct}%` }} />
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 mb-1">Packing</p>
          {task.packing ? (
            <div>
              <p className="font-semibold">{task.packing.cartonCount} cartons</p>
              <p className="text-xs text-slate-400">{task.packing.totalWeight ? `${task.packing.totalWeight} kg` : 'No weight'}</p>
            </div>
          ) : <p className="text-slate-400 text-sm">Not packed yet</p>}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 mb-1">Shipment</p>
          {task.shipment ? (
            <div>
              <p className="font-semibold text-sm">{task.shipment.carrier || 'No carrier'}</p>
              <p className="font-mono text-xs text-green-600">{task.shipment.trackingNumber || '—'}</p>
            </div>
          ) : <p className="text-slate-400 text-sm">No shipment yet</p>}
        </div>
      </div>

      {/* Items */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100"><h3 className="font-semibold text-slate-800">Items ({task.items?.length})</h3></div>
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-50 border-b border-slate-100">
            <th className="text-left px-4 py-2 font-medium text-slate-600">Product</th>
            <th className="text-left px-4 py-2 font-medium text-slate-600">Location</th>
            <th className="text-left px-4 py-2 font-medium text-slate-600">Req</th>
            <th className="text-left px-4 py-2 font-medium text-slate-600">Picked</th>
            <th className="text-left px-4 py-2 font-medium text-slate-600">Status</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {task.items?.map((it: any) => (
              <tr key={it.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-800">{it.product?.name}</p>
                  <p className="text-xs text-slate-400">{it.product?.code}</p>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{it.binLocation || '—'}</td>
                <td className="px-4 py-3 font-semibold">{it.qtyRequested}</td>
                <td className="px-4 py-3 font-semibold">{it.qtyPicked}</td>
                <td className="px-4 py-3">
                  {it.isShortPick ? <Badge variant="outline" className="bg-red-100 text-red-700 text-xs">Short Pick</Badge>
                    : it.pickedAt ? <Badge variant="outline" className="bg-green-100 text-green-700 text-xs">Picked</Badge>
                    : <Badge variant="outline" className="bg-slate-100 text-slate-600 text-xs">Pending</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <h3 className="font-semibold text-slate-800 mb-4">Status Timeline</h3>
        <div className="space-y-3">
          {task.timeline?.map((tl: any, i: number) => (
            <div key={tl.id} className="flex gap-3 items-start">
              <div className="flex-shrink-0 mt-0.5">{STATUS_ICONS[tl.toStatus] ?? <Circle className="h-4 w-4 text-slate-400" />}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-slate-800 text-sm">{tl.toStatus?.replace(/_/g, ' ')}</span>
                  {tl.fromStatus && <span className="text-xs text-slate-400">← {tl.fromStatus.replace(/_/g, ' ')}</span>}
                </div>
                <p className="text-xs text-slate-500">{tl.description}</p>
                <p className="text-xs text-slate-400">{formatDate(tl.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Shipment timeline */}
      {task.shipment?.timeline?.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <h3 className="font-semibold text-slate-800 mb-4">Shipment Timeline — {task.shipment.refNumber}</h3>
          <div className="space-y-3">
            {task.shipment.timeline.map((tl: any) => (
              <div key={tl.id} className="flex gap-3 items-start">
                <Truck className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-800 text-sm">{tl.status}</p>
                  <p className="text-xs text-slate-500">{tl.description}</p>
                  <p className="text-xs text-slate-400">{formatDate(tl.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ShipmentDetailPage() {
  return <Suspense fallback={<div className="p-6"><Skeleton className="h-96 rounded-xl" /></div>}><ShipmentDetailInner /></Suspense>;
}
