'use client';

// Legacy /unused route — redirects to Warehouse Returns (inbound verification).
// Kept for backward compatibility with bookmarks and navigation links.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function UnusedLegacyRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/warehouse/returns'); }, [router]);

  return (
    <div className="flex items-center justify-center h-full gap-3 text-slate-500">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span className="text-sm">Redirecting to Warehouse Returns…</span>
    </div>
  );
}
