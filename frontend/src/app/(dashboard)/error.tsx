'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { m } = useT();
  const E = m.nav.errorBoundary;
  useEffect(() => {
    // Surface to console for debugging; in prod this would go to an error tracker
    console.error('Dashboard error boundary:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-6 text-center">
      <div className="rounded-full bg-red-100 p-4">
        <AlertTriangle className="h-8 w-8 text-red-600" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-slate-900">{E.title}</h2>
        <p className="text-slate-500 text-sm mt-1 max-w-md">
          {error.message || E.fallback}
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={reset} className="bg-green-600 hover:bg-green-700 text-white">{m.common.actions.retry}</Button>
        <Button variant="outline" onClick={() => (window.location.href = '/dashboard')}>{E.goDashboard}</Button>
      </div>
    </div>
  );
}
