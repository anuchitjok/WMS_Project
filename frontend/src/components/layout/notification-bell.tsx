'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Bell, CheckCheck, X } from 'lucide-react';
import { notifApi } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn, formatDate } from '@/lib/utils';
import Link from 'next/link';

const TYPE_ICONS: Record<string, string> = {
  REQUEST_SUBMITTED: '📋', REQUEST_APPROVED: '✅', REQUEST_REJECTED: '❌',
  PICKING_TASK: '📦', READY_FOR_PICKUP: '🚚', USAGE_REQUIRED: '🔔',
  DOA_DECLARED: '⚠️', RTV_OVERDUE: '⏱', UNUSED_RETURN: '🔁',
  LOW_STOCK: '↓', SLA_OVERDUE: '⏰', GENERAL: '💬',
};

// Gap between bell and the panel edge
const GAP = 8;
// Panel never gets wider than this
const MAX_WIDTH = 320;
// Minimum clearance from any viewport edge
const EDGE_CLEARANCE = 8;

interface PanelPos {
  top: number;
  left: number;
  width: number;
  /** true = panel opens upward (above the bell) */
  openUp: boolean;
  /** estimated max height the panel can use */
  maxHeight: number;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<PanelPos>({ top: 0, left: 0, width: MAX_WIDTH, openUp: false, maxHeight: 400 });

  const bellRef = useRef<HTMLButtonElement>(null);
  const dropRef  = useRef<HTMLDivElement>(null);

  // Portal requires document — only render after hydration
  useEffect(() => { setMounted(true); }, []);

