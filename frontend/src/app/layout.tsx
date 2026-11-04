import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';
import { HtmlLangSync } from '@/components/i18n/html-lang-sync';

export const metadata: Metadata = {
  title: 'HSNT WMS — Warehouse Management System',
  description: 'Production-ready Warehouse Management System',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full bg-background text-foreground">
        <HtmlLangSync />
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
