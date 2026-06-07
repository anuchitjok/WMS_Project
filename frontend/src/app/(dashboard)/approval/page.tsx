'use client';

// Legacy /approval route — redirects to the global Approval Workspace.
// Kept for backward compatibility with bookmarks and navigation links.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function ApprovalLegacyRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/approvals'); }, [router]);

  return (
    <div className="flex items-center justify-center h-full gap-3 text-slate-500">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span className="text-sm">Redirecting to Approval Workspace…</span>
    </div>
  );
}
