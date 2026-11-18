// Public landing page (/welcome), following the approved "Agri-DSS UI Screens" design.
// Fluid: one column on phones, two-column sections from lg. Logged-in visitors get "Open my dashboard".
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Camera, Check, CloudSun, FlaskConical, History, Info, MessageCircle, Mic, Sprout } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { LANGUAGES } from '../lib/constants';
import { LanguageSwitcher } from '../components/Layout';
import { Eyebrow, LogoMark } from '../components/ui';

/** Responsive photo from /public/images (800 px for phones, 1600 px for wide screens). */
function Photo({ name, alt, className = '', sizes = '(min-width: 1024px) 50vw, 100vw', priority = false }) {
  return (
    <img
      src={`/images/${name}-1600.jpg`}
      srcSet={`/images/${name}-800.jpg 800w, /images/${name}-1600.jpg 1600w`}
      sizes={sizes}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
      className={className}
    />
  );
}

const FEATURES = [
  { key: 'crop', icon: Sprout, tone: 'bg-brand-100 text-brand-900' },
  { key: 'fertilizer', icon: FlaskConical, tone: 'bg-soil-50 text-soil-800' },
  { key: 'disease', icon: Camera, tone: 'bg-brand-100 text-brand-900' },
  { key: 'weather', icon: CloudSun, tone: 'bg-sky-100 text-sky-900' },
  { key: 'chat', icon: MessageCircle, tone: 'bg-soil-50 text-soil-800' },
  { key: 'fields', icon: History, tone: 'bg-brand-100 text-brand-900' },
];

// Real figures from the project (model metrics, knowledge base, SHC build).
const STATS = [['22', 'crops'], ['99.5%', 'accuracy'], ['38', 'diseases'], ['693', 'districts'], ['5', 'languages']];

// Real output of the live location test (Nalgonda, November, district soil estimate).
const SAMPLE = [['lentil', 90], ['maize', 33], ['papaya', 30]];

// Soil Health Card 2025-26 class shares for Nalgonda (from the SHC district data).
const SHC_ROWS = [['N', 100, 0, 0], ['P', 0, 0, 100], ['K', 0, 96, 4]];

const sectionTitle = 'font-display text-3xl font-extrabold leading-tight tracking-tight text-balance sm:text-4xl lg:text-[42px]';

