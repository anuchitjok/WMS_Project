'use client';

// V1 Fulfillment page — redirects to the unified fulfillment board.
// This page is kept for backward compatibility with bookmarks and navigation links.
// The unified board is at /outbound/fulfillment.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function FulfillmentLegacyRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/outbound/fulfillment');
  }, [router]);

  return (
    <div className="flex items-center justify-center h-full gap-3 text-slate-500">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span className="text-sm">Redirecting to Fulfillment Board…</span>
    </div>
  );
}
