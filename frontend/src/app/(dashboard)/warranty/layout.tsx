import { ModuleGate } from '@/components/layout/module-gate';

// P7 7.1: Warranty is hidden unless switched on in System Settings → Modules.
export default function WarrantyLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGate module="warranty">{children}</ModuleGate>;
}
