// Small shared UI building blocks in the Krishi Mitra theme. Large touch targets (min 48 px) for use in the field.

/** Small uppercase section label in the soil accent (as on the landing page). */
export function Eyebrow({ children, className = '' }) {
  return <span className={`text-sm font-bold uppercase tracking-[0.08em] text-soil-500 ${className}`}>{children}</span>;
}

/** The app mark: a sprout in a rounded green square. */
export function LogoMark({ className = 'size-10', inverse = false }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-xl ${inverse ? 'bg-white text-brand-700' : 'bg-brand-700 text-white'} ${className}`}>
      <svg viewBox="0 0 24 24" className="size-[55%]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 20h10" /><path d="M10 20c5.5-2.5.8-6.4 3-10" />
        <path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z" />
        <path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z" />
      </svg>
    </span>
  );
}
import { AlertTriangle, Loader2 } from 'lucide-react';

export function Button({ variant = 'primary', loading = false, className = '', children, ...props }) {
  const styles = {
    primary: 'bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900 disabled:bg-brand-700/50',
    secondary: 'bg-white text-brand-900 ring-1 ring-line-strong hover:bg-brand-50 disabled:opacity-50',
    ghost: 'text-brand-900 hover:bg-brand-100 disabled:opacity-50',
    danger: 'bg-white text-red-700 ring-1 ring-red-300 hover:bg-red-50',
  }[variant];
  return (
    <button
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 font-bold transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed ${styles} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <Loader2 className="size-5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ title, icon: Icon, action, className = '', children }) {
  return (
    <section className={`rounded-3xl border border-line bg-white p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && (
            <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
              {Icon && <Icon className="size-5 text-brand-700" aria-hidden />}
              {title}
            </h2>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle }) {
  return (
    <div className="mb-4">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">{title}</h1>
      {subtitle && <p className="mt-1 text-ink-soft">{subtitle}</p>}
    </div>
  );
}

/** Labelled input with hint and error text, wired up for screen readers. */
export function Field({ id, label, hint, error, optional, optionalLabel, children }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-semibold text-ink">
        {label} {optional && <span className="text-sm font-normal text-ink-muted">({optionalLabel})</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm text-red-700">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-sm text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export const inputClass =
  'block min-h-12 w-full rounded-xl border border-line-strong bg-white px-3 text-base text-ink placeholder:text-ink-muted focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40 aria-[invalid=true]:border-red-500';

export function Spinner({ label }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-ink-muted" role="status">
      <Loader2 className="size-6 animate-spin text-brand-700" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function ErrorAlert({ message, onRetry, retryLabel }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-3 rounded-xl bg-red-50 p-3 text-red-800 ring-1 ring-red-200" role="alert">
      <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
      <p className="flex-1">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="min-h-10 shrink-0 rounded-lg px-3 font-semibold underline">
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function Notice({ tone = 'info', icon: Icon, children }) {
  const tones = {
    info: 'bg-sky-50 text-sky-900 ring-sky-200',
    warning: 'bg-amber-50 text-amber-900 ring-amber-200',
    danger: 'bg-red-50 text-red-900 ring-red-200',
    success: 'bg-brand-50 text-brand-900 ring-brand-200',
  }[tone];
  return (
    <div className={`flex items-start gap-2 rounded-xl p-3 text-sm ring-1 ${tones}`}>
      {Icon && <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <div>{children}</div>
    </div>
  );
}

export function Badge({ tone = 'neutral', children }) {
  const tones = {
    neutral: 'bg-slate-100 text-ink-soft',
    green: 'bg-brand-100 text-brand-900',
    amber: 'bg-amber-100 text-amber-900',
    red: 'bg-red-100 text-red-800',
    blue: 'bg-sky-100 text-sky-900',
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones}`}>{children}</span>;
}
