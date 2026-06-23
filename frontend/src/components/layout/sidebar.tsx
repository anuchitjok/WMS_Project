'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Package, ClipboardList, RotateCcw, Users, ScrollText,
  QrCode, LogOut, Warehouse, ChevronRight, PackagePlus, MapPin, Truck,
  CheckCircle2, RefreshCw, AlertTriangle, Calculator, ArrowLeftRight,
  Tag, Settings, BarChart3, ShieldCheck, Database, Bell, Calculator as CountIcon, Trash2,
  PackageCheck, Undo2, Building2, Handshake,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import type { UserRole } from '@/types';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: UserRole[];
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const ADMIN: UserRole[] = ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER'];
const WH: UserRole[] = ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR', 'WAREHOUSE_STAFF'];

const NAV_GROUPS: NavGroup[] = [
  {
    group: 'Overview',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/reports', label: 'Reports', icon: BarChart3 },
    ],
  },
  {
    // CR-MASTER-001: Master Data group — only items backed by a real page/route are listed here.
    group: 'Master Data',
    items: [
      { href: '/products', label: 'Product Master', icon: Tag, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR'] },
      { href: '/business-partners', label: 'Business Partners', icon: Handshake, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR'] },
      { href: '/warehouse-master', label: 'Warehouse Master', icon: Building2, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR', 'WAREHOUSE_STAFF'] },
      { href: '/users', label: 'Users', icon: Users, roles: ADMIN },
      { href: '/roles', label: 'Roles & Permissions', icon: ShieldCheck, roles: ['SYSTEM_ADMIN'] },
      { href: '/settings', label: 'System Settings', icon: Settings, roles: ['SYSTEM_ADMIN'] },
    ],
  },
  {
    group: 'Warehouse',
    items: [
      { href: '/warehouse-layout', label: 'Warehouse Layout', icon: Warehouse, roles: WH },
      { href: '/receiving', label: 'Goods Receiving', icon: PackagePlus, roles: WH },
      { href: '/putaway', label: 'Putaway', icon: MapPin, roles: WH },
      { href: '/inventory', label: 'Inventory', icon: Package },
      { href: '/outbound/fulfillment', label: 'Fulfillment Board', icon: Truck, roles: WH },
      { href: '/handover', label: 'Handover', icon: CheckCircle2, roles: WH },
      { href: '/warehouse/returns', label: 'Returns — Inbound', icon: RefreshCw, roles: WH },
      { href: '/transfer', label: 'Stock Transfer', icon: ArrowLeftRight, roles: WH },
      { href: '/adjustment', label: 'Stock Adjustment', icon: Calculator, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR'] },
      { href: '/scanner', label: 'Barcode Scanner', icon: QrCode },
      { href: '/cycle-count', label: 'Cycle Count', icon: CountIcon, roles: WH },
    ],
  },
  {
    group: 'Requester',
    items: [
      { href: '/requests', label: 'Withdrawal Requests', icon: ClipboardList },
      { href: '/issued-items', label: 'My Issued Items', icon: PackageCheck },
      { href: '/returns', label: 'Pending Returns', icon: Undo2 },
    ],
  },
  {
    group: 'Approvals',
    items: [
      { href: '/approvals', label: 'Approval Workspace', icon: ShieldCheck, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR', 'DEPT_APPROVER'] },
    ],
  },
  {
    group: 'RTV Management',
    items: [
      { href: '/doa', label: 'DOA / Defective', icon: AlertTriangle, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'RTV_OFFICER', 'RMA_TEAM'] },
      { href: '/rtv', label: 'RTV Cases', icon: RotateCcw, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'RTV_OFFICER'] },
      { href: '/scrap', label: 'Scrap Management', icon: Trash2, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'RTV_OFFICER', 'WAREHOUSE_SUPERVISOR'] },
    ],
  },
  {
    group: 'Admin',
    items: [
      { href: '/data-io', label: 'Import / Export', icon: Database, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR'] },
      { href: '/notifications', label: 'Notifications', icon: Bell },
      { href: '/audit', label: 'Audit Trail', icon: ScrollText, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'AUDITOR'] },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();

  function handleLogout() {
    clearAuth();
    router.push('/login');
  }

  function canSee(item: NavItem) {
    return !item.roles || (user && item.roles.includes(user.role));
  }

  return (
    <aside className="flex flex-col h-full w-64 bg-white text-slate-700 border-r border-slate-200">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-200">
        <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-green-600 shadow-sm">
          <Warehouse className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-base font-bold tracking-tight leading-tight text-slate-900">HSNT WMS</p>
          <p className="text-xs text-slate-400">Warehouse System</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
        {NAV_GROUPS.map((g) => {
          const items = g.items.filter(canSee);
          if (items.length === 0) return null;
          return (
            <div key={g.group}>
              <p className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">{g.group}</p>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors group',
                        active
                          ? 'bg-green-50 text-green-700 font-semibold'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                      )}
                    >
                      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-green-600" />}
                      <item.icon className={cn('h-4 w-4 flex-shrink-0', active ? 'text-green-600' : 'text-slate-400 group-hover:text-slate-600')} />
                      <span className="flex-1">{item.label}</span>
                      {active && <ChevronRight className="h-3 w-3 text-green-500" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* User section */}
      <div className="border-t border-slate-200 p-4">
        <div className="flex items-center gap-3 mb-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-green-600 text-white text-xs font-bold">
              {user?.fullName?.slice(0, 2).toUpperCase() ?? 'WM'}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate text-slate-900">{user?.fullName}</p>
            <p className="text-xs text-slate-400 truncate">{user?.role?.replace(/_/g, ' ')}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-slate-500 hover:text-red-600 hover:bg-red-50"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}
