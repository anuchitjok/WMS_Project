'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
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
        <h2 className="text-xl font-bold text-slate-900">Unable to load this page</h2>
        <p className="text-slate-500 text-sm mt-1 max-w-md">
          {error.message || 'An unexpected error occurred while loading data.'}
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={reset} className="bg-green-600 hover:bg-green-700 text-white">Try again</Button>
        <Button variant="outline" onClick={() => (window.location.href = '/dashboard')}>Go to Dashboard</Button>
      </div>
    </div>
  );
}
