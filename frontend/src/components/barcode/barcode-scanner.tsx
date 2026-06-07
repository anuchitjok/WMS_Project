'use client';

import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, CameraOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface BarcodeScannerProps {
  onScan: (code: string) => void;
  className?: string;
}

export function BarcodeScanner({ onScan, className }: BarcodeScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const elementId = 'barcode-scanner-container';

  async function startScanner() {
    setError(null);
    try {
      const scanner = new Html5Qrcode(elementId);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 150 } },
        (code) => { onScan(code); },
        undefined,
      );
      setActive(true);
    } catch (err) {
      setError('Camera access denied or not available');
      console.error(err);
    }
  }

  async function stopScanner() {
    try {
      await scannerRef.current?.stop();
      scannerRef.current = null;
    } catch {
      // ignore
    }
    setActive(false);
  }

  useEffect(() => {
    return () => { stopScanner(); };
  }, []);

  return (
    <div className={cn('space-y-3', className)}>
      <div
        id={elementId}
        className={cn(
          'w-full rounded-xl overflow-hidden border-2 transition-all',
          active ? 'border-blue-500 min-h-64' : 'border-dashed border-slate-300 min-h-48 flex items-center justify-center',
        )}
      >
        {!active && (
          <div className="flex flex-col items-center gap-3 text-slate-400 p-8">
            <Camera className="h-10 w-10 opacity-40" />
            <p className="text-sm">Camera preview will appear here</p>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}

      <Button
        onClick={active ? stopScanner : startScanner}
        className={cn('w-full', active ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700')}
      >
        {active ? (
          <><CameraOff className="h-4 w-4 mr-2" />Stop Scanner</>
        ) : (
          <><Camera className="h-4 w-4 mr-2" />Start Scanner</>
        )}
      </Button>
    </div>
  );
}
