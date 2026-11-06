'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Package, ClipboardList, RotateCcw, Users, ScrollText,
  LogOut, Warehouse, ChevronRight, PackagePlus, MapPin, Truck,
  CheckCircle2, RefreshCw, AlertTriangle,
  Tag, Settings, BarChart3, ShieldCheck, Database, Bell, Trash2, ListTodo,
  PackageCheck, Undo2, Building2, Handshake, ListChecks, GitBranch, BellRing, ClipboardList as PlanIcon, Boxes, BadgeCheck, ClipboardCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import type { UserRole } from '@/types';
import { labelOf, useT, type Messages } from '@/i18n';
import { useModuleVisible, type ModuleKey } from '@/lib/feature-flags';

type NavLabel = keyof Messages['nav']['items'];
type NavGroupKey = keyof Messages['nav']['groups'];

interface NavItem {
  href: string;
  /** Key into m.nav.items — the visible text comes from the translation files. */
  label: NavLabel;
  icon: React.ComponentType<{ className?: string }>;
  roles?: UserRole[];
  /** Optional module (P7 7.1): hidden while switched off in System Settings → Modules. */
  module?: ModuleKey;
}

interface NavGroup {
  group: NavGroupKey;
  items: NavItem[];
}

const ADMIN: UserRole[] = ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER'];
const WH: UserRole[] = ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR', 'WAREHOUSE_STAFF'];

const NAV_GROUPS: NavGroup[] = [
  {
    group: 'overview',
    items: [
      { href: '/dashboard', label: 'dashboard', icon: LayoutDashboard },
      { href: '/work-queue', label: 'workQueue', icon: ListTodo, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR', 'WAREHOUSE_STAFF', 'DEPT_APPROVER', 'RTV_OFFICER', 'RMA_TEAM'] },
      { href: '/reports', label: 'reports', icon: BarChart3 },
      { href: '/planning', label: 'projectPlanning', icon: PlanIcon, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR', 'MGMT_VIEWER', 'FINANCE_VIEWER', 'AUDITOR'] },
    ],
  },
  {
    // CR-MASTER-001: Master Data group — only items backed by a real page/route are listed here.
    group: 'masterData',
    items: [
      { href: '/setup-checklist', label: 'setupChecklist', icon: ClipboardCheck, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER'] },
      { href: '/products', label: 'productMaster', icon: Tag, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR'] },
      { href: '/business-partners', label: 'businessPartners', icon: Handshake, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR'] },
      { href: '/warehouse-master', label: 'warehouseMaster', icon: Building2, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR', 'WAREHOUSE_STAFF'] },
      { href: '/users', label: 'users', icon: Users, roles: ADMIN },
      { href: '/roles', label: 'roles', icon: ShieldCheck, roles: ['SYSTEM_ADMIN'] },
      { href: '/settings', label: 'systemSettings', icon: Settings, roles: ['SYSTEM_ADMIN'] },
      { href: '/company-profile', label: 'companyProfile', icon: BadgeCheck, roles: ['SYSTEM_ADMIN'] },
      { href: '/system-master', label: 'listsCodes', icon: ListChecks, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER'] },
      { href: '/approval-rules', label: 'approvalRules', icon: GitBranch, roles: ['SYSTEM_ADMIN'] },
      { href: '/notification-templates', label: 'notificationTemplates', icon: BellRing, roles: ['SYSTEM_ADMIN'] },
    ],
  },
  {
    group: 'warehouse',
    items: [
      { href: '/warehouse-layout', label: 'warehouseOperations', icon: Warehouse, roles: WH },
      { href: '/receiving', label: 'goodsReceiving', icon: PackagePlus, roles: WH },
      { href: '/putaway', label: 'putaway', icon: MapPin, roles: WH },
      { href: '/inventory', label: 'inventory', icon: Package },
      // P4 4.2: approval sits in the outbound flow — approve, then allocate/fulfil.
      // Role list is deliberately its own (not WH): DEPT_APPROVER must keep seeing it.
      { href: '/approvals', label: 'approvalWorkspace', icon: ShieldCheck, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR', 'DEPT_APPROVER'] },
      { href: '/outbound/fulfillment', label: 'fulfillmentBoard', icon: Truck, roles: WH },
      { href: '/handover', label: 'handover', icon: CheckCircle2, roles: WH },
      { href: '/warehouse/returns', label: 'returnsInbound', icon: RefreshCw, roles: WH },
      // Phase 2: Stock Transfer, Stock Adjustment, Barcode Scanner and Cycle Count
      // (Step 5) are retired from navigation. Their pages still open as read-only history.
    ],
  },
  {
    // Same legacy roles as the backend access rules (mrpView / warrantyView); the API enforces the real permission.
    group: 'planning',
    items: [
      { href: '/mrp', label: 'materialPlanning', icon: Boxes, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR', 'MGMT_VIEWER'], module: 'mrp' },
      { href: '/warranty', label: 'warranty', icon: ShieldCheck, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR', 'RMA_TEAM', 'RTV_OFFICER'], module: 'warranty' },
    ],
  },
  {
    group: 'requester',
    items: [
      { href: '/requests', label: 'withdrawalRequests', icon: ClipboardList },
      { href: '/issued-items', label: 'issuedItems', icon: PackageCheck },
      { href: '/returns', label: 'pendingReturns', icon: Undo2 },
    ],
  },
  {
    // Step 4 (Use & Return): defective units go DOA → RTV → replacement, or to scrap.
    group: 'useReturn',
    items: [
      { href: '/doa', label: 'doa', icon: AlertTriangle, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'RTV_OFFICER', 'RMA_TEAM'] },
      { href: '/rtv', label: 'rtvCases', icon: RotateCcw, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'RTV_OFFICER'] },
      { href: '/scrap', label: 'scrap', icon: Trash2, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'RTV_OFFICER', 'WAREHOUSE_SUPERVISOR'] },
    ],
  },
  {
    group: 'admin',
    items: [
      { href: '/data-io', label: 'importExport', icon: Database, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR'] },
      { href: '/notifications', label: 'notifications', icon: Bell },
      { href: '/audit', label: 'auditTrail', icon: ScrollText, roles: ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'AUDITOR'] },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();
  const { m } = useT();
  // Defaults (hidden) apply until the setting is read, so hidden items never flash in.
  const moduleOn: Record<ModuleKey, boolean> = {
    warranty: useModuleVisible('warranty'),
    mrp: useModuleVisible('mrp'),
    floorPlan2d: useModuleVisible('floorPlan2d'),
  };

  function handleLogout() {
    clearAuth();
    router.push('/login');
  }

  function canSee(item: NavItem) {
    if (item.module && !moduleOn[item.module]) return false;
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
          <p className="text-xs text-slate-400">{m.common.appTagline}</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
        {NAV_GROUPS.map((g) => {
          const items = g.items.filter(canSee);
          if (items.length === 0) return null;
          return (
            <div key={g.group}>
              <p className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">{m.nav.groups[g.group]}</p>
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
                      <span className="flex-1 min-w-0 leading-snug">{m.nav.items[item.label]}</span>
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
            <p className="text-xs text-slate-400 truncate">{labelOf(m.nav.roles, user?.role)}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-slate-500 hover:text-red-600 hover:bg-red-50"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4 mr-2" />
          {m.nav.signOut}
        </Button>
      </div>
    </aside>
  );
}
