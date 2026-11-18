// react-i18next setup: 5 languages, persisted choice, <html lang> kept in sync.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import hi from './locales/hi.json';
import te from './locales/te.json';
import ta from './locales/ta.json';
import kn from './locales/kn.json';
import { LANGUAGE_CODES } from '../lib/constants';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, hi: { translation: hi }, te: { translation: te }, ta: { translation: ta }, kn: { translation: kn } },
    supportedLngs: LANGUAGE_CODES,
    nonExplicitSupportedLngs: true, // "hi-IN" -> "hi"
    fallbackLng: 'en',
    interpolation: { escapeValue: false }, // React already escapes
    detection: { order: ['localStorage', 'navigator'], lookupLocalStorage: 'agri.lang', caches: ['localStorage'] },
  });

const syncHtmlLang = (lng) => document.documentElement.setAttribute('lang', lng);
syncHtmlLang(i18n.resolvedLanguage || 'en');
i18n.on('languageChanged', syncHtmlLang);

export default i18n;