  // ── Data ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try { setData(await notifApi.list(1, 10)); } catch { /* silent */ }
  }, []);
  useEffect(() => { load(); const iv = setInterval(load, 60_000); return () => clearInterval(iv); }, [load]);

  // ── Positioning ───────────────────────────────────────────────────────────
  // Called every time the panel opens or the viewport changes.
  // Strategy:
  //   Horizontal – try to open to the RIGHT of the bell (correct for a left
  //     sidebar bell); fall back to LEFT of the bell if it would clip; finally
  //     clamp to the safe viewport area.
  //   Vertical   – try to open BELOW the bell; if not enough room, flip UP.
  //     Cap maxHeight so the panel never leaves the viewport.
  const measure = useCallback(() => {
    if (!bellRef.current) return;
    const rect = bellRef.current.getBoundingClientRect();
    const vw   = window.innerWidth;
    const vh   = window.innerHeight;

    // ── Width ──────────────────────────────────────────────────────────────
    const width = Math.min(MAX_WIDTH, vw - EDGE_CLEARANCE * 2);

    // ── Horizontal ─────────────────────────────────────────────────────────
    // First choice: open to the right of the bell's right edge
    let left = rect.right + GAP;
    if (left + width > vw - EDGE_CLEARANCE) {
      // Doesn't fit to the right → try to the left of the bell's left edge
      left = rect.left - GAP - width;
    }
    // Clamp into safe zone
    left = Math.max(EDGE_CLEARANCE, Math.min(left, vw - width - EDGE_CLEARANCE));

    // ── Vertical ───────────────────────────────────────────────────────────
    // Space available below and above the bell
    const spaceBelow = vh - rect.bottom - GAP - EDGE_CLEARANCE;
    const spaceAbove = rect.top  - GAP - EDGE_CLEARANCE;

    // We want at least 200px of panel height; prefer below
    const openUp   = spaceBelow < 200 && spaceAbove > spaceBelow;
    const maxHeight = openUp
      ? Math.max(120, spaceAbove)
      : Math.max(120, spaceBelow);

    const top = openUp
      ? rect.top  - GAP - Math.min(maxHeight, vh * 0.8) // panel ABOVE bell
      : rect.bottom + GAP;                               // panel BELOW bell

    setPos({ top, left, width, openUp, maxHeight: Math.min(maxHeight, vh * 0.8) });
  }, []);

  useEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true, capture: true });
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, measure]);

  // ── Outside click / Escape ────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onMouse = (e: MouseEvent) => {
      const t = e.target as Node;
      if (bellRef.current?.contains(t) || dropRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); bellRef.current?.focus(); }
    };
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown',   onKey);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown',   onKey);
    };
  }, [open]);

  const unread = data?.unread ?? 0;

  const readAll = async () => { await notifApi.markAllRead(); load(); };
  const readOne = async (id: string) => { await notifApi.markRead(id); load(); };

  // ── Portal panel ──────────────────────────────────────────────────────────
  const panel = open && mounted ? createPortal(
    <>
      {/* Full-screen backdrop (transparent) – catches clicks outside the panel */}
      <div
        className="fixed inset-0 z-[9998]"
        aria-hidden="true"
        onClick={() => setOpen(false)}
      />

      <div
        ref={dropRef}
        role="dialog"
        aria-label="Notifications"
        aria-modal="false"
        style={{
          position : 'fixed',
          zIndex   : 9999,
          top      : pos.top,
          left     : pos.left,
          width    : pos.width,
          maxHeight: pos.maxHeight,
        }}
        className={cn(
          // Layout
          'flex flex-col',
          // Appearance
          'bg-white rounded-xl border border-slate-200 shadow-2xl',
          // Overflow containment – NO overflow on the outer shell
          'overflow-hidden',
        )}
      >
        {/* ── Sticky header (never scrolls) ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50 flex-shrink-0 min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
            <h3 className="font-semibold text-slate-800 text-sm truncate">Notifications</h3>
            {unread > 0 && (
              <Badge className="bg-red-100 text-red-700 flex-shrink-0 tabular-nums" variant="outline">
                {unread}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
            {unread > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs whitespace-nowrap"
                onClick={readAll}
              >
                <CheckCheck className="h-3.5 w-3.5 mr-1" />
                All read
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 flex-shrink-0"
              aria-label="Close notifications"
              onClick={() => setOpen(false)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* ── Scrollable list (only this section scrolls) ── */}
        <div className="overflow-y-auto overflow-x-hidden overscroll-contain flex-1">
          {!data?.data?.length ? (
            <p className="text-center text-slate-400 text-sm py-10 px-4">No notifications</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {data.data.map((n: any) => (
                <div
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${n.isRead ? '' : 'Unread — '}${n.title}`}
                  onClick={() => readOne(n.id)}
                  onKeyDown={(e) => e.key === 'Enter' && readOne(n.id)}
                  className={cn(
                    'px-4 py-3 cursor-pointer transition-colors',
                    'hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-100',
                    !n.isRead && 'bg-blue-50/50 border-l-2 border-blue-500',
                  )}
                >
                  {/* Two-column: icon | text + unread dot */}
                  <div className="flex items-start gap-2 min-w-0 w-full">
                    {/* Icon – fixed width, never shrinks */}
                    <span
                      className="text-base flex-shrink-0 mt-0.5 select-none leading-none w-5 text-center"
                      aria-hidden="true"
                    >
                      {TYPE_ICONS[n.type] ?? '💬'}
                    </span>

                    {/* Text block – claims all remaining space and clips safely */}
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <p className={cn(
                        'text-sm leading-tight',
                        // Clamp to 2 lines so very long titles don't blow height
                        'line-clamp-2 break-words',
                        !n.isRead ? 'font-semibold text-slate-800' : 'text-slate-600',
                      )}>
                        {n.title}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2 break-words">
                        {n.message}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-1 tabular-nums">
                        {formatDate(n.createdAt)}
                      </p>
                    </div>

                    {/* Unread indicator – fixed size, never grows */}
                    {!n.isRead && (
                      <div
                        className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5"
                        aria-label="Unread"
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Sticky footer ── */}
        <div className="border-t border-slate-100 p-2 flex-shrink-0">
          <Link href="/notifications" onClick={() => setOpen(false)}>
            <Button
              variant="ghost"
              className="w-full text-xs text-slate-500 hover:text-blue-600 h-8"
            >
              View all notifications
            </Button>
          </Link>
        </div>
      </div>
    </>,
    document.body,
  ) : null;

  // ── Bell button ───────────────────────────────────────────────────────────
  return (
    <>
      <button
        ref={bellRef}
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          'relative p-2 rounded-lg transition-colors focus:outline-none',
          'hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-blue-400',
          open && 'bg-slate-700',
        )}
      >
        <Bell className="h-5 w-5 text-slate-300" />
        {unread > 0 && (
          <span
            className="absolute top-1 right-1 h-4 min-w-4 rounded-full bg-red-500 text-[10px] text-white flex items-center justify-center font-bold px-0.5 tabular-nums"
            aria-hidden="true"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {panel}
    </>
  );
}
