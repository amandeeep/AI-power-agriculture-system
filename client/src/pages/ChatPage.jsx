// AI chat: session sidebar, message bubbles, leaf-photo attach, voice input, typing indicator,
// and tool-result cards (crop chart, NPK chart, disease card, weather) rendered inside replies.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Bug, CloudSun, FlaskConical, Image as ImageIcon, Mic, MicOff, PanelLeft, Paperclip, Plus, SendHorizontal, Sprout, Trash2, X, Zap } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { IMAGE_TYPES, LANGUAGES } from '../lib/constants';
import { validateImage } from '../components/ImagePicker';
import Markdown from '../components/Markdown';
import CropResults from '../components/results/CropResults';
import { LocationEvidence } from '../components/LocationCropForm';
import DiseaseResults from '../components/results/DiseaseResults';
import FertilizerResults from '../components/results/FertilizerResults';
import { AlertList, CurrentWeather } from '../components/results/WeatherBlocks';
import { Badge, ErrorAlert, Spinner } from '../components/ui';

const TOOL_META = {
  recommendCrop: { icon: Sprout, title: 'crop.resultsTitle', Component: CropResults },
  recommendCropForLocation: {
    icon: Sprout, title: 'crop.resultsTitle',
    Component: ({ data, ...rest }) => <div className="space-y-3"><CropResults data={data} {...rest} />{data.soil && <LocationEvidence data={data} />}</div>,
  },
  recommendFertilizer: { icon: FlaskConical, title: 'fertilizer.plan', Component: FertilizerResults },
  detectDisease: { icon: Bug, title: 'disease.title', Component: DiseaseResults },
  getWeather: { icon: CloudSun, title: 'dashboard.weatherNow', Component: ({ data }) => <div className="space-y-3"><CurrentWeather weather={data} /><AlertList alerts={data.alerts} /></div> },
};

function ToolCard({ tool }) {
  const { t } = useTranslation();
  const meta = TOOL_META[tool.name];
  if (!meta || !tool.result) return null; // errors are explained in the reply text itself
  const { icon: Icon, title, Component } = meta;
  return (
    <div className="mt-3 rounded-xl bg-mint p-3 ring-1 ring-line">
      <p className="mb-2 flex items-center gap-2 text-sm font-bold text-ink-soft"><Icon className="size-4 text-brand-700" aria-hidden />{t(title)}</p>
      <Component data={tool.result} compact />
    </div>
  );
}

function Message({ m }) {
  const { t } = useTranslation();
  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-white shadow-sm">
          {m.localImage && <img src={m.localImage} alt={t('chat.photo')} className="mb-2 max-h-48 rounded-lg" />}
          {!m.localImage && m.attachment && (
            <p className="mb-1 flex items-center gap-1 text-sm text-brand-100"><ImageIcon className="size-4" aria-hidden />{t('chat.photo')}</p>
          )}
          {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2">
      <span className="mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700"><Bot className="size-5" aria-hidden /></span>
      <div className="min-w-0 max-w-[92%] flex-1 rounded-2xl rounded-tl-md bg-white px-4 py-3 text-ink shadow-sm ring-1 ring-black/5 sm:flex-none">
        {m.mode === 'basic' && (
          <div className="mb-2"><Badge tone="amber"><Zap className="size-3" aria-hidden />{t('common.basicMode')}</Badge></div>
        )}
        <Markdown text={m.content} />
        {(m.toolResults ?? []).map((tool, i) => <ToolCard key={`${tool.name}-${i}`} tool={tool} />)}
      </div>
    </div>
  );
}

function TypingIndicator() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 text-ink-muted" role="status" aria-live="polite">
      <span className="grid size-8 place-items-center rounded-full bg-brand-100 text-brand-700"><Bot className="size-5" aria-hidden /></span>
      <span className="flex gap-1 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-black/5" aria-hidden>
        {[0, 150, 300].map((d) => <span key={d} className="size-2 animate-bounce rounded-full bg-brand-500" style={{ animationDelay: `${d}ms` }} />)}
      </span>
      <span className="text-sm">{t('chat.typing')}</span>
    </div>
  );
}

