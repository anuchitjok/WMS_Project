'use client';

import { useCallback, useState } from 'react';
import { BarChart3, ClipboardList, Cog, History, LineChart, SlidersHorizontal, Truck, Boxes } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MrpOverview } from '@/components/mrp/overview';
import { MrpWorkspace } from '@/components/mrp/workspace';
import { MrpRuns } from '@/components/mrp/runs';
import { MrpMaterial } from '@/components/mrp/material';
import { MrpParameters } from '@/components/mrp/parameters';
import { MrpSupply } from '@/components/mrp/supply';
import { MrpSettings } from '@/components/mrp/settings';

// Material Requirements Planning. Suggestions only — nothing here creates,
// submits or changes a purchase order.

export default function MrpPage() {
  const [tab, setTab] = useState('overview');
  const [runId, setRunId] = useState<string | null>(null);
  const openRun = useCallback((id: string) => { setRunId(id); setTab('plan'); }, []);

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Material Planning" subtitle="Usage, forecast and replenishment suggestions — for review, never ordered automatically" icon={Boxes} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview"><BarChart3 className="h-4 w-4" /> Overview</TabsTrigger>
          <TabsTrigger value="plan"><ClipboardList className="h-4 w-4" /> Planning workspace</TabsTrigger>
          <TabsTrigger value="runs"><History className="h-4 w-4" /> Runs</TabsTrigger>
          <TabsTrigger value="material"><LineChart className="h-4 w-4" /> Material analysis</TabsTrigger>
          <TabsTrigger value="parameters"><SlidersHorizontal className="h-4 w-4" /> Parameters</TabsTrigger>
          <TabsTrigger value="supply"><Truck className="h-4 w-4" /> Inbound supply</TabsTrigger>
          <TabsTrigger value="settings"><Cog className="h-4 w-4" /> Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">{tab === 'overview' && <MrpOverview onOpenRun={openRun} />}</TabsContent>
        <TabsContent value="plan" className="mt-4">{tab === 'plan' && <MrpWorkspace runId={runId} onRunChange={setRunId} />}</TabsContent>
        <TabsContent value="runs" className="mt-4">{tab === 'runs' && <MrpRuns onOpenRun={openRun} />}</TabsContent>
        <TabsContent value="material" className="mt-4">{tab === 'material' && <MrpMaterial />}</TabsContent>
        <TabsContent value="parameters" className="mt-4">{tab === 'parameters' && <MrpParameters />}</TabsContent>
        <TabsContent value="supply" className="mt-4">{tab === 'supply' && <MrpSupply />}</TabsContent>
        <TabsContent value="settings" className="mt-4">{tab === 'settings' && <MrpSettings />}</TabsContent>
      </Tabs>
    </div>
  );
}
