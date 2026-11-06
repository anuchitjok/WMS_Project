'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { inventoryApi, scanApi } from '@/lib/api';
import type { StockItem } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { STOCK_STATUS_COLORS, formatDate } from '@/lib/utils';
import { Search, QrCode } from 'lucide-react';
import { RetiredNotice } from '@/components/layout/retired-notice';
import { refFromScan, refPagePath } from '@/lib/api-documents';
import { getT, labelOf, useT } from '@/i18n';

// Dynamically import scanner to avoid SSR issues (camera API is browser-only)
const BarcodeScanner = dynamic(
  () => import('@/components/barcode/barcode-scanner').then((m) => m.BarcodeScanner),
  { ssr: false, loading: () => <Skeleton className="h-64 rounded-xl" /> },
);

export default function ScannerPage() {
  const [result, setResult] = useState<StockItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const router = useRouter();
  const { m } = useT();
  const S = m.documents.scanner;

  const loadHistory = useCallback(async () => {
    try { setHistory(await scanApi.history({ workflow: 'LOOKUP', limit: 10 })); } catch { /* ignore */ }
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  async function lookup(code: string) {
    if (!code.trim()) return;
    // Request QR (picking slip / handover screen) opens the request page (plan P5 5.3).
    const ref = refFromScan(code);
    if (ref) {
      const { m: mm, t } = getT();
      toast.success(t(mm.documents.scanner.openingRequest, { ref }));
      router.push(refPagePath(ref));
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const item = await inventoryApi.barcode(code.trim());
      setResult(item);
      toast.success(getT().t(getT().m.documents.scanner.found, { name: item.product.name }));
    } catch {
      toast.error(getT().t(getT().m.documents.scanner.notFound, { code }));
    } finally {
      setLoading(false);
      // log the scan into the immutable ledger (fire-and-forget) + refresh history
      scanApi.scan({ workflow: 'LOOKUP', rawValue: code.trim() }).then(loadHistory).catch(() => {});
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <QrCode className="h-6 w-6 text-green-600" />
          {S.title}
        </h1>
        <p className="text-slate-500 text-sm mt-1">{S.subtitle}</p>
      </div>
      {/* Phase 2: the scanner's transfer / count / adjust workflows answer RETIRED; lookup is read-only and stays. */}
      <RetiredNotice feature={S.retiredFeature} scope={S.retiredScope} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{S.camera}</CardTitle>
        </CardHeader>
        <CardContent>
          <BarcodeScanner onScan={lookup} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{S.manual}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder={S.placeholder}
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && lookup(manualCode)}
            />
            <Button onClick={() => lookup(manualCode)} disabled={!manualCode.trim() || loading} aria-label={S.search}>
              <Search className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Result */}
      {loading && <Skeleton className="h-48 rounded-xl" />}
      {result && (
        <Card className="border-green-200 bg-green-50/50">
          <CardHeader>
            <CardTitle className="text-base text-green-900">{S.resultTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-slate-500 text-xs">{S.product}</p>
                <p className="font-semibold text-slate-900">{result.product.name}</p>
                <p className="text-xs text-slate-400">{result.product.code}</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">{S.status}</p>
                <Badge className={STOCK_STATUS_COLORS[result.status]} variant="outline">
                  {labelOf(m.status.stock as Record<string, string>, result.status)}
                </Badge>
              </div>
              <div>
                <p className="text-slate-500 text-xs">{S.serial}</p>
                <p className="font-mono text-sm">{result.serialNumber ?? result.batchNumber ?? '—'}</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">{S.location}</p>
                <p className="text-sm">{[result.warehouse?.name, result.rack?.code, result.slot?.code].filter(Boolean).join(' › ') || '—'}</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">{S.quantity}</p>
                <p className="font-semibold">{result.quantity} {result.product.unit}</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">{S.updated}</p>
                <p className="text-xs text-slate-600">{formatDate(result.updatedAt)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent scan history (immutable ledger) */}
      <Card>
        <CardHeader><CardTitle className="text-base">{S.recent}</CardTitle></CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-slate-400">{S.noScans}</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {history.map((h) => (
                <div key={h.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <span className="font-mono text-xs">{h.rawValue}</span>
                    <span className="text-xs text-slate-400 ml-2">{h.symbology} · {h.entityType ?? '—'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={h.result === 'SUCCESS' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}>{h.result}</Badge>
                    <span className="text-xs text-slate-400">{formatDate(h.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
