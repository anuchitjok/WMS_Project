'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Package, ClipboardList, RotateCcw, Users, ScrollText,
  QrCode, LogOut, Warehouse, ChevronRight, PackagePlus, MapPin, Truck,
  CheckCircle2, RefreshCw, AlertTriangle, Calculator, ArrowLeftRight,
  Tag, Settings, BarChart3, ShieldCheck, Database, Bell, Calculator as CountIcon, Trash2,
  PackageCheck, Undo2,
} from 'lucide-react';
import { NotificationBell } from './notification-bell';
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
      { href: '/products', label: 'Product Master', icon: Tag, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR'] },
      { href: '/data-io', label: 'Import / Export', icon: Database, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR'] },
      { href: '/users', label: 'Users', icon: Users, roles: ADMIN },
      { href: '/roles', label: 'Roles & Permissions', icon: ShieldCheck, roles: ['SYSTEM_ADMIN'] },
      { href: '/settings', label: 'System Settings', icon: Settings, roles: ['SYSTEM_ADMIN'] },
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
    <aside className="flex flex-col h-full w-64 bg-slate-900 text-slate-100 border-r border-slate-700">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-700">
        <Warehouse className="h-7 w-7 text-blue-400 flex-shrink-0" />
        <div>
          <p className="text-base font-bold tracking-tight leading-tight">HSNT WMS</p>
          <p className="text-xs text-slate-400">Warehouse System</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-4">
        {NAV_GROUPS.map((g) => {
          const items = g.items.filter(canSee);
          if (items.length === 0) return null;
          return (
            <div key={g.group}>
              <p className="px-3 mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{g.group}</p>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all group',
                        active ? 'bg-blue-600 text-white shadow' : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                      )}
                    >
                      <item.icon className={cn('h-4 w-4 flex-shrink-0', active ? 'text-white' : 'text-slate-400 group-hover:text-white')} />
                      <span className="flex-1">{item.label}</span>
                      {active && <ChevronRight className="h-3 w-3 opacity-60" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* User section */}
      <div className="border-t border-slate-700 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">Notifications</span>
          <NotificationBell />
        </div>
        <div className="flex items-center gap-3 mb-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-blue-600 text-white text-xs font-bold">
              {user?.fullName?.slice(0, 2).toUpperCase() ?? 'WM'}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.fullName}</p>
            <p className="text-xs text-slate-400 truncate">{user?.role?.replace(/_/g, ' ')}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-slate-400 hover:text-white hover:bg-slate-800"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}
