// Реестр адаптеров озвучки. Порядок списка — это и порядок автовыбора, когда адаптер не указан флагом.
import { fakeAdapter } from './fake.ts';
import { piperAdapter } from './piper.ts';
import { sapiAdapter } from './sapi.ts';
import type { TtsAdapter, TtsDetectResult } from './types.ts';

export type { TtsAdapter, TtsAdapterId, TtsDetectResult, TtsOptions } from './types.ts';
export { fakeAdapter } from './fake.ts';
export { piperAdapter } from './piper.ts';
export { sapiAdapter } from './sapi.ts';

export const TTS_ADAPTERS: readonly TtsAdapter[] = [piperAdapter, sapiAdapter, fakeAdapter];

export function getTtsAdapter(id: string): TtsAdapter | undefined {
  return TTS_ADAPTERS.find((adapter) => adapter.id === id);
}

/** То, что показываем человеку: тестовый адаптер скрыт. */
export function visibleTtsAdapters(): TtsAdapter[] {
  return TTS_ADAPTERS.filter((adapter) => !adapter.hidden);
}

export interface TtsDiagnosis {
  adapter: TtsAdapter;
  result: TtsDetectResult;
}

export async function diagnoseAdapters(): Promise<TtsDiagnosis[]> {
  const list: TtsDiagnosis[] = [];
  for (const adapter of visibleTtsAdapters()) list.push({ adapter, result: await adapter.detect() });
  return list;
}

/** Первый доступный адаптер либо список причин, почему не доступен ни один. */
export async function firstAvailableAdapter(): Promise<{ adapter: TtsAdapter | null; reasons: string[] }> {
  const reasons: string[] = [];
  for (const adapter of visibleTtsAdapters()) {
    const result = await adapter.detect();
    if (result.ok) return { adapter, reasons };
    reasons.push(`${adapter.label}: ${result.reason ?? 'недоступен'}`);
  }
  return { adapter: null, reasons };
}
