import { EDITOR_STRINGS_EN } from './en.ts';
import { EDITOR_STRINGS_RU } from './ru.ts';

// Проверка типами: ru и en имеют одинаковые ключи (структурно совместимы).
type EnStrings = typeof EDITOR_STRINGS_EN;
type RuStrings = typeof EDITOR_STRINGS_RU;
type KeysOf<T> = { [K in keyof T]: T[K] extends object ? KeysOf<T[K]> : K };
type CheckRuKeys = KeysOf<RuStrings> extends KeysOf<EnStrings>
  ? (KeysOf<EnStrings> extends KeysOf<RuStrings> ? true : 'ru keys do not match en keys')
  : 'ru keys do not match en keys';
const _check: CheckRuKeys = true;

export type Lang = 'en' | 'ru';

const STRINGS: Record<Lang, EnStrings> = {
  en: EDITOR_STRINGS_EN,
  ru: EDITOR_STRINGS_RU as unknown as EnStrings,
};

const LANG_KEY = 'am.lang';

let currentLang: Lang = 'en';

function readStoredLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === 'en' || stored === 'ru') return stored;
  } catch {}
  return 'en';
}

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  currentLang = lang;
  try { localStorage.setItem(LANG_KEY, lang); } catch {}
  const html = document.documentElement;
  if (html) html.setAttribute('lang', lang);
}

export function strings(): EnStrings {
  return STRINGS[currentLang];
}

// Инициализация при загрузке модуля: язык по умолчанию en, чтение из localStorage, атрибут lang.
currentLang = readStoredLang();
const html = document.documentElement;
if (html) html.setAttribute('lang', currentLang);
