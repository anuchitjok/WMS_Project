'use client';

// Phase 2: the Inventory page is retired. Balances and the read-only Stock Detail
// live in Reports → Balance; old links (including ?id=<stock>) land there.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function InventoryRetiredRedirect() {
  const router = useRouter();
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    router.replace(`/reports?tab=balance${id ? `&stock=${encodeURIComponent(id)}` : ''}`);
  }, [router]);

  return (
    <div className="flex items-center justify-center h-full gap-3 text-slate-500">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span className="text-sm">Inventory moved to Reports → Balance. Redirecting…</span>
    </div>
  );
}
