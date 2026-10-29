/**
 * Left-hand showcase panel of the login page.
 * Presentation only: no auth logic, no data fetching. Every figure shown
 * here is illustrative sample content and is labelled as such.
 */

import { Boxes, BarChart3, ShieldCheck, Warehouse, Package, Truck, Gauge, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { WarehouseScene } from './warehouse-scene';
import styles from './login.module.css';

export function BrandMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className={size === 'lg' ? `${styles.brandMark} ${styles.brandMarkLg}` : styles.brandMark} aria-hidden="true">
      <Warehouse />
    </span>
  );
}

export function BrandName({ className }: { className?: string }) {
  return (
    <span className={className}>
      HSNT <span className={styles.brandAccent}>WMS</span>
    </span>
  );
}

const FEATURES = [
  { icon: Boxes, title: 'Real-time Inventory', sub: 'Live tracking and updates' },
  { icon: BarChart3, title: 'Warehouse Analytics', sub: 'Data-driven insights' },
  { icon: ShieldCheck, title: 'Secure & Reliable', sub: 'Enterprise-grade security' },
];

const OVERVIEW = [
  { icon: Warehouse, label: 'Warehouses', value: '12', sub: 'Sites' },
  { icon: Package, label: 'Total SKUs', value: '18,560', sub: 'In catalogue' },
  { icon: BarChart3, label: 'Active Orders', value: '384', sub: 'In progress' },
  { icon: TrendingUp, label: 'Utilization', value: '92%', sub: 'Capacity used' },
];

function KpiCard({ className, icon, label, value, sub }: { className: string; icon: ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className={`${styles.kpi} ${className}`}>
      <span className={styles.kpiIcon}>{icon}</span>
      <span className={styles.kpiText}>
        <span className={styles.kpiLabel}>{label}</span>
        <span className={styles.kpiValue}>{value}</span>
        <span className={styles.kpiSub}>{sub}</span>
      </span>
    </div>
  );
}

export function LoginShowcase() {
  return (
    <section className={styles.hero} aria-label="HSNT WMS overview">
      <div className={styles.heroBrand}>
        <BrandMark />
        <BrandName className={styles.heroBrandName} />
      </div>

      <div className={styles.heroMain}>
        <div className={styles.copy}>
          <h1 className={styles.title}>
            Smart Warehouse
            <span className={styles.titleAccent}>Smart Operations</span>
          </h1>
          <p className={styles.subtitle}>Real-time inventory visibility and intelligent warehouse management.</p>

          <ul className={styles.features}>
            {FEATURES.map(({ icon: Icon, title, sub }) => (
              <li key={title}>
                <span className={styles.featureIcon} aria-hidden="true">
                  <Icon />
                </span>
                <span>
                  <strong>{title}</strong>
                  <span>{sub}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Decorative scene: hidden from assistive tech, figures are illustrative */}
        <div className={styles.stageWrap} aria-hidden="true">
          <div className={styles.stage}>
            <WarehouseScene className={styles.scene} />
            <KpiCard className={styles.kpiInventory} icon={<Boxes />} label="Total Inventory" value="24,560" sub="Units on hand" />
            <KpiCard className={styles.kpiUtil} icon={<Gauge />} label="Warehouse Utilization" value="92%" sub="Capacity used" />
            <KpiCard className={styles.kpiOutbound} icon={<Truck />} label="Outbound" value="256" sub="Orders shipped" />
          </div>
        </div>
      </div>

      <div className={styles.overview}>
        <div className={styles.overviewHead}>
          <p className={styles.overviewTitle}>Warehouse Overview</p>
          <span className={styles.sampleTag}>Sample figures</span>
        </div>
        <div className={styles.overviewGrid}>
          {OVERVIEW.map(({ icon: Icon, label, value, sub }) => (
            <div key={label} className={styles.ostat}>
              <span className={styles.ostatIcon} aria-hidden="true">
                <Icon />
              </span>
              <span className={styles.ostatText}>
                <span className={styles.ostatLabel}>{label}</span>
                <span className={styles.ostatValue}>{value}</span>
                <span className={styles.ostatSub}>{sub}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
