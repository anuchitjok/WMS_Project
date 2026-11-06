import { ModuleGate } from '@/components/layout/module-gate';

// P7 7.1: Material Planning (MRP) is hidden unless switched on in System Settings → Modules.
export default function MrpLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGate module="mrp">{children}</ModuleGate>;
}
