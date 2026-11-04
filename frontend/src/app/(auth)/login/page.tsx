'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/auth.store';
import { authApi } from '@/lib/api';
import { User, Lock, Eye, EyeOff, ArrowRight, ShieldCheck, Loader2, Info } from 'lucide-react';
import { LoginShowcase, BrandMark, BrandName } from '@/components/auth/login-showcase';
import styles from '@/components/auth/login.module.css';
import { LanguageSwitcher } from '@/components/layout/language-switcher';
import { getT, useLocaleStore, useT } from '@/i18n';
import { localizeError } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showResetHelp, setShowResetHelp] = useState(false);
  const [form, setForm] = useState({ username: '', password: '' });
  const { m } = useT();
  const applyForUser = useLocaleStore((s) => s.applyForUser);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.username || !form.password) return;
    setLoading(true);
    try {
      const res = await authApi.login(form.username, form.password);
      setAuth(res.user, res.accessToken, res.refreshToken);
      // Restore this user's saved language (or keep the one just picked on this screen).
      applyForUser(res.user.id);
      const after = getT();
      toast.success(after.t(after.m.auth.welcomeToast, { name: res.user.fullName }));
      router.push('/dashboard');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? localizeError(err) : m.auth.loginFailed);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <LoginShowcase />

      <main className={styles.auth}>
        <div className="absolute right-4 top-4 z-10">
          <LanguageSwitcher className="bg-white/90 shadow-sm ring-1 ring-slate-200" />
        </div>
        <div className={styles.card}>
          <div className={styles.cardBrand}>
            <BrandMark size="lg" />
            <BrandName className={styles.cardBrandName} />
            <span className={styles.cardBrandTag}>{m.auth.systemName}</span>
          </div>

          <h2 className={styles.welcome}>{m.auth.welcome}</h2>
          <p className={styles.welcomeSub}>{m.auth.welcomeSub}</p>

          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="username">{m.auth.username}</label>
              <div className={styles.inputWrap}>
                <User className={styles.inputIcon} aria-hidden="true" />
                <input
                  id="username"
                  name="username"
                  placeholder={m.auth.usernamePlaceholder}
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
              <label htmlFor="password">{m.auth.password}</label>
              <div className={styles.inputWrap}>
                <Lock className={styles.inputIcon} aria-hidden="true" />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={m.auth.passwordPlaceholder}
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
                  aria-label={showPassword ? m.auth.hidePassword : m.auth.showPassword}
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
                {m.auth.forgot}
              </button>
            </div>
            {showResetHelp && (
              <p id="reset-help" className={styles.resetHelp} role="status">
                <Info aria-hidden="true" />
                <span>{m.auth.resetHelp}</span>
              </p>
            )}

            <button
              type="submit"
              className={styles.submit}
              disabled={loading || !form.username || !form.password}
              aria-busy={loading}
            >
              {loading ? <Loader2 className={styles.spin} aria-hidden="true" /> : null}
              <span>{loading ? m.auth.signingIn : m.auth.signIn}</span>
              {loading ? null : <ArrowRight className={styles.submitArrow} aria-hidden="true" />}
            </button>
          </form>

          <p className={styles.secure}>
            <ShieldCheck aria-hidden="true" />
            {m.auth.secure}
          </p>
        </div>

        <p className={styles.copyright}>{m.auth.copyright}</p>
      </main>
    </div>
  );
}
