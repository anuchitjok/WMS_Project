'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/auth.store';
import { authApi } from '@/lib/api';
import {
  Hexagon,
  Boxes,
  Truck,
  ClipboardList,
  BarChart3,
  ShieldCheck,
  User,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  TrendingUp,
} from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ username: '', password: '' });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.username || !form.password) return;
    setLoading(true);
    try {
      const res = await authApi.login(form.username, form.password);
      setAuth(res.user, res.accessToken, res.refreshToken);
      toast.success(`Welcome back, ${res.user.fullName}`);
      router.push('/dashboard');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="wms-login">
      {/* ===================== LEFT HERO PANEL ===================== */}
      <section className="wms-hero">
        {/* Layer 6 — ambient gradient blobs */}
        <div className="wms-ambient wms-ambient-1" />
        <div className="wms-ambient wms-ambient-2" />
        <div className="wms-ambient wms-ambient-3" />

        {/* Layer 1 — animated warehouse grid */}
        <div className="wms-grid" />

        {/* Heading + feature list */}
        <div className="wms-hero-copy">
          <h1 className="wms-title">
            Smart Warehouse
            <br />
            <span className="wms-title-accent">Smart Operations</span>
          </h1>
          <p className="wms-subtitle">
            Real-time inventory visibility and intelligent warehouse management
          </p>

          <ul className="wms-features">
            <li>
              <span className="wms-feature-icon">
                <Boxes size={20} />
              </span>
              <div>
                <strong>Real-time Inventory</strong>
                <span>Live tracking and updates</span>
              </div>
            </li>
            <li>
              <span className="wms-feature-icon">
                <BarChart3 size={20} />
              </span>
              <div>
                <strong>Warehouse Analytics</strong>
                <span>Data-driven insights</span>
              </div>
            </li>
            <li>
              <span className="wms-feature-icon">
                <ShieldCheck size={20} />
              </span>
              <div>
                <strong>Secure &amp; Reliable</strong>
                <span>Enterprise-grade security</span>
              </div>
            </li>
          </ul>
        </div>

        {/* ===================== ILLUSTRATION STAGE ===================== */}
        <div className="wms-stage">
          {/* Layer 2 — animated connection network */}
          <svg className="wms-network" viewBox="0 0 600 460" preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="wmsLine" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="rgba(34,197,94,0.05)" />
                <stop offset="50%" stopColor="rgba(34,197,94,0.45)" />
                <stop offset="100%" stopColor="rgba(34,197,94,0.05)" />
              </linearGradient>
            </defs>
            {[
              'M300,230 L120,120',
              'M300,230 L500,140',
              'M300,230 L150,360',
              'M300,230 L470,360',
              'M120,120 L500,140',
              'M150,360 L470,360',
              'M300,230 L300,60',
              'M300,230 L300,420',
            ].map((d, i) => (
              <path
                key={i}
                d={d}
                className="wms-link"
                style={{ animationDelay: `${i * 0.35}s` }}
              />
            ))}
          </svg>

          {/* Layer 3 — pulsing inventory nodes */}
          {[
            { top: '24%', left: '20%' },
            { top: '30%', left: '82%' },
            { top: '12%', left: '50%' },
            { top: '78%', left: '26%' },
            { top: '78%', left: '76%' },
            { top: '90%', left: '50%' },
            { top: '52%', left: '8%' },
            { top: '46%', left: '92%' },
          ].map((p, i) => (
            <span
              key={i}
              className="wms-node"
              style={{ top: p.top, left: p.left, animationDelay: `${i * 0.45}s` }}
            />
          ))}

          {/* Central isometric warehouse + assets */}
          <div className="wms-iso">
            <IsometricWarehouse />
          </div>

          {/* Layer 4 — floating KPI cards */}
          <div className="wms-kpi wms-kpi-inventory" style={{ animationDelay: '0s' }}>
            <span className="wms-kpi-icon wms-kpi-icon-solid">
              <Boxes size={18} />
            </span>
            <div>
              <p className="wms-kpi-label">Total Inventory</p>
              <p className="wms-kpi-value">24,560</p>
              <p className="wms-kpi-delta">+12.5% vs yesterday</p>
            </div>
          </div>

          <div className="wms-kpi wms-kpi-inbound" style={{ animationDelay: '0.8s' }}>
            <span className="wms-kpi-icon">
              <Truck size={18} />
            </span>
            <div>
              <p className="wms-kpi-label">Inbound</p>
              <p className="wms-kpi-value">128</p>
              <p className="wms-kpi-sub">Orders today</p>
            </div>
          </div>

          <div className="wms-kpi wms-kpi-outbound" style={{ animationDelay: '1.4s' }}>
            <span className="wms-kpi-icon wms-kpi-icon-solid">
              <ClipboardList size={18} />
            </span>
            <div>
              <p className="wms-kpi-label">Outbound</p>
              <p className="wms-kpi-value">256</p>
              <p className="wms-kpi-sub">Orders today</p>
            </div>
          </div>

          <div className="wms-kpi wms-kpi-accuracy" style={{ animationDelay: '0.4s' }}>
            <span className="wms-kpi-icon wms-kpi-icon-solid">
              <Boxes size={18} />
            </span>
            <div>
              <p className="wms-kpi-label">Stock Accuracy</p>
              <p className="wms-kpi-value">99.8%</p>
              <p className="wms-kpi-delta">Excellent</p>
            </div>
          </div>
        </div>

        {/* Live warehouse overview bar */}
        <div className="wms-overview">
          <p className="wms-overview-title">Live Warehouse Overview</p>
          <div className="wms-overview-grid">
            <OverviewStat icon={<Hexagon size={18} />} label="Warehouses" value="12" sub="Active" />
            <OverviewStat icon={<Boxes size={18} />} label="Total SKUs" value="18,560" sub="+8.2%" subAccent />
            <OverviewStat icon={<BarChart3 size={18} />} label="Active Orders" value="384" sub="+15.3%" subAccent />
            <OverviewStat icon={<TrendingUp size={18} />} label="Utilization" value="92%" sub="Optimal" subAccent />
          </div>
        </div>
      </section>

      {/* ===================== RIGHT LOGIN PANEL ===================== */}
      <section className="wms-auth">
        <div className="wms-card">
          <div className="wms-brand">
            <span className="wms-brand-mark">
              <Hexagon size={34} className="wms-brand-hex" />
              <BarChart3 size={16} className="wms-brand-glyph" />
            </span>
            <span className="wms-brand-name">
              HSNT<span className="wms-brand-name-accent">WMS</span>
            </span>
            <span className="wms-brand-tag">Warehouse Management System</span>
          </div>

          <h2 className="wms-welcome">Welcome back</h2>
          <p className="wms-welcome-sub">Sign in to your account to continue</p>

          <form onSubmit={handleSubmit} className="wms-form">
            <div className="wms-field">
              <label htmlFor="username">Username</label>
              <div className="wms-input-wrap">
                <User size={18} className="wms-input-icon" />
                <input
                  id="username"
                  placeholder="Enter your username"
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  autoComplete="username"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="wms-field">
              <label htmlFor="password">Password</label>
              <div className="wms-input-wrap">
                <Lock size={18} className="wms-input-icon" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  autoComplete="current-password"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="wms-eye"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="wms-row">
              <label className="wms-remember">
                <input type="checkbox" />
                <span>Remember me</span>
              </label>
              <button type="button" className="wms-forgot">
                Forgot password?
              </button>
            </div>

            <button
              type="submit"
              className="wms-submit"
              disabled={loading || !form.username || !form.password}
            >
              <span>{loading ? 'Signing in…' : 'Sign In'}</span>
              <ArrowRight size={18} />
            </button>
          </form>

          <p className="wms-copyright">© 2026 HSNT WMS. All rights reserved.</p>
        </div>

        <p className="wms-secure">
          <ShieldCheck size={15} />
          Secure login protected by enterprise security
        </p>
      </section>

      <style jsx>{`
        .wms-login {
          --green: #22c55e;
          --green-hover: #16a34a;
          --soft-green: rgba(34, 197, 94, 0.12);
          --ink: #111827;
          --muted: #6b7280;
          --border: #e5e7eb;
          display: grid;
          grid-template-columns: 65% 35%;
          min-height: 100vh;
          background: #ffffff;
          color: var(--ink);
          font-feature-settings: 'cv01', 'ss01';
          overflow: hidden;
        }

        /* ============ LEFT HERO ============ */
        .wms-hero {
          position: relative;
          padding: 48px 56px;
          background: linear-gradient(160deg, #ffffff 0%, #f6fdf8 55%, #eefaf1 100%);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .wms-grid {
          position: absolute;
          inset: -40% -10% -10% -10%;
          background-image: linear-gradient(rgba(34, 197, 94, 0.12) 1px, transparent 1px),
            linear-gradient(90deg, rgba(34, 197, 94, 0.12) 1px, transparent 1px);
          background-size: 46px 46px;
          transform: perspective(600px) rotateX(58deg);
          transform-origin: top center;
          mask-image: radial-gradient(ellipse at 50% 30%, #000 30%, transparent 78%);
          animation: gridDrift 18s linear infinite;
          pointer-events: none;
        }
        @keyframes gridDrift {
          from {
            background-position: 0 0;
          }
          to {
            background-position: 0 46px;
          }
        }
        .wms-ambient {
          position: absolute;
          border-radius: 50%;
          filter: blur(70px);
          opacity: 0.6;
          pointer-events: none;
        }
        .wms-ambient-1 {
          width: 420px;
          height: 420px;
          top: -120px;
          left: -80px;
          background: rgba(34, 197, 94, 0.18);
          animation: floatBlob 16s ease-in-out infinite;
        }
        .wms-ambient-2 {
          width: 360px;
          height: 360px;
          bottom: -100px;
          right: 8%;
          background: rgba(34, 197, 94, 0.13);
          animation: floatBlob 20s ease-in-out infinite reverse;
        }
        .wms-ambient-3 {
          width: 300px;
          height: 300px;
          top: 38%;
          left: 42%;
          background: rgba(16, 185, 129, 0.1);
          animation: floatBlob 24s ease-in-out infinite;
        }
        @keyframes floatBlob {
          0%, 100% {
            transform: translate(0, 0) scale(1);
          }
          50% {
            transform: translate(30px, -28px) scale(1.08);
          }
        }
        .wms-hero-copy {
          position: relative;
          z-index: 4;
          max-width: 420px;
        }
        .wms-title {
          font-size: 40px;
          line-height: 1.08;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin: 0;
        }
        .wms-title-accent {
          color: var(--green);
        }
        .wms-subtitle {
          margin: 18px 0 28px;
          font-size: 16px;
          line-height: 1.5;
          color: var(--muted);
          max-width: 340px;
        }
        .wms-features {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .wms-features li {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .wms-feature-icon {
          display: grid;
          place-items: center;
          width: 44px;
          height: 44px;
          border-radius: 14px;
          background: var(--soft-green);
          color: var(--green);
          box-shadow: 0 6px 18px rgba(34, 197, 94, 0.14);
          flex-shrink: 0;
        }
        .wms-features strong {
          display: block;
          font-size: 15px;
          font-weight: 600;
        }
        .wms-features span span,
        .wms-features div span {
          font-size: 13px;
          color: var(--muted);
        }

        /* ============ ILLUSTRATION STAGE ============ */
        .wms-stage {
          position: absolute;
          top: 50%;
          left: 56%;
          transform: translate(-50%, -50%);
          width: 600px;
          height: 480px;
          z-index: 3;
        }
        .wms-network {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
        }
        .wms-link {
          fill: none;
          stroke: url(#wmsLine);
          stroke-width: 1.5;
          stroke-dasharray: 7 9;
          animation: dashFlow 2.4s linear infinite;
        }
        @keyframes dashFlow {
          to {
            stroke-dashoffset: -32;
          }
        }
        .wms-node {
          position: absolute;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--green);
          box-shadow: 0 0 0 6px rgba(34, 197, 94, 0.16);
          animation: nodePulse 2.6s ease-in-out infinite;
        }
        @keyframes nodePulse {
          0%, 100% {
            transform: scale(0.8);
            box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.18);
          }
          50% {
            transform: scale(1.15);
            box-shadow: 0 0 0 11px rgba(34, 197, 94, 0.04);
          }
        }
        .wms-iso {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 360px;
          transform: translate(-50%, -52%);
          animation: floatAsset 7s ease-in-out infinite;
        }
        @keyframes floatAsset {
          0%, 100% {
            transform: translate(-50%, -52%);
          }
          50% {
            transform: translate(-50%, -57%);
          }
        }

        /* ============ KPI CARDS ============ */
        .wms-kpi {
          position: absolute;
          z-index: 5;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          background: rgba(255, 255, 255, 0.9);
          backdrop-filter: blur(10px);
          border: 1px solid var(--border);
          border-radius: 18px;
          box-shadow: 0 16px 40px rgba(17, 24, 39, 0.1);
          animation: kpiFloat 6s ease-in-out infinite;
        }
        @keyframes kpiFloat {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-12px);
          }
        }
        .wms-kpi-inventory {
          top: 4%;
          left: 28%;
        }
        .wms-kpi-inbound {
          top: 14%;
          right: -2%;
        }
        .wms-kpi-outbound {
          bottom: 12%;
          right: 4%;
        }
        .wms-kpi-accuracy {
          bottom: 16%;
          left: -2%;
        }
        .wms-kpi-icon {
          display: grid;
          place-items: center;
          width: 38px;
          height: 38px;
          border-radius: 12px;
          background: var(--soft-green);
          color: var(--green);
          flex-shrink: 0;
        }
        .wms-kpi-icon-solid {
          background: var(--green);
          color: #fff;
          box-shadow: 0 8px 18px rgba(34, 197, 94, 0.4);
        }
        .wms-kpi-label {
          margin: 0;
          font-size: 11px;
          color: var(--muted);
          font-weight: 500;
        }
        .wms-kpi-value {
          margin: 1px 0;
          font-size: 19px;
          font-weight: 800;
          letter-spacing: -0.02em;
        }
        .wms-kpi-delta {
          margin: 0;
          font-size: 11px;
          font-weight: 600;
          color: var(--green);
        }
        .wms-kpi-sub {
          margin: 0;
          font-size: 11px;
          color: var(--muted);
        }

        /* ============ OVERVIEW BAR ============ */
        .wms-overview {
          position: relative;
          z-index: 4;
          margin-top: auto;
          padding: 20px 24px;
          background: rgba(255, 255, 255, 0.72);
          backdrop-filter: blur(12px);
          border: 1px solid var(--border);
          border-radius: 22px;
          box-shadow: 0 18px 50px rgba(17, 24, 39, 0.06);
        }
        .wms-overview-title {
          margin: 0 0 14px;
          font-size: 14px;
          font-weight: 700;
        }
        .wms-overview-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 18px;
        }

        /* ============ RIGHT AUTH PANEL ============ */
        .wms-auth {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 32px;
          background: linear-gradient(180deg, #fafafa 0%, #f3f4f6 100%);
          gap: 16px;
        }
        .wms-card {
          width: 100%;
          max-width: 420px;
          padding: 36px 36px 28px;
          background: rgba(255, 255, 255, 0.9);
          backdrop-filter: blur(24px);
          border-radius: 24px;
          border: 1px solid rgba(229, 231, 235, 0.8);
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06), 0 1px 4px rgba(0, 0, 0, 0.04);
        }

        /* 1. Logo block — tighter vertical group */
        .wms-brand {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          margin-bottom: 20px;
          gap: 4px;
        }
        .wms-brand-mark {
          position: relative;
          display: grid;
          place-items: center;
          width: 48px;
          height: 48px;
          margin-bottom: 8px;
        }
        .wms-brand-hex {
          position: absolute;
          color: var(--green);
        }
        .wms-brand-glyph {
          position: relative;
          color: #fff;
          z-index: 1;
        }
        .wms-brand-name {
          font-size: 24px;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: var(--ink);
          line-height: 1;
        }
        .wms-brand-name-accent {
          color: var(--green);
        }
        .wms-brand-tag {
          font-size: 12px;
          color: var(--muted);
          letter-spacing: 0.01em;
        }

        /* 2. Welcome section — tighter gap from branding */
        .wms-welcome {
          margin: 0;
          text-align: center;
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.02em;
        }
        .wms-welcome-sub {
          margin: 4px 0 20px;
          text-align: center;
          font-size: 13px;
          color: var(--muted);
        }

        /* 3. Form — reduced gap between fields */
        .wms-form {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .wms-field label {
          display: block;
          margin-bottom: 6px;
          font-size: 13px;
          font-weight: 600;
          color: var(--ink);
        }
        .wms-input-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }

        /* 5. Icons — perfectly centered vertically */
        .wms-input-icon {
          position: absolute;
          left: 14px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--muted);
          pointer-events: none;
          display: flex;
        }

        /* 4. Input fields — modern SaaS proportions */
        .wms-input-wrap input {
          width: 100%;
          height: 44px;
          padding: 0 40px;
          border: 1.5px solid var(--border);
          border-radius: 10px;
          background: #ffffff;
          font-size: 14px;
          color: var(--ink);
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .wms-input-wrap input::placeholder {
          color: #9ca3af;
          font-size: 13px;
        }
        .wms-input-wrap input:focus {
          border-color: var(--green);
          box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.12);
        }

        /* 5. Eye icon — aligned to input centerline */
        .wms-eye {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 4px;
          border: none;
          background: transparent;
          color: var(--muted);
          cursor: pointer;
        }
        .wms-eye:hover {
          color: var(--ink);
        }

        /* 6. Remember Me / Forgot Password — same baseline */
        .wms-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .wms-remember {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: var(--muted);
          cursor: pointer;
          line-height: 1;
        }
        .wms-remember input {
          width: 15px;
          height: 15px;
          accent-color: var(--green);
          cursor: pointer;
          flex-shrink: 0;
        }
        .wms-forgot {
          border: none;
          background: transparent;
          font-size: 13px;
          font-weight: 600;
          color: var(--green);
          cursor: pointer;
          line-height: 1;
          padding: 0;
        }
        .wms-forgot:hover {
          color: var(--green-hover);
        }

        /* 7. Sign In button — premium enterprise height */
        .wms-submit {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          height: 46px;
          margin-top: 4px;
          border: none;
          border-radius: 12px;
          background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
          color: #fff;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 4px 16px rgba(34, 197, 94, 0.3);
          transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
          letter-spacing: 0.01em;
        }
        .wms-submit svg {
          transition: transform 0.2s;
        }
        .wms-submit:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 8px 24px rgba(34, 197, 94, 0.38);
        }
        .wms-submit:hover:not(:disabled) svg {
          transform: translateX(3px);
        }
        .wms-submit:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          box-shadow: none;
        }

        /* 8. Footer — reduced detachment from button */
        .wms-copyright {
          margin: 16px 0 0;
          text-align: center;
          font-size: 12px;
          color: #9ca3af;
        }
        .wms-secure {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: var(--muted);
        }
        .wms-secure svg {
          color: var(--green);
        }

        /* ============ RESPONSIVE ============ */
        @media (max-width: 1024px) {
          .wms-login {
            grid-template-columns: 1fr;
          }
          .wms-hero {
            display: none;
          }
          .wms-auth {
            min-height: 100vh;
          }
        }
      `}</style>
    </div>
  );
}

