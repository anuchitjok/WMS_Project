'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/auth.store';
import { authApi } from '@/lib/api';
import { User, Lock, Eye, EyeOff, ArrowRight, ShieldCheck, Loader2, Info } from 'lucide-react';
import { LoginShowcase, BrandMark, BrandName } from '@/components/auth/login-showcase';
import styles from '@/components/auth/login.module.css';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showResetHelp, setShowResetHelp] = useState(false);
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
    <div className={styles.page}>
      <LoginShowcase />

      <main className={styles.auth}>
        <div className={styles.card}>
          <div className={styles.cardBrand}>
            <BrandMark size="lg" />
            <BrandName className={styles.cardBrandName} />
            <span className={styles.cardBrandTag}>Warehouse Management System</span>
          </div>

          <h2 className={styles.welcome}>Welcome back</h2>
          <p className={styles.welcomeSub}>Sign in to your account to continue</p>

          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="username">Username</label>
              <div className={styles.inputWrap}>
                <User className={styles.inputIcon} aria-hidden="true" />
                <input
                  id="username"
                  name="username"
                  placeholder="Enter your username"
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="next"
                  disabled={loading}
                />
              </div>
            </div>

            <div className={styles.field}>
              <label htmlFor="password">Password</label>
              <div className={styles.inputWrap}>
                <Lock className={styles.inputIcon} aria-hidden="true" />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  autoComplete="current-password"
                  enterKeyHint="go"
                  disabled={loading}
                />
                <button
                  type="button"
                  className={styles.eye}
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  aria-controls="password"
                >
                  {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </button>
              </div>
            </div>

            <div className={styles.row}>
              <button
                type="button"
                className={styles.forgot}
                onClick={() => setShowResetHelp((v) => !v)}
                aria-expanded={showResetHelp}
                aria-controls="reset-help"
              >
                Forgot password?
              </button>
            </div>
            {showResetHelp && (
              <p id="reset-help" className={styles.resetHelp} role="status">
                <Info aria-hidden="true" />
                <span>Passwords are reset by your system administrator. Please contact them to regain access.</span>
              </p>
            )}

            <button
              type="submit"
              className={styles.submit}
              disabled={loading || !form.username || !form.password}
              aria-busy={loading}
            >
              {loading ? <Loader2 className={styles.spin} aria-hidden="true" /> : null}
              <span>{loading ? 'Signing in…' : 'Sign In'}</span>
              {loading ? null : <ArrowRight className={styles.submitArrow} aria-hidden="true" />}
            </button>
          </form>

          <p className={styles.secure}>
            <ShieldCheck aria-hidden="true" />
            Secure login protected by enterprise security
          </p>
        </div>

        <p className={styles.copyright}>© 2026 HSNT WMS. All rights reserved.</p>
      </main>
    </div>
  );
}