/** Web Speech API voice input in the selected language (Chrome / Edge / Android). */
function useVoiceInput(onText) {
  const { i18n } = useTranslation();
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

  const toggle = () => {
    if (!Recognition) return;
    if (listening) return recRef.current?.stop();
    const rec = new Recognition();
    rec.lang = LANGUAGES.find((l) => l.code === i18n.resolvedLanguage)?.speech ?? 'en-IN';
    rec.interimResults = false;
    rec.onresult = (e) => onText(Array.from(e.results).map((r) => r[0].transcript).join(' '));
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };
  return { supported: Boolean(Recognition), listening, toggle };
}

export default function ChatPage() {
  const { t, i18n } = useTranslation();
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingSession, setLoadingSession] = useState(false);
  const [input, setInput] = useState('');
  const [image, setImage] = useState(null); // { file, url }
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scrollRef = useRef(null);
  const fileRef = useRef(null);
  const textRef = useRef(null);
  const voice = useVoiceInput((text) => setInput((v) => (v ? `${v} ${text}` : text)));

  const loadSessions = useCallback(async () => {
    try {
      const { data } = await api.get('/chat/sessions');
      setSessions(data.sessions);
    } catch { /* the sidebar is non-critical */ } finally {
      setSessionsLoading(false);
    }
  }, []);
  useEffect(() => { loadSessions(); }, [loadSessions]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const openSession = async (id) => {
    setDrawerOpen(false);
    if (id === activeId) return;
    setActiveId(id);
    setError('');
    setLoadingSession(true);
    try {
      const { data } = await api.get(`/chat/sessions/${id}`);
      setMessages(data.session.messages);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setLoadingSession(false);
    }
  };

  const newChat = () => {
    setActiveId(null);
    setMessages([]);
    setError('');
    setDrawerOpen(false);
    textRef.current?.focus();
  };

  const deleteSession = async (id) => {
    if (!window.confirm(t('chat.deleteConfirm'))) return;
    try {
      await api.delete(`/chat/sessions/${id}`);
      if (id === activeId) newChat();
      setSessions((s) => s.filter((x) => x.id !== id));
    } catch (err) {
      setError(errorMessage(err, t));
    }
  };

  const pickImage = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const bad = validateImage(f);
    if (bad) return setError(t(bad));
    setError('');
    setImage({ file: f, url: URL.createObjectURL(f) });
  };

  const send = async (text = input) => {
    const message = text.trim();
    if ((!message && !image) || sending) return;
    const tempId = `tmp-${Date.now()}`;
    setMessages((m) => [...m, { id: tempId, role: 'user', content: message, localImage: image?.url }]);
    setInput('');
    const sentImage = image;
    setImage(null);
    setSending(true);
    setError('');

    const form = new FormData();
    form.append('message', message);
    form.append('language', i18n.resolvedLanguage);
    if (activeId) form.append('sessionId', activeId);
    if (sentImage) form.append('image', sentImage.file);

    try {
      const { data } = await api.post('/chat', form);
      setMessages((m) => [
        ...m.map((x) => (x.id === tempId ? { ...data.userMessage, localImage: sentImage?.url } : x)),
        data.message,
      ]);
      if (!activeId) setActiveId(data.sessionId);
      loadSessions();
    } catch (err) {
      setMessages((m) => m.filter((x) => x.id !== tempId));
      setInput(message);
      if (sentImage) setImage(sentImage);
      setError(errorMessage(err, t));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 p-3">
        <h2 className="font-bold text-ink">{t('chat.sessions')}</h2>
        <button onClick={newChat} className="inline-flex min-h-11 items-center gap-1 rounded-xl bg-brand-600 px-3 font-semibold text-white">
          <Plus className="size-5" aria-hidden />{t('chat.newChat')}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {sessionsLoading ? <Spinner label={t('common.loading')} />
          : !sessions.length ? <p className="p-2 text-sm text-ink-muted">{t('chat.noSessions')}</p>
          : (
            <ul className="space-y-1">
              {sessions.map((s) => (
                <li key={s.id} className={`group flex items-center rounded-xl ${s.id === activeId ? 'bg-brand-100' : 'hover:bg-slate-100'}`}>
                  <button onClick={() => openSession(s.id)} className="min-h-12 min-w-0 flex-1 px-3 text-left">
                    <span className="block truncate font-medium text-ink">{s.title}</span>
                    <span className="text-xs text-ink-muted">{new Date(s.updatedAt).toLocaleDateString(`${i18n.resolvedLanguage}-IN`)}</span>
                  </button>
                  <button onClick={() => deleteSession(s.id)} className="grid size-11 shrink-0 place-items-center rounded-xl text-slate-400 hover:text-red-600" aria-label={t('common.delete')}>
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );

  const examples = ['crop', 'fertilizer', 'weather', 'disease'];

  return (
    <div className="flex h-[calc(100dvh-8rem-env(safe-area-inset-bottom))] min-h-0 md:h-[calc(100dvh-4rem)]">
      {/* Sidebar: fixed column on desktop, slide-over drawer on phones */}
      <aside className="hidden w-72 shrink-0 border-r border-line bg-white md:block">{sidebar}</aside>
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label={t('chat.sessions')}>
          <button className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} aria-label={t('common.close')} />
          <div className="absolute inset-y-0 left-0 w-[85%] max-w-xs bg-white shadow-xl">{sidebar}</div>
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line bg-white px-3 py-2 md:hidden">
          <button onClick={() => setDrawerOpen(true)} className="grid size-11 place-items-center rounded-xl text-ink-soft hover:bg-slate-100" aria-label={t('chat.openSessions')}>
            <PanelLeft className="size-5" />
          </button>
          <h1 className="flex-1 truncate font-bold text-brand-800">{t('chat.title')}</h1>
          <button onClick={newChat} className="grid size-11 place-items-center rounded-xl text-brand-700 hover:bg-brand-50" aria-label={t('chat.newChat')}>
            <Plus className="size-5" />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-3 sm:p-4" aria-live="polite">
          {loadingSession ? <Spinner label={t('common.loading')} />
            : !messages.length ? (
              <div className="mx-auto max-w-lg py-6 text-center">
                <Bot className="mx-auto size-12 text-brand-600" aria-hidden />
                <h2 className="mt-2 text-xl font-bold text-ink">{t('chat.emptyTitle')}</h2>
                <p className="mt-1 text-ink-soft">{t('chat.emptyHint')}</p>
                <div className="mt-4 grid gap-2">
                  {examples.map((k) => (
                    <button key={k} onClick={() => send(t(`chat.examples.${k}`))} className="min-h-12 rounded-xl bg-white px-4 py-2 text-left text-ink-soft shadow-sm ring-1 ring-black/5 hover:bg-brand-50">
                      {t(`chat.examples.${k}`)}
                    </button>
                  ))}
                </div>
              </div>
            )
            : messages.map((m) => <Message key={m.id ?? m._id} m={m} />)}
          {sending && <TypingIndicator />}
        </div>

        <div className="border-t border-line bg-white p-2 sm:p-3">
          {error && <div className="mb-2"><ErrorAlert message={error} /></div>}
          {voice.listening && <p className="mb-2 text-sm font-medium text-brand-700" role="status">{t('chat.listening')}</p>}
          {image && (
            <div className="mb-2 flex items-center gap-2">
              <img src={image.url} alt={t('chat.photo')} className="size-14 rounded-lg object-cover ring-1 ring-line" />
              <button onClick={() => setImage(null)} className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm text-ink-soft hover:bg-slate-100">
                <X className="size-4" aria-hidden />{t('chat.removeImage')}
              </button>
            </div>
          )}
          <div className="flex items-end gap-1.5">
            <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(',')} className="sr-only" onChange={pickImage} id="chat-image" />
            <label htmlFor="chat-image" className="grid size-12 shrink-0 cursor-pointer place-items-center rounded-xl text-ink-soft hover:bg-slate-100" title={t('chat.attach')}>
              <Paperclip className="size-5" aria-hidden /><span className="sr-only">{t('chat.attach')}</span>
            </label>
            {voice.supported && (
              <button onClick={voice.toggle} className={`grid size-12 shrink-0 place-items-center rounded-xl ${voice.listening ? 'bg-red-100 text-red-700' : 'text-ink-soft hover:bg-slate-100'}`} aria-label={t('chat.voice')} aria-pressed={voice.listening}>
                {voice.listening ? <MicOff className="size-5" /> : <Mic className="size-5" />}
              </button>
            )}
            <label htmlFor="chat-input" className="sr-only">{t('chat.placeholder')}</label>
            <textarea
              id="chat-input"
              ref={textRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t('chat.placeholder')}
              className="max-h-32 min-h-12 flex-1 resize-none rounded-xl border border-line-strong px-3 py-3 text-base focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
            <button onClick={() => send()} disabled={sending || (!input.trim() && !image)} className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-600 text-white disabled:bg-brand-600/40" aria-label={t('chat.send')}>
              <SendHorizontal className="size-5" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