/* ===================== SUB-COMPONENTS ===================== */

function OverviewStat({
  icon,
  label,
  value,
  sub,
  subAccent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  subAccent?: boolean;
}) {
  return (
    <div className="wms-ostat">
      <span className="wms-ostat-icon">{icon}</span>
      <div>
        <p className="wms-ostat-label">{label}</p>
        <p className="wms-ostat-value">{value}</p>
        <p className={subAccent ? 'wms-ostat-sub accent' : 'wms-ostat-sub'}>{sub}</p>
      </div>
      <style jsx>{`
        .wms-ostat {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .wms-ostat-icon {
          display: grid;
          place-items: center;
          width: 40px;
          height: 40px;
          border-radius: 12px;
          background: rgba(34, 197, 94, 0.12);
          color: #22c55e;
          flex-shrink: 0;
        }
        .wms-ostat-label {
          margin: 0;
          font-size: 12px;
          color: #6b7280;
        }
        .wms-ostat-value {
          margin: 1px 0;
          font-size: 20px;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: #111827;
        }
        .wms-ostat-sub {
          margin: 0;
          font-size: 11px;
          color: #6b7280;
        }
        .wms-ostat-sub.accent {
          color: #22c55e;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}

/* Isometric warehouse + truck + forklift + pallets + racks (pure SVG) */
function IsometricWarehouse() {
  return (
    <svg viewBox="0 0 360 320" xmlns="http://www.w3.org/2000/svg" className="wms-iso-svg">
      <defs>
        <linearGradient id="roof" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#eef2f0" />
        </linearGradient>
        <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f8faf9" />
          <stop offset="100%" stopColor="#e6ebe8" />
        </linearGradient>
        <linearGradient id="greenFace" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d76a" />
          <stop offset="100%" stopColor="#16a34a" />
        </linearGradient>
      </defs>

      {/* ground shadow */}
      <ellipse cx="180" cy="276" rx="150" ry="34" fill="rgba(34,197,94,0.08)" />

      {/* ---- Warehouse building ---- */}
      {/* left wall */}
      <path d="M120,118 L120,210 L180,244 L180,150 Z" fill="url(#wall)" />
      {/* right wall (green accent) */}
      <path d="M180,150 L180,244 L260,200 L260,108 Z" fill="url(#greenFace)" opacity="0.92" />
      {/* roof */}
      <path d="M120,118 L180,84 L260,108 L180,150 Z" fill="url(#roof)" stroke="#e5e7eb" strokeWidth="1" />
      {/* door opening */}
      <path d="M198,168 L198,214 L238,191 L238,146 Z" fill="#0f3d24" opacity="0.55" />
      {/* roof ridge accents */}
      <path d="M134,124 L186,95" stroke="#d1d5db" strokeWidth="1.4" />
      <path d="M150,131 L200,102" stroke="#d1d5db" strokeWidth="1.4" />

      {/* ---- Rack shelving (right) ---- */}
      <g transform="translate(276,150)">
        <path d="M0,0 L0,54 L34,74 L34,20 Z" fill="#e6ebe8" />
        <path d="M34,20 L34,74 L60,59 L60,5 Z" fill="#22c55e" opacity="0.85" />
        <path d="M0,18 L34,38 M0,36 L34,56" stroke="#9ca3af" strokeWidth="1.4" />
        <rect x="6" y="6" width="9" height="9" fill="#cbd5d1" transform="skewY(30)" />
      </g>

      {/* ---- Pallets (front-left) ---- */}
      <g transform="translate(70,196)">
        <path d="M0,18 L30,34 L60,18 L30,2 Z" fill="#d7ddd9" />
        <path d="M0,18 L0,30 L30,46 L30,34 Z" fill="#b8c2bd" />
        <path d="M30,34 L30,46 L60,30 L60,18 Z" fill="#c8d0cc" />
        <path d="M8,10 L30,22 L52,10 L30,-2 Z" fill="#34d76a" opacity="0.8" />
      </g>

      {/* ---- Pallets (front-right) ---- */}
      <g transform="translate(196,224)">
        <path d="M0,16 L26,30 L52,16 L26,2 Z" fill="#d7ddd9" />
        <path d="M0,16 L0,27 L26,41 L26,30 Z" fill="#b8c2bd" />
        <path d="M26,30 L26,41 L52,27 L52,16 Z" fill="#c8d0cc" />
      </g>

      {/* ---- Truck ---- */}
      <g transform="translate(150,196)">
        {/* trailer */}
        <path d="M0,18 L0,2 L40,-20 L40,-4 Z" fill="#ffffff" stroke="#e5e7eb" />
        <path d="M0,18 L0,2 L-20,-9 L-20,7 Z" fill="#e9eeeb" />
        <path d="M-20,7 L-20,-9 L40,-44 L40,-20 L0,2 Z" fill="#f3f5f4" stroke="#e5e7eb" />
        {/* cab */}
        <path d="M40,-4 L40,-20 L58,-30 L58,-14 Z" fill="url(#greenFace)" />
        <path d="M44,-13 L44,-20 L54,-26 L54,-19 Z" fill="#bbf7d0" opacity="0.9" />
        {/* wheels */}
        <ellipse cx="6" cy="20" rx="5" ry="3" fill="#374151" />
        <ellipse cx="44" cy="-2" rx="5" ry="3" fill="#374151" />
      </g>

      {/* ---- Forklift ---- */}
      <g transform="translate(96,238)">
        <path d="M0,10 L18,20 L30,13 L12,3 Z" fill="#16a34a" />
        <path d="M18,20 L18,12 L30,5 L30,13 Z" fill="#22c55e" />
        <path d="M2,2 L2,-12 L6,-12 L6,4 Z" fill="#9ca3af" />
        <path d="M2,-10 L-8,-5 M2,-2 L-8,3" stroke="#9ca3af" strokeWidth="1.6" />
        <ellipse cx="8" cy="16" rx="4" ry="2.4" fill="#374151" />
        <ellipse cx="24" cy="14" rx="3.4" ry="2" fill="#374151" />
      </g>
    </svg>
  );
}
