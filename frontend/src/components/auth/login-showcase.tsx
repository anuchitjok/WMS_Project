'use client';

/**
 * Left-hand showcase panel of the login page.
 * Presentation only: no auth logic, no data fetching. Every figure shown
 * here is illustrative sample content and is labelled as such.
 */

import { Boxes, BarChart3, ShieldCheck, Warehouse, Package, Truck, Gauge, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { WarehouseScene } from './warehouse-scene';
import styles from './login.module.css';
import { useT } from '@/i18n';

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
  { icon: Boxes, title: 'f1Title', sub: 'f1Sub' },
  { icon: BarChart3, title: 'f2Title', sub: 'f2Sub' },
  { icon: ShieldCheck, title: 'f3Title', sub: 'f3Sub' },
] as const;

const OVERVIEW = [
  { icon: Warehouse, label: 'warehouses', value: '12', sub: 'sites' },
  { icon: Package, label: 'totalSkus', value: '18,560', sub: 'inCatalogue' },
  { icon: BarChart3, label: 'activeOrders', value: '384', sub: 'inProgress' },
  { icon: TrendingUp, label: 'utilization', value: '92%', sub: 'capacityUsed' },
] as const;

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
  const s = useT().m.auth.showcase;
  return (
    <section className={styles.hero} aria-label={s.aria}>
      <div className={styles.heroBrand}>
        <BrandMark />
        <BrandName className={styles.heroBrandName} />
      </div>

      <div className={styles.heroMain}>
        <div className={styles.copy}>
          <h1 className={styles.title}>
            {s.title}
            <span className={styles.titleAccent}>{s.titleAccent}</span>
          </h1>
          <p className={styles.subtitle}>{s.subtitle}</p>

          <ul className={styles.features}>
            {FEATURES.map(({ icon: Icon, title, sub }) => (
              <li key={title}>
                <span className={styles.featureIcon} aria-hidden="true">
                  <Icon />
                </span>
                <span>
                  <strong>{s[title]}</strong>
                  <span>{s[sub]}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Decorative scene: hidden from assistive tech, figures are illustrative */}
        <div className={styles.stageWrap} aria-hidden="true">
          <div className={styles.stage}>
            <WarehouseScene className={styles.scene} />
            <KpiCard className={styles.kpiInventory} icon={<Boxes />} label={s.totalInventory} value="24,560" sub={s.unitsOnHand} />
            <KpiCard className={styles.kpiUtil} icon={<Gauge />} label={s.warehouseUtilization} value="92%" sub={s.capacityUsed} />
            <KpiCard className={styles.kpiOutbound} icon={<Truck />} label={s.outbound} value="256" sub={s.ordersShipped} />
          </div>
        </div>
      </div>

      <div className={styles.overview}>
        <div className={styles.overviewHead}>
          <p className={styles.overviewTitle}>{s.overview}</p>
          <span className={styles.sampleTag}>{s.sample}</span>
        </div>
        <div className={styles.overviewGrid}>
          {OVERVIEW.map(({ icon: Icon, label, value, sub }) => (
            <div key={label} className={styles.ostat}>
              <span className={styles.ostatIcon} aria-hidden="true">
                <Icon />
              </span>
              <span className={styles.ostatText}>
                <span className={styles.ostatLabel}>{s[label]}</span>
                <span className={styles.ostatValue}>{value}</span>
                <span className={styles.ostatSub}>{s[sub]}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
