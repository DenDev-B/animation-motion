// Контракт адаптера озвучки: проверить, что адаптер доступен на этой машине, и сделать wav из текста.
// Режим «file» (владелец сам положил запись в audio/ и указал voice.file) адаптером не является.

export type TtsAdapterId = 'piper' | 'sapi' | 'fake';

export interface TtsOptions {
  /** Желаемый язык голоса: 'ru', 'uk', 'en'. */
  lang?: string;
}

export interface TtsDetectResult {
  ok: boolean;
  /** Причина по-русски: почему адаптер сейчас использовать нельзя. */
  reason?: string;
}

export interface TtsAdapter {
  id: TtsAdapterId;
  label: string;
  /** Тестовые адаптеры не показываются человеку в `npm run tts:doctor`. */
  hidden?: boolean;
  detect(): Promise<TtsDetectResult>;
  /** Имя модели/голоса — входит в ключ кэша wav: сменил голос, получил новый файл. */
  voiceId(opts?: TtsOptions): Promise<string>;
  /** Записать синтез текста в WAV по пути outWav. */
  synthesize(text: string, outWav: string, opts?: TtsOptions): Promise<void>;
}
