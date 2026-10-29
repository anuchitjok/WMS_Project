'use client';

import { useState } from 'react';
import { BadgeCheck, FileText, History, Search } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WarrantyHistory, WarrantyLookup, WarrantyRules } from '@/components/warranty/warranty-views';

export default function WarrantyPage() {
  const [tab, setTab] = useState('lookup');
  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Warranty" subtitle="Check coverage by serial number, manage warranty rules and see past checks" icon={BadgeCheck} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
        <TabsList>
          <TabsTrigger value="lookup"><Search className="h-4 w-4" /> Lookup</TabsTrigger>
          <TabsTrigger value="rules"><FileText className="h-4 w-4" /> Rules</TabsTrigger>
          <TabsTrigger value="history"><History className="h-4 w-4" /> History &amp; dates</TabsTrigger>
        </TabsList>
        <TabsContent value="lookup" className="mt-4">{tab === 'lookup' && <WarrantyLookup />}</TabsContent>
        <TabsContent value="rules" className="mt-4">{tab === 'rules' && <WarrantyRules />}</TabsContent>
        <TabsContent value="history" className="mt-4">{tab === 'history' && <WarrantyHistory />}</TabsContent>
      </Tabs>
    </div>
  );
}
