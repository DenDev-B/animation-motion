import type { SceneV1 } from './schema.ts';

/**
 * Время источника s для кадра t. Вне ключей скорость 1 (кадр идёт как обычно).
 * Линейная ломаная или (smooth) монотонная кубическая кривая без выбросов. Чистая функция t.
 */
export function remapTime(scene: Pick<SceneV1, 'timeRemap'>, t: number): number {
  const tr = scene.timeRemap;
  if (!tr || !tr.keys || tr.keys.length < 2) return t;
  const k = tr.keys;
  const n = k.length;
  if (t <= k[0][0]) return k[0][1] + (t - k[0][0]);
  if (t >= k[n - 1][0]) return k[n - 1][1] + (t - k[n - 1][0]);
  let i = 1;
  while (i < n - 1 && t > k[i][0]) i++;
  const [ta, sa] = k[i - 1];
  const [tb, sb] = k[i];
  const h = tb - ta;
  const u = (t - ta) / h;
  if (!tr.smooth) return sa + (sb - sa) * u;
  const d = (j: number) => (k[j + 1][1] - k[j][1]) / (k[j + 1][0] - k[j][0]);
  const slope = (j: number): number => {
    if (j === 0) return d(0);
    if (j === n - 1) return d(n - 2);
    const d0 = d(j - 1), d1 = d(j);
    if (d0 * d1 <= 0) return 0;
    const h0 = k[j][0] - k[j - 1][0], h1 = k[j + 1][0] - k[j][0];
    const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
    return (w1 + w2) / (w1 / d0 + w2 / d1);
  };
  const m0 = slope(i - 1), m1 = slope(i);
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * sa + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * sb + (u3 - u2) * h * m1;
}
