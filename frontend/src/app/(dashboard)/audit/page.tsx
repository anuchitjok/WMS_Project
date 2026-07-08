'use client';

import { useEffect, useState, useCallback } from 'react';
import { ScrollText, Search, RefreshCw, X } from 'lucide-react';
import { auditApi } from '@/lib/api';
import type { AuditLog } from '@/types';
import { PageHeader } from '@/components/layout/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDate } from '@/lib/utils';

// Abbreviations that should stay upper-case inside a humanised label.
const KEEP_UPPER = new Set(['RTV', 'RMA', 'DOA', 'SKU', 'SLA', 'PO', 'GRN', 'ID']);

// Turn a raw action enum like "RTV_STATUS_CHANGED" into "RTV status changed".
function humanAction(action: string) {
  return action
    .split('_')
    .map((w, i) => {
      if (KEEP_UPPER.has(w)) return w;
      const lower = w.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

// A calm accent for the action word — red only for clearly destructive actions.
function actionTone(action: string) {
  if (/REJECT|CANCEL|DELETE|DEACTIVAT|SCRAP|DOA|FAIL/.test(action)) return 'text-red-600';
  return 'text-slate-800';
}

const PAGE_SIZE = 50;

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [actions, setActions] = useState<string[]>([]);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);

  // Filters — `applied` is what the query actually uses; `draft` is the input state.
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await auditApi.list({ q, action, entityType, from, to, page, limit: PAGE_SIZE });
      setLogs(res.data);
      setTotalPages(res.totalPages);
      setTotal(res.total);
      setActions(res.filters.actions);
      setEntityTypes(res.filters.entityTypes);
    } finally {
      setLoading(false);
    }
  }, [q, action, entityType, from, to, page]);

  useEffect(() => { load(); }, [load]);

  const hasFilters = q || action || entityType || from || to;
  function clearFilters() {
    setQ(''); setAction(''); setEntityType(''); setFrom(''); setTo(''); setPage(1);
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Audit Trail" subtitle="Every recorded action — who did what, and when" icon={ScrollText} />

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="space-y-1 flex-1 min-w-[200px]">
          <label className="text-xs text-slate-500">Search</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} placeholder="Reference, detail, action…" className="pl-8" />
          </div>
        </div>
        <div className="space-y-1 min-w-[170px]">
          <label className="text-xs text-slate-500">Action</label>
          <select value={action} onChange={(e) => { setPage(1); setAction(e.target.value); }}
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 focus:border-green-500 focus:outline-none">
            <option value="">All actions</option>
            {actions.map((a) => <option key={a} value={a}>{humanAction(a)}</option>)}
          </select>
        </div>
        <div className="space-y-1 min-w-[150px]">
          <label className="text-xs text-slate-500">Entity</label>
          <select value={entityType} onChange={(e) => { setPage(1); setEntityType(e.target.value); }}
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 focus:border-green-500 focus:outline-none">
            <option value="">All entities</option>
            {entityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-500">From</label>
          <Input type="date" value={from} onChange={(e) => { setPage(1); setFrom(e.target.value); }} className="w-[150px]" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-500">To</label>
          <Input type="date" value={to} onChange={(e) => { setPage(1); setTo(e.target.value); }} className="w-[150px]" />
        </div>
        <Button variant="outline" onClick={() => load()} disabled={loading} className="gap-1.5">
          <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> Refresh
        </Button>
        {hasFilters && (
          <Button variant="ghost" onClick={clearFilters} className="gap-1.5 text-slate-500">
            <X className="h-4 w-4" /> Clear
          </Button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <span className="text-sm text-slate-500">{loading ? 'Loading…' : `${total} record${total === 1 ? '' : 's'}`}</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left px-4 py-3 text-xs uppercase tracking-wide font-medium text-slate-500">Action</th>
              <th className="text-left px-4 py-3 text-xs uppercase tracking-wide font-medium text-slate-500">User</th>
              <th className="text-left px-4 py-3 text-xs uppercase tracking-wide font-medium text-slate-500">Entity</th>
              <th className="text-left px-4 py-3 text-xs uppercase tracking-wide font-medium text-slate-500">Detail</th>
              <th className="text-left px-4 py-3 text-xs uppercase tracking-wide font-medium text-slate-500">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i}>{[...Array(5)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>
              ))
            ) : logs.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">No audit records match these filters</td></tr>
            ) : logs.map((log) => (
              <tr key={log.id} className="hover:bg-slate-50">
                <td className={`px-4 py-3 font-medium ${actionTone(log.action)}`}>{humanAction(log.action)}</td>
                <td className="px-4 py-3 text-slate-600">{log.user?.fullName ?? 'System'}</td>
                <td className="px-4 py-3 text-sm text-slate-500">{log.entityType ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-slate-600 max-w-md truncate" title={log.detail ?? ''}>{log.detail ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-slate-500 whitespace-nowrap">{formatDate(log.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <span className="text-sm text-slate-500">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
