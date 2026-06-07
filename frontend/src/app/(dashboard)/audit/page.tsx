'use client';

import { useEffect, useState, useCallback } from 'react';
import { auditApi } from '@/lib/api';
import type { AuditLog } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/utils';
import { ScrollText } from 'lucide-react';

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await auditApi.list({ limit: 50 });
      setLogs(res);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <ScrollText className="h-6 w-6 text-slate-600" />
        <h1 className="text-2xl font-bold text-slate-900">Audit Logs</h1>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="text-left px-4 py-3 font-medium text-slate-600">Action</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">User</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Entity</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Detail</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i}>{[...Array(5)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>
              ))
            ) : logs.map((log) => (
              <tr key={log.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800 font-mono text-xs">{log.action}</td>
                <td className="px-4 py-3 text-slate-600">{log.user?.fullName ?? 'System'}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{log.entityType ?? '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate">{log.detail ?? '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{formatDate(log.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
