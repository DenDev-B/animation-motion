// Все строки интерфейса редактора теперь в editor/i18n (en по умолчанию, ru вторым).
// EDITOR_STRINGS — текущие строки по активному языку (getLang/setLang в i18n/index.ts).
// Прокси всегда отдаёт актуальные строки: смена языка перерисовывает интерфейс без перезагрузки.
// Ре-экспорт оставлен, чтобы существующие места использования менялись минимально.

import { strings, type Lang } from './i18n/index.ts';

export const EDITOR_STRINGS: ReturnType<typeof strings> = new Proxy({} as ReturnType<typeof strings>, {
  get: (_, prop) => strings()[prop as keyof ReturnType<typeof strings>],
});

export type { Lang };
