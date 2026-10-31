// Пресеты стиля ролика: чистые данные и текстовые блоки для промтов. Без DOM и файлов.
import { PALETTE_SLOTS } from './spec.ts';

export type StyleMood = 'dawn' | 'day' | 'dusk' | 'night';
export const STYLE_MOODS: readonly StyleMood[] = ['dawn', 'day', 'dusk', 'night'];

type PaletteColorSlot = Exclude<typeof PALETTE_SLOTS[number], 'sky'>;

export type StylePalette = { sky: string[] } & Partial<Record<PaletteColorSlot, string>>;

export interface StylePreset {
  id: string;
  name: string;
  description: string;
  grain: number;
  vignette: number;
  atmosphere: string;
  palettes: Record<StyleMood, StylePalette>;
}

export const STYLE_PRESETS: readonly StylePreset[] = [
  {
    id: 'warm-dusk',
    name: 'Тёплый закат',
    description: 'Низкое солнце, длинные мягкие тени и медовый свет на всём кадре. Спокойное, немного ностальгическое настроение: будто последние минуты хорошего дня. Подходит для истории о доме, дороге и тихом чуде.',
    grain: 0.06,
    vignette: 0.22,
    atmosphere: 'Тёплая дымка у горизонта, свечение низкого солнца и редкие пылинки в воздухе; сейчас это делается слоями glow и cloud с haze, силуэты птиц — birds.',
    palettes: {
      dawn: {
        sky: ['#f3b98a', '#e98a6a', '#8c5a72'],
        sun: '#ffd7a1', haze: '#e7b39a', far: '#9a6a7a', mid: '#6f4a63', near: '#3d2b3f',
        whale: '#2c2233', belly: '#c98a7a', rim: '#ffcf9e', cloudLight: '#ffd2a8', cloudShadow: '#a96f7e', window: '#ffd79a',
      },
      day: {
        sky: ['#bfe3f2', '#8fc7e8', '#f6d8a8'],
        sun: '#fff0c2', haze: '#d8e6e8', far: '#7f9bb0', mid: '#59758c', near: '#334a5c',
        whale: '#27333f', belly: '#c9b7a5', rim: '#ffe3b0', cloudLight: '#ffffff', cloudShadow: '#b9c8d6', window: '#ffe6a8',
      },
      dusk: {
        sky: ['#ffb27a', '#e76f61', '#4b3157'],
        sun: '#ffd39a', haze: '#d98f80', far: '#8a5268', mid: '#5c3959', near: '#2a1d33',
        whale: '#1e1726', belly: '#b87a70', rim: '#ffc488', cloudLight: '#ffc79a', cloudShadow: '#8f5570', window: '#ffc46e',
      },
      night: {
        sky: ['#1d2340', '#332a4a', '#6a3e4a'],
        sun: '#ffd9a0', haze: '#4a3c50', far: '#2a2338', mid: '#1d1830', near: '#100d1c',
        whale: '#0b0914', belly: '#5c4250', rim: '#ffbf86', cloudLight: '#4a3f5a', cloudShadow: '#241d33', window: '#ffbe6a',
      },
    },
  },
  {
    id: 'cold-night',
    name: 'Холодная ночь',
    description: 'Синяя глубина, ясные звёзды и ровный морозный свет. Настроение сдержанное и просторное, как ночная дорога за городом. Хорошо работает для одиночества, поиска и тихой решимости.',
    grain: 0.05,
    vignette: 0.32,
    atmosphere: 'Ровный холодный свет, мелкие звёзды и тонкая дымка у горизонта; сейчас это делается через stars, glow вокруг луны и cloud с haze, при желании — snow.',
    palettes: {
      dawn: {
        sky: ['#8fa7c9', '#6f87b0', '#c9b8cf'],
        sun: '#e8e4f2', haze: '#a9b4cc', far: '#5d6d93', mid: '#414e72', near: '#28304a',
        whale: '#1c2236', belly: '#7d88a8', rim: '#dce4ff', cloudLight: '#d6dcf0', cloudShadow: '#7b86a6', window: '#bcd6ff',
      },
      day: {
        sky: ['#b9d9ef', '#8db9d9', '#d7e7f2'],
        sun: '#f4fbff', haze: '#c5d9e4', far: '#8297ad', mid: '#5b7088', near: '#39475c',
        whale: '#2a3342', belly: '#a7b5c6', rim: '#eaf4ff', cloudLight: '#ffffff', cloudShadow: '#aebdcd', window: '#cfe8ff',
      },
      dusk: {
        sky: ['#7b86b8', '#5a6394', '#2e3557'],
        sun: '#d9dcff', haze: '#767fa6', far: '#4a5280', mid: '#333a62', near: '#1e2340',
        whale: '#151a2e', belly: '#6a7090', rim: '#c7d0ff', cloudLight: '#8c96bd', cloudShadow: '#4b5378', window: '#a9c6ff',
      },
      night: {
        sky: ['#101a33', '#172a4d', '#28456b'],
        sun: '#e4f0ff', haze: '#2a3b57', far: '#1b2b47', mid: '#121f36', near: '#0a1222',
        whale: '#070d18', belly: '#3d4c68', rim: '#b8d6ff', cloudLight: '#33445f', cloudShadow: '#182338', window: '#9ec8ff',
      },
    },
  },
  {
    id: 'noir-fog',
    name: 'Нуар в тумане',
    description: 'Серо-графитовая гамма, контровой свет и мокрый асфальт. Настроение настороженное и взрослое, без ярких красок. Красиво в дождь, в переулках и в сценах, где герой долго идёт к цели.',
    grain: 0.09,
    vignette: 0.38,
    atmosphere: 'Плотная серая дымка, контровой свет и мелкая взвесь в воздухе; сейчас это делается через cloud и skyline с haze, glow за объектом и тонкий rain.',
    palettes: {
      dawn: {
        sky: ['#b9b6b2', '#8e8b89', '#5e5b5c'],
        sun: '#d9d4cc', haze: '#a8a5a2', far: '#76736f', mid: '#55524f', near: '#373431',
        whale: '#242220', belly: '#6f6a63', rim: '#d8d2c6', cloudLight: '#cac6c0', cloudShadow: '#7e7a75', window: '#e8dcc0',
      },
      day: {
        sky: ['#c8c6c2', '#9d9b97', '#6e6b68'],
        sun: '#f0ece4', haze: '#b7b4af', far: '#807d78', mid: '#5c5955', near: '#3b3835',
        whale: '#272523', belly: '#77726b', rim: '#e4ded2', cloudLight: '#dcd8d2', cloudShadow: '#8c8883', window: '#e2d6b8',
      },
      dusk: {
        sky: ['#8a8580', '#615c58', '#3a3633'],
        sun: '#c7bfb0', haze: '#7b7671', far: '#5b5652', mid: '#403c39', near: '#282523',
        whale: '#1b1918', belly: '#575049', rim: '#c9c0b0', cloudLight: '#8f8a84', cloudShadow: '#4c4844', window: '#d6c69e',
      },
      night: {
        sky: ['#1b1b1e', '#2a2a2e', '#3d3b3a'],
        sun: '#c6c4bd', haze: '#3a3a3d', far: '#2b2b2e', mid: '#1e1e21', near: '#121214',
        whale: '#0b0b0d', belly: '#3f3f44', rim: '#b9b7ae', cloudLight: '#45454a', cloudShadow: '#252528', window: '#c2b38c',
      },
    },
  },
  {
    id: 'candy-pop',
    name: 'Конфетный поп',
    description: 'Яркие конфетные цвета, чистый свет и глянцевые блики. Настроение лёгкое, праздничное и немного игрушечное. Подходит для музыки, рекламы и всего, что должно улыбаться с первого кадра.',
    grain: 0.03,
    vignette: 0.12,
    atmosphere: 'Чистый яркий свет без пыли, крупные облака и цветные блики; сейчас это делается через cloud с яркими cloudLight и cloudShadow, glow и максимум два цветных акцента в кадре.',
    palettes: {
      dawn: {
        sky: ['#ffd1e1', '#ffb3c9', '#c6e7ff'],
        sun: '#fff3b0', haze: '#ffd9ea', far: '#e39ac9', mid: '#b978b8', near: '#7b5aa6',
        whale: '#5a3f84', belly: '#ffc2d6', rim: '#fff1a8', cloudLight: '#ffffff', cloudShadow: '#f2a9c8', window: '#fff07a',
      },
      day: {
        sky: ['#a8e6ff', '#7fd4f7', '#ffe9a8'],
        sun: '#fff7b8', haze: '#c9f0ff', far: '#7fc4e4', mid: '#5a9fd0', near: '#3d72a6',
        whale: '#2d5488', belly: '#c2e9ff', rim: '#fff29a', cloudLight: '#ffffff', cloudShadow: '#a9d6ee', window: '#ffe86e',
      },
      dusk: {
        sky: ['#ffb3a8', '#ff8fb1', '#9a6bbd'],
        sun: '#ffe27a', haze: '#ffc2c8', far: '#cf7bb0', mid: '#9a5c9e', near: '#5f3f82',
        whale: '#432d66', belly: '#ffb3c0', rim: '#ffe887', cloudLight: '#ffd1dd', cloudShadow: '#b06a9a', window: '#ffe066',
      },
      night: {
        sky: ['#3a2d63', '#573f86', '#a2569e'],
        sun: '#ffe9a0', haze: '#5f4a86', far: '#45346f', mid: '#2f2456', near: '#1c163d',
        whale: '#140f2e', belly: '#7a5a9e', rim: '#ffd76e', cloudLight: '#6a4f96', cloudShadow: '#372a60', window: '#ffd76e',
      },
    },
  },
  {
    id: 'ink-paper',
    name: 'Чернильная бумага',
    description: 'Серо-кремовая гамма, сухая фактура и один красный акцент. Настроение собранное, почти книжное, с оттенком тревоги. Хорошо для притч, портретов и историй, где важен один яркий знак.',
    grain: 0.07,
    vignette: 0.18,
    atmosphere: 'Сухая бумажная фактура и рассеянный свет; дымку имитируй редким cloud с haze, свет — glow, а частицы — stars или snow точками. Красный акцент держи один на кадр.',
    palettes: {
      dawn: {
        sky: ['#efe8da', '#ddd3c1', '#c8bca8'],
        sun: '#c0392b', haze: '#e4dbc9', far: '#b3a894', mid: '#8c8270', near: '#5f584b',
        whale: '#3b372e', belly: '#d8cfbc', rim: '#c0392b', cloudLight: '#f5efe3', cloudShadow: '#c9bca6', window: '#c0392b',
      },
      day: {
        sky: ['#f7f2e7', '#e8dfcd', '#d6c9b2'],
        sun: '#c0392b', haze: '#eee6d6', far: '#c1b49e', mid: '#998d78', near: '#6a6252',
        whale: '#443f34', belly: '#e0d6c2', rim: '#c0392b', cloudLight: '#fffaf0', cloudShadow: '#d5c8b1', window: '#c0392b',
      },
      dusk: {
        sky: ['#d9cdb8', '#b8aa92', '#8a7c68'],
        sun: '#b83227', haze: '#cbbda6', far: '#9c8f79', mid: '#786c59', near: '#4e463a',
        whale: '#312c26', belly: '#c2b6a0', rim: '#b83227', cloudLight: '#e5d9c4', cloudShadow: '#a99b84', window: '#c0392b',
      },
      night: {
        sky: ['#3a352d', '#2a2620', '#1b1814'],
        sun: '#d24a38', haze: '#4a443a', far: '#38332c', mid: '#28241e', near: '#171511',
        whale: '#0f0e0b', belly: '#4f483d', rim: '#d24a38', cloudLight: '#4a443a', cloudShadow: '#252119', window: '#d24a38',
      },
    },
  },
  {
    id: 'pastel-dream',
    name: 'Пастельный сон',
    description: 'Мягкие пастельные переходы, много воздуха и почти нет резких контрастов. Настроение тёплое, сонное и доброе, как воспоминание из детства. Подходит для нежных историй и медленного движения.',
    grain: 0.04,
    vignette: 0.15,
    atmosphere: 'Мягкий рассеянный свет, воздушные облака и медленные частицы; сейчас это делается через glow, cloud с высоким haze, stars как искры и snow как лепестки.',
    palettes: {
      dawn: {
        sky: ['#f6d9ea', '#e3c4ec', '#c9d7f5'],
        sun: '#ffe6b8', haze: '#f0dcec', far: '#cbb6de', mid: '#a898cf', near: '#7d72b0',
        whale: '#5f578e', belly: '#efd6ea', rim: '#ffe3b0', cloudLight: '#fff4fb', cloudShadow: '#d9b7d8', window: '#ffe8b8',
      },
      day: {
        sky: ['#cfeaf7', '#b6d9f2', '#eadcf7'],
        sun: '#fff0c4', haze: '#dceaf5', far: '#b3c6e2', mid: '#93a8d0', near: '#6d80ad',
        whale: '#54648c', belly: '#d6e2f2', rim: '#ffeab5', cloudLight: '#ffffff', cloudShadow: '#c8d6ea', window: '#ffeeb8',
      },
      dusk: {
        sky: ['#f7c4d4', '#e3a8cd', '#b393cf'],
        sun: '#ffdda8', haze: '#edc3d8', far: '#c99bc4', mid: '#a37cae', near: '#76588e',
        whale: '#5a4372', belly: '#ecc7de', rim: '#ffd8a3', cloudLight: '#ffe0ea', cloudShadow: '#c79ac2', window: '#ffdda0',
      },
      night: {
        sky: ['#2f3255', '#414a74', '#6f6296'],
        sun: '#f0e6c8', haze: '#474a70', far: '#3a3f63', mid: '#2a2e4c', near: '#1b1d33',
        whale: '#121426', belly: '#555a80', rim: '#e6d6b8', cloudLight: '#525a82', cloudShadow: '#2c2f4a', window: '#f2dfae',
      },
    },
  },
];

export function getStyle(id: string | undefined): StylePreset | undefined {
  if (!id) return undefined;
  return STYLE_PRESETS.find((preset) => preset.id === id);
}

function paletteLine(mood: StyleMood, palette: StylePalette): string {
  const colors = [`sky ${palette.sky.join(' → ')}`];
  for (const slot of PALETTE_SLOTS) {
    if (slot === 'sky') continue;
    const color = palette[slot];
    if (color) colors.push(`${slot} ${color}`);
  }
  return `- ${mood}: ${colors.join('; ')}`;
}

export function styleBlock(id: string): string {
  const preset = getStyle(id);
  if (!preset) throw new Error(`Неизвестный стиль "${id}". Доступные: ${STYLE_PRESETS.map((p) => p.id).join(', ')}`);
  return [
    `Стиль «${preset.name}» (id: ${preset.id}).`,
    preset.description,
    `Зерно: ${preset.grain}. Виньетка: ${preset.vignette}.`,
    `Атмосфера: ${preset.atmosphere}`,
    'Палитры по настроению сцены:',
    ...STYLE_MOODS.map((mood) => paletteLine(mood, preset.palettes[mood])),
  ].join('\n');
}