export default function Landing() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const startTo = user ? '/' : '/register';

  return (
    <div className="min-h-dvh bg-mint text-ink">
      <a href="#top" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:font-semibold">
        {t('nav.skip')}
      </a>

      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <nav aria-label={t('nav.main')} className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-7 gap-y-2 px-4 py-3 sm:px-6">
          <Link to="/welcome" className="flex items-center gap-2.5 rounded-lg">
            <LogoMark className="size-10" />
            <span className="font-display text-xl font-extrabold tracking-tight">{t('app.name')}</span>
          </Link>
          <div className="order-3 hidden flex-1 gap-6 text-[15px] font-medium text-ink-soft lg:order-none lg:flex">
            <a href="#features" className="py-2.5 hover:text-brand-900">{t('landing.nav.features')}</a>
            <a href="#how" className="py-2.5 hover:text-brand-900">{t('landing.nav.how')}</a>
            <a href="#field" className="py-2.5 hover:text-brand-900">{t('landing.nav.field')}</a>
            <a href="#languages" className="py-2.5 hover:text-brand-900">{t('landing.nav.languages')}</a>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <LanguageSwitcher tone="light" />
            {user ? (
              <Link to="/" className="inline-flex min-h-11 items-center rounded-xl bg-brand-700 px-4 font-bold text-white hover:bg-brand-800">{t('landing.nav.dashboard')}</Link>
            ) : (
              <>
                <Link to="/login" className="hidden min-h-11 items-center rounded-xl px-3 font-semibold text-brand-900 hover:bg-brand-50 sm:inline-flex">{t('landing.nav.login')}</Link>
                <Link to="/register" className="inline-flex min-h-11 items-center rounded-xl bg-brand-700 px-4 font-bold text-white hover:bg-brand-800">{t('landing.nav.start')}</Link>
              </>
            )}
          </div>
        </nav>
      </header>

      <main id="top">
        {/* Hero */}
        <section className="mx-auto flex max-w-7xl flex-col gap-12 px-4 pb-10 pt-10 sm:px-6 lg:flex-row lg:items-center lg:pt-14">
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <span className="inline-flex items-center gap-2 self-start rounded-full bg-brand-100 px-3.5 py-1.5 text-sm font-semibold text-brand-900">
              <span className="size-2 rounded-full bg-brand-700" aria-hidden />
              {t('landing.hero.badge')}
            </span>
            <h1 className="font-display text-4xl font-extrabold leading-[1.06] tracking-tight text-balance sm:text-5xl xl:text-[62px]">
              {t('landing.hero.titleBefore')}<span className="text-brand-700">{t('landing.hero.titleHighlight')}</span>{t('landing.hero.titleAfter')}
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-ink-soft">{t('landing.hero.lead')}</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link to={user ? '/fields' : '/register'} className="inline-flex min-h-13 items-center justify-center gap-2.5 rounded-2xl bg-brand-700 px-6 text-lg font-bold text-white hover:bg-brand-800">
                {t('landing.hero.ctaStart')}<ArrowRight className="size-5" aria-hidden />
              </Link>
              <Link to={user ? '/chat' : '/register'} className="inline-flex min-h-13 items-center justify-center gap-2.5 rounded-2xl border border-line-strong bg-white px-6 text-lg font-bold text-brand-900 hover:bg-brand-50">
                <Mic className="size-5" aria-hidden />{t('landing.hero.ctaVoice')}
              </Link>
            </div>
            <ul className="flex flex-col gap-2.5 text-[15px] text-ink-soft">
              {['point1', 'point2'].map((k) => (
                <li key={k} className="flex items-start gap-2.5"><Check className="mt-0.5 size-5 shrink-0 text-brand-700" strokeWidth={2.4} aria-hidden />{t(`landing.hero.${k}`)}</li>
              ))}
            </ul>
          </div>

          <div className="relative min-w-0 flex-1 pb-10 lg:pl-5">
            <Photo name="hero-gujarat" alt={t('landing.hero.alt')} priority className="aspect-[5/4] w-full rounded-[28px] object-cover" />
            <div className="absolute bottom-0 left-2 w-[min(300px,80%)] rounded-3xl border border-line bg-white p-4 shadow-[0_18px_40px_rgba(16,38,27,0.16)] sm:left-0">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <span className="font-display text-[15px] font-bold">{t('landing.hero.sampleTitle')}</span>
                <span className="text-xs text-ink-muted">{t('landing.hero.samplePlace')}</span>
              </div>
              <ol className="flex flex-col gap-2.5">
                {SAMPLE.map(([crop, pct], i) => (
                  <li key={crop} className="flex flex-col gap-1">
                    <span className="flex justify-between text-sm"><span className="font-semibold">{i + 1}. {t(`crops.${crop}`, crop)}</span><span className="font-bold text-brand-900">{pct}%</span></span>
                    <span className="h-2 rounded-full bg-brand-50"><span className="block h-2 rounded-full bg-brand-700" style={{ width: `${pct}%` }} /></span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs leading-snug text-ink-muted">{t('landing.hero.sampleNote')}</p>
            </div>
            <div className="absolute right-3 top-3 flex items-center gap-2.5 rounded-2xl bg-white px-3.5 py-2.5 shadow-[0_10px_28px_rgba(16,38,27,0.14)]">
              <span className="grid size-9 place-items-center rounded-xl bg-soil-50 text-soil-800"><CloudSun className="size-5" aria-hidden /></span>
              <span className="flex flex-col text-[13px] leading-tight"><span className="font-bold">{t('landing.hero.normalTitle')}</span><span className="text-ink-muted">{t('landing.hero.normalValue')}</span></span>
            </div>
          </div>
        </section>

        {/* Facts */}
        <section aria-label={t('landing.stats.aria')} className="mx-auto max-w-7xl px-4 pb-14 sm:px-6">
          <dl className="grid grid-cols-2 gap-5 rounded-3xl border border-line bg-white p-6 sm:grid-cols-3 lg:grid-cols-5">
            {STATS.map(([value, key]) => (
              <div key={key} className="flex flex-col-reverse gap-1">
                <dt className="text-sm text-ink-soft">{t(`landing.stats.${key}`)}</dt>
                <dd className="font-display text-3xl font-extrabold text-brand-900 sm:text-[34px]">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-20 border-y border-line bg-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-9 px-4 py-16 sm:px-6 lg:py-20">
            <div className="flex max-w-2xl flex-col gap-3">
              <Eyebrow>{t('landing.features.eyebrow')}</Eyebrow>
              <h2 className={sectionTitle}>{t('landing.features.title')}</h2>
              <p className="text-lg leading-relaxed text-ink-soft">{t('landing.features.lead')}</p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ key, icon: Icon, tone }) => (
                <article key={key} className="flex flex-col gap-3 rounded-3xl border border-line bg-[#fbfdfb] p-6">
                  <span className={`grid size-12 place-items-center rounded-2xl ${tone}`}><Icon className="size-6" aria-hidden /></span>
                  <h3 className="text-xl font-bold">{t(`landing.features.${key}.t`)}</h3>
                  <p className="leading-relaxed text-ink-soft">{t(`landing.features.${key}.d`)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto flex max-w-7xl scroll-mt-20 flex-col gap-12 px-4 py-16 sm:px-6 lg:flex-row lg:items-center lg:py-20">
          <Photo name="sowing-raichur" alt={t('landing.how.alt')} className="aspect-[3/2] w-full min-w-0 flex-1 rounded-[28px] object-cover" />
          <div className="flex min-w-0 flex-1 flex-col gap-7">
            <div className="flex flex-col gap-3">
              <Eyebrow>{t('landing.how.eyebrow')}</Eyebrow>
              <h2 className={sectionTitle}>{t('landing.how.title')}</h2>
            </div>
            <ol className="flex flex-col gap-6">
              {[1, 2, 3].map((n) => (
                <li key={n} className="flex gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-700 font-display font-extrabold text-white">{n}</span>
                  <span className="flex flex-col gap-1">
                    <span className="text-lg font-bold">{t(`landing.how.s${n}t`)}</span>
                    <span className="leading-relaxed text-ink-soft">{t(`landing.how.s${n}d`)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* For your field */}
        <section id="field" className="scroll-mt-20 bg-brand-900 text-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-12 px-4 py-16 sm:px-6 lg:flex-row lg:items-center lg:py-20">
            <div className="flex min-w-0 flex-1 flex-col gap-6">
              <span className="text-sm font-bold uppercase tracking-[0.08em] text-amber-300">{t('landing.field.eyebrow')}</span>
              <h2 className={sectionTitle}>{t('landing.field.title')}</h2>
              <p className="text-lg leading-relaxed text-brand-50">{t('landing.field.lead')}</p>
              <div className="grid gap-3.5 sm:grid-cols-2">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="flex flex-col gap-1.5 rounded-2xl border border-white/20 p-4">
                    <span className="font-bold">{t(`landing.field.c${n}t`)}</span>
                    <span className="text-sm leading-relaxed text-brand-50">{t(`landing.field.c${n}d`)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative min-w-0 flex-1 pb-14">
              <Photo name="moong-mp" alt={t('landing.field.alt')} className="aspect-[4/3] w-full rounded-[28px] object-cover" />
              <figure className="absolute bottom-0 right-3 w-[min(340px,88%)] rounded-3xl bg-white p-4 text-ink shadow-[0_18px_40px_rgba(0,0,0,0.28)]">
                <figcaption className="mb-2 text-[13px] font-bold">{t('landing.field.shcCaption')}</figcaption>
                <table className="w-full text-[13px] tabular-nums">
                  <thead>
                    <tr className="text-ink-muted">
                      <th scope="col" className="py-1 text-left font-semibold">{t('landing.field.nutrient')}</th>
                      <th scope="col" className="text-right font-semibold">{t('crop.low')}</th>
                      <th scope="col" className="text-right font-semibold">{t('crop.medium')}</th>
                      <th scope="col" className="text-right font-semibold">{t('crop.high')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SHC_ROWS.map(([k, lo, mid, hi]) => (
                      <tr key={k} className="border-t border-line">
                        <th scope="row" className="py-1.5 text-left font-semibold">{t(`nutrients.${k}`)}</th>
                        <td className="text-right">{lo}%</td><td className="text-right">{mid}%</td><td className="text-right">{hi}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </figure>
            </div>
          </div>
        </section>

        {/* Languages */}
        <section id="languages" className="mx-auto flex max-w-7xl scroll-mt-20 flex-col gap-12 px-4 py-16 sm:px-6 lg:flex-row lg:items-center lg:py-20">
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <Eyebrow>{t('landing.languages.eyebrow')}</Eyebrow>
            <h2 className={sectionTitle}>{t('landing.languages.title')}</h2>
            <p className="text-lg leading-relaxed text-ink-soft">{t('landing.languages.lead')}</p>
            <ul className="flex flex-wrap gap-2.5">
              {LANGUAGES.map((l, i) => (
                <li key={l.code} lang={l.code} className={`rounded-full px-4 py-2.5 font-semibold ${i === 1 ? 'bg-brand-700 text-white' : 'border border-line-strong bg-white'}`}>{l.native}</li>
              ))}
            </ul>
          </div>
          <figure lang="hi" aria-label={t('landing.languages.sampleLabel')} className="flex min-w-0 flex-1 flex-col gap-3.5 rounded-[28px] border border-line bg-white p-5 shadow-[0_12px_32px_rgba(16,38,27,0.08)] sm:p-6">
            <p className="max-w-[85%] self-end rounded-[18px] rounded-br-md bg-brand-700 px-4 py-3 leading-relaxed text-white">मेरी मिट्टी में N 90, P 42, K 43 और pH 6.5 है। कौन सी फसल लगाऊं?</p>
            <div className="flex max-w-[90%] flex-col gap-2.5 self-start rounded-[18px] rounded-bl-md bg-brand-50 px-4 py-3.5 leading-relaxed">
              <p>आपकी मिट्टी और ख़रीफ़ मौसम के लिए <b>धान (Rice)</b> सबसे अच्छी फसल है।</p>
              <p className="flex flex-wrap gap-1.5 text-[13px] font-semibold">
                <span className="rounded-full bg-brand-100 px-2.5 py-1 text-brand-900">मिट्टी मेल 98%</span>
                <span className="rounded-full bg-soil-50 px-2.5 py-1 text-soil-800">मौसम 100%</span>
                <span className="rounded-full bg-sky-100 px-2.5 py-1 text-sky-900">बारिश 90%</span>
              </p>
              <p className="text-sm text-ink-soft">अगले कदम: बीज उपचार करें, और खेत की मेड़ मज़बूत रखें।</p>
            </div>
            <Link to={user ? '/chat' : '/register'} className="flex min-h-14 items-center gap-2 rounded-2xl border border-line-strong py-1.5 pl-4 pr-1.5 text-ink-muted hover:border-brand-700">
              <span className="flex-1">अपना सवाल लिखें…</span>
              <span className="grid size-11 place-items-center rounded-xl bg-brand-100 text-brand-900"><Mic className="size-5" aria-hidden /></span>
              <span className="grid size-11 place-items-center rounded-xl bg-brand-700 text-white"><ArrowRight className="size-5" aria-hidden /></span>
            </Link>
          </figure>
        </section>

        {/* Leaf check */}
        <section className="border-y border-line bg-white">
          <div className="mx-auto flex max-w-7xl flex-col-reverse gap-12 px-4 py-16 sm:px-6 lg:flex-row lg:items-center lg:py-20">
            <div className="relative min-w-0 flex-1">
              <Photo name="tomato-septoria" alt={t('landing.leaf.alt')} className="aspect-[16/10] w-full rounded-[28px] object-cover" />
              <div className="absolute bottom-4 left-4 flex flex-col gap-1 rounded-2xl bg-white px-4 py-3.5 shadow-[0_12px_28px_rgba(16,38,27,0.2)]">
                <span className="text-xs text-ink-muted">{t('landing.leaf.example')}</span>
                <span className="font-display text-[17px] font-bold">{t('landing.leaf.exampleName')}</span>
                <span className="text-[13px] font-semibold text-brand-900">{t('landing.leaf.exampleConf')}</span>
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-5">
              <Eyebrow>{t('landing.leaf.eyebrow')}</Eyebrow>
              <h2 className={sectionTitle}>{t('landing.leaf.title')}</h2>
              <p className="text-lg leading-relaxed text-ink-soft">{t('landing.leaf.lead')}</p>
              <ul className="flex flex-col gap-2.5 text-[15px] text-ink-soft">
                {['p1', 'p2', 'p3'].map((k) => (
                  <li key={k} className="flex items-start gap-2.5"><Check className="mt-0.5 size-5 shrink-0 text-brand-700" strokeWidth={2.4} aria-hidden />{t(`landing.leaf.${k}`)}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section id="start" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="relative flex min-h-[340px] items-center overflow-hidden rounded-[32px]">
            <Photo name="terraces-sikkim" alt="" sizes="100vw" className="absolute inset-0 size-full object-cover" />
            <div className="absolute inset-0 bg-brand-950/65" />
            <div className="relative flex max-w-2xl flex-col gap-5 p-6 text-white sm:p-12 lg:px-16">
              <h2 className={sectionTitle}>{t('landing.cta.title')}</h2>
              <p className="text-lg text-brand-50">{t('landing.cta.lead')}</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link to={startTo} className="inline-flex min-h-13 items-center justify-center rounded-2xl bg-white px-6 text-lg font-bold text-brand-900 hover:bg-brand-50">
                  {user ? t('landing.nav.dashboard') : t('landing.cta.create')}
                </Link>
                {!user && (
                  <Link to="/login" className="inline-flex min-h-13 items-center justify-center rounded-2xl border border-white/60 px-6 text-lg font-bold text-white hover:bg-white/10">{t('landing.cta.login')}</Link>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-brand-950 text-[#cfe2d4]">
        <div className="mx-auto flex max-w-7xl flex-col gap-7 px-4 pb-9 pt-12 sm:px-6">
          <div className="flex flex-wrap justify-between gap-8">
            <div className="flex max-w-sm flex-col gap-2.5">
              <span className="flex items-center gap-2.5 font-display text-xl font-extrabold text-white"><LogoMark className="size-9" inverse />{t('app.name')}</span>
              <span className="text-sm leading-relaxed">{t('landing.footer.tagline')}</span>
            </div>
            <div className="flex flex-wrap gap-10 text-sm">
              <div className="flex flex-col gap-2">
                <span className="font-bold text-white">{t('landing.footer.tools')}</span>
                <a href="#features" className="hover:text-white">{t('nav.crop')}</a>
                <a href="#features" className="hover:text-white">{t('nav.fertilizer')}</a>
                <a href="#features" className="hover:text-white">{t('nav.disease')}</a>
              </div>
              <div className="flex flex-col gap-2">
                <span className="font-bold text-white">{t('landing.footer.help')}</span>
                <a href="#how" className="hover:text-white">{t('landing.nav.how')}</a>
                <a href="#languages" className="hover:text-white">{t('landing.nav.languages')}</a>
              </div>
            </div>
          </div>
          <p className="flex gap-2.5 rounded-2xl bg-white/5 px-4 py-3.5 text-[13px] leading-relaxed">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />{t('landing.footer.disclaimer')}
          </p>
          <p lang="en" className="text-xs leading-relaxed text-[#a9c4b1]">{t('landing.footer.credits')}</p>
        </div>
      </footer>
    </div>
  );
}
