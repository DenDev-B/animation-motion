export type SpecType = 'number' | 'int' | 'bool' | 'string' | 'color' | 'enum' | 'array' | 'object';

export interface FieldSpec {
  name: string;
  type: SpecType;
  min?: number;
  exclusiveMin?: boolean;
  max?: number;
  default?: unknown;
  values?: readonly string[];
  description: string;
}

export interface KindSpec {
  description: string;
  params: readonly FieldSpec[];
}

export const EASES = ['sine', 'inOut', 'out', 'lin'] as const;
export const PALETTE_SLOTS = ['sky', 'sun', 'haze', 'far', 'mid', 'near', 'whale', 'belly', 'rim', 'cloudLight', 'cloudShadow', 'window'] as const;
export const KIND_NAMES = ['sky', 'glow', 'cloud', 'skyline', 'mountains', 'hills', 'stars', 'rain', 'snow', 'birds', 'asset', 'shape'] as const;

export const SCENE_SPEC = {
  fields: [
    { name: 'version', type: 'int', min: 1, max: 1, default: 1, description: 'Версия формата сцены.' },
    { name: 'title', type: 'string', description: 'Название сцены.' },
    { name: 'duration', type: 'number', min: 0, exclusiveMin: true, description: 'Длительность в секундах; должна быть больше нуля.' },
    { name: 'palette', type: 'object', description: 'Цветовые слоты сцены.' },
    { name: 'style', type: 'object', default: {}, description: 'Эффекты изображения.' },
    { name: 'camera', type: 'object', description: 'Ключи движения камеры.' },
    { name: 'assets', type: 'object', description: 'Встроенные модели каталога.' },
    { name: 'layers', type: 'array', description: 'Слои сцены в порядке от дальнего к ближнему.' },
  ] as const,
  style: [
    { name: 'grain', type: 'number', min: 0, max: 1, default: 0, description: 'Интенсивность зерна.' },
    { name: 'vignette', type: 'number', min: 0, max: 1, default: 0, description: 'Интенсивность виньетки.' },
    { name: 'preset', type: 'string', description: 'Свободная метка; рендер её не читает.' },
  ] as const,
  camera: [
    { name: 'verticalFit', type: 'number', default: 0.52, description: 'Дополнительный масштаб вертикального кадра.' },
    { name: 'keys', type: 'array', description: 'Ключи {t, x, y, zoom}; t в секундах, zoom > 0.' },
  ] as const,
  palette: [
    { name: 'sky', type: 'array', min: 2, description: 'Массив минимум из двух цветов градиента.' },
    ...PALETTE_SLOTS.filter((slot) => slot !== 'sky').map((name) => ({ name, type: 'color' as const, description: `Цветовой слот ${name}.` })),
  ],
  layer: [
    { name: 'id', type: 'string', description: 'Уникальный id слоя.' },
    { name: 'name', type: 'string', description: 'Название слоя.' },
    { name: 'depth', type: 'number', description: 'Глубина параллакса.' },
    { name: 'visible', type: 'bool', description: 'Видимость слоя.' },
    { name: 'objects', type: 'array', description: 'Объекты слоя.' },
  ] as const,
  object: [
    { name: 'id', type: 'string', description: 'Уникальный id объекта.' },
    { name: 'name', type: 'string', description: 'Название объекта.' },
    { name: 'kind', type: 'enum', values: KIND_NAMES, description: 'Тип объекта.' },
    { name: 'x', type: 'number', default: 0, description: 'Координата X.' },
    { name: 'y', type: 'number', default: 0, description: 'Координата Y.' },
    { name: 's', type: 'number', min: 0, exclusiveMin: true, default: 1, description: 'Масштаб объекта; должен быть больше нуля.' },
    { name: 'rot', type: 'number', default: 0, description: 'Поворот в градусах.' },
    { name: 'alpha', type: 'number', min: 0, max: 1, default: 1, description: 'Непрозрачность.' },
    { name: 'color', type: 'color', description: 'Цветовой слот или hex.' },
    { name: 'asset', type: 'string', description: 'Id модели для kind asset.' },
    { name: 'params', type: 'object', description: 'Параметры выбранного kind.' },
    { name: 'anim', type: 'array', description: 'Детерминированные анимации объекта.' },
    { name: 'partAnim', type: 'object', description: 'Анимации частей модели по id.' },
  ] as const,
} as const;

export const KIND_SPEC: Record<typeof KIND_NAMES[number], KindSpec> = {
  sky: { description: 'Градиентный фон из palette.sky.', params: [] },
  glow: { description: 'Мягкое свечение вокруг центра объекта.', params: [
    { name: 'r', type: 'number', min: 0, exclusiveMin: true, default: 300, description: 'Радиус свечения (> 0).' },
    { name: 'color', type: 'color', default: 'sun', description: 'Цвет свечения.' },
    { name: 'a', type: 'number', min: 0, max: 1, default: 0.8, description: 'Непрозрачность центра.' },
  ] },
  cloud: { description: 'Детерминированное облако из округлых масс.', params: [
    { name: 'w', type: 'number', min: 0, exclusiveMin: true, default: 400, description: 'Ширина облака (> 0).' },
    { name: 'h', type: 'number', min: 0, exclusiveMin: true, default: 140, description: 'Высота облака (> 0).' },
    { name: 'puffs', type: 'int', min: 1, default: 9, description: 'Число округлых масс.' },
    { name: 'seed', type: 'int', default: 1, description: 'Seed геометрии.' },
    { name: 'lit', type: 'color', default: 'cloudLight', description: 'Цвет освещённой части.' },
    { name: 'shade', type: 'color', default: 'cloudShadow', description: 'Цвет теневой части.' },
    { name: 'haze', type: 'number', min: 0, max: 1, default: 0, description: 'Доля смешения с цветом haze.' },
  ] },
  skyline: { description: 'Детерминированный силуэт города.', params: [
    { name: 'w', type: 'number', min: 0, exclusiveMin: true, default: 2400, description: 'Общая ширина застройки (> 0).' },
    { name: 'minW', type: 'number', min: 0, exclusiveMin: true, default: 44, description: 'Минимальная ширина здания (> 0).' },
    { name: 'maxW', type: 'number', min: 0, exclusiveMin: true, default: 110, description: 'Максимальная ширина здания (> 0).' },
    { name: 'minH', type: 'number', min: 0, default: 80, description: 'Минимальная высота здания.' },
    { name: 'maxH', type: 'number', min: 0, default: 300, description: 'Максимальная высота здания.' },
    { name: 'seed', type: 'int', default: 1, description: 'Seed геометрии.' },
    { name: 'lit', type: 'number', min: 0, max: 1, default: 0, description: 'Вероятность освещённого окна.' },
    { name: 'windows', type: 'bool', default: true, description: 'Показывать окна; false отключает их.' },
    { name: 'haze', type: 'number', min: 0, max: 1, default: 0, description: 'Доля смешения с цветом haze.' },
  ] },
  asset: { description: 'Модель из scene.assets или catalog/.', params: [] },
  mountains: { description: 'Детерминированный горный хребет одним замкнутым контуром.', params: [
    { name: 'w', type: 'number', min: 0, exclusiveMin: true, default: 2400, description: 'Ширина хребта (> 0).' },
    { name: 'minH', type: 'number', min: 0, default: 60, description: 'Минимальная высота вершины.' },
    { name: 'maxH', type: 'number', min: 0, default: 260, description: 'Максимальная высота вершины.' },
    { name: 'peaks', type: 'int', min: 3, max: 40, default: 8, description: 'Число вершин.' },
    { name: 'rough', type: 'number', min: 0, max: 1, default: 0.5, description: 'Неровность склонов и седловин.' },
    { name: 'seed', type: 'int', default: 1, description: 'Seed геометрии.' },
    { name: 'color', type: 'color', default: 'far', description: 'Цвет склонов: слот палитры или hex.' },
    { name: 'haze', type: 'number', min: 0, max: 1, default: 0, description: 'Доля смешения с цветом haze.' },
    { name: 'snow', type: 'number', min: 0, max: 1, default: 0, description: 'Доля снежной шапки у вершин.' },
  ] },
  hills: { description: 'Детерминированные пологие холмы одним замкнутым контуром.', params: [
    { name: 'w', type: 'number', min: 0, exclusiveMin: true, default: 2400, description: 'Ширина гряды (> 0).' },
    { name: 'amp', type: 'number', min: 10, max: 200, default: 60, description: 'Амплитуда холмов.' },
    { name: 'waves', type: 'int', min: 1, max: 8, default: 3, description: 'Число наложенных волн.' },
    { name: 'seed', type: 'int', default: 1, description: 'Seed геометрии.' },
    { name: 'color', type: 'color', default: 'mid', description: 'Цвет холмов: слот палитры или hex.' },
    { name: 'haze', type: 'number', min: 0, max: 1, default: 0, description: 'Доля смешения с цветом haze.' },
  ] },
  stars: { description: 'Детерминированное звёздное поле с мерцанием.', params: [
    { name: 'w', type: 'number', min: 0, exclusiveMin: true, default: 2400, description: 'Ширина области (> 0).' },
    { name: 'h', type: 'number', min: 0, exclusiveMin: true, default: 1000, description: 'Высота области (> 0).' },
    { name: 'count', type: 'int', min: 1, max: 2000, default: 300, description: 'Число звёзд.' },
    { name: 'seed', type: 'int', default: 1, description: 'Seed расположения звёзд.' },
    { name: 'minR', type: 'number', min: 0.5, max: 4, default: 0.8, description: 'Минимальный радиус звезды.' },
    { name: 'maxR', type: 'number', min: 0.5, max: 4, default: 2.2, description: 'Максимальный радиус звезды.' },
    { name: 'twinkle', type: 'number', min: 0, max: 1, default: 0.3, description: 'Интенсивность мерцания.' },
    { name: 'color', type: 'color', default: '#fff6d5', description: 'Цвет звёзд: слот палитры или hex.' },
    { name: 'bias', type: 'number', min: 0, max: 1, default: 0.5, description: 'Смещение звёзд к верху области.' },
  ] },
  shape: { description: 'Модель прямо в scene (params.model). Рендерится через drawAsset.', params: [
    { name: 'model', type: 'object', description: 'Модель в формате CatalogAsset (bounds, parts). id/name/version необязательны.' },
  ] },
  rain: { description: 'Детерминированный дождь: чистые частицы без состояния между кадрами.', params: [
    { name: 'w', type: 'number', min: 0, exclusiveMin: true, default: 1600, description: 'Ширина области (> 0).' },
    { name: 'h', type: 'number', min: 0, exclusiveMin: true, default: 1000, description: 'Высота области (> 0).' },
    { name: 'count', type: 'int', min: 1, max: 3000, default: 600, description: 'Число капель.' },
    { name: 'seed', type: 'int', default: 1, description: 'Seed начальных параметров.' },
    { name: 'speed', type: 'number', min: 200, max: 3000, default: 1400, description: 'Скорость падения, единиц в секунду.' },
    { name: 'angle', type: 'number', min: -45, max: 45, default: 12, description: 'Наклон дождя в градусах.' },
    { name: 'len', type: 'number', min: 6, max: 80, default: 28, description: 'Длина штриха капли.' },
    { name: 'width', type: 'number', min: 0.5, max: 4, default: 1.5, description: 'Толщина штриха.' },
    { name: 'alpha', type: 'number', min: 0, max: 1, default: 0.5, description: 'Непрозрачность дождя.' },
    { name: 'color', type: 'color', default: '#dce8ff', description: 'Цвет капель: слот палитры или hex.' },
  ] },
  snow: { description: 'Детерминированный снег: чистые частицы без состояния между кадрами.', params: [
    { name: 'w', type: 'number', min: 0, exclusiveMin: true, default: 1600, description: 'Ширина области (> 0).' },
    { name: 'h', type: 'number', min: 0, exclusiveMin: true, default: 1000, description: 'Высота области (> 0).' },
    { name: 'count', type: 'int', min: 1, max: 2000, default: 400, description: 'Число снежинок.' },
    { name: 'seed', type: 'int', default: 1, description: 'Seed начальных параметров.' },
    { name: 'speed', type: 'number', min: 20, max: 400, default: 90, description: 'Скорость падения, единиц в секунду.' },
    { name: 'drift', type: 'number', min: 0, max: 200, default: 40, description: 'Амплитуда бокового качания.' },
    { name: 'minR', type: 'number', min: 0.8, max: 6, default: 1.5, description: 'Минимальный радиус снежинки.' },
    { name: 'maxR', type: 'number', min: 0.8, max: 6, default: 3.5, description: 'Максимальный радиус снежинки.' },
    { name: 'alpha', type: 'number', min: 0, max: 1, default: 0.8, description: 'Непрозрачность снега.' },
    { name: 'color', type: 'color', default: '#ffffff', description: 'Цвет снежинок: слот палитры или hex.' },
  ] },
  birds: { description: 'Детерминированная стая птиц: «галочки» с взмахом крыльев.', params: [
    { name: 'count', type: 'int', min: 1, max: 60, default: 8, description: 'Число птиц.' },
    { name: 'seed', type: 'int', default: 1, description: 'Seed расположения стаи.' },
    { name: 'spread', type: 'number', min: 50, max: 800, default: 260, description: 'Разброс стаи.' },
    { name: 'size', type: 'number', min: 4, max: 60, default: 18, description: 'Размер птицы.' },
    { name: 'flap', type: 'number', min: 0.2, max: 3, default: 0.8, description: 'Период взмаха крыльев в секундах.' },
    { name: 'speed', type: 'number', default: 120, description: 'Скорость полёта стаи, единиц в секунду.' },
    { name: 'dir', type: 'number', description: 'Направление: -1 влево, 1 вправо.' },
    { name: 'bob', type: 'number', min: 0, max: 40, default: 12, description: 'Амплитуда покачивания птицы.' },
    { name: 'color', type: 'color', default: '#2b2b33', description: 'Цвет птиц: слот палитры или hex.' },
  ] },
};

export const ANIM_SPEC: Record<string, readonly FieldSpec[]> = {
  move: [
    { name: 'from', type: 'array', description: 'Начальное смещение [x, y].' },
    { name: 'to', type: 'array', description: 'Конечное смещение [x, y].' },
    { name: 't0', type: 'number', min: 0, description: 'Начало в секундах.' },
    { name: 't1', type: 'number', min: 0, description: 'Конец в секундах.' },
    { name: 'ease', type: 'enum', values: EASES, default: 'sine', description: 'Функция сглаживания.' },
  ],
  drift: [
    { name: 'vx', type: 'number', default: 0, description: 'Скорость по X.' },
    { name: 'vy', type: 'number', default: 0, description: 'Скорость по Y.' },
  ],
  bob: [
    { name: 'amp', type: 'number', default: 0, description: 'Амплитуда вертикального движения.' },
    { name: 'period', type: 'number', min: 0, exclusiveMin: true, default: 4, description: 'Период в секундах; должен быть больше нуля.' },
    { name: 'phase', type: 'number', default: 0, description: 'Фаза цикла.' },
  ],
  swing: [
    { name: 'amp', type: 'number', default: 0, description: 'Амплитуда угла в радианах.' },
    { name: 'period', type: 'number', min: 0, exclusiveMin: true, default: 4, description: 'Период в секундах; должен быть больше нуля.' },
    { name: 'phase', type: 'number', default: 0, description: 'Фаза цикла.' },
  ],
  pulse: [
    { name: 'amp', type: 'number', default: 0, description: 'Амплитуда изменения масштаба.' },
    { name: 'period', type: 'number', min: 0, exclusiveMin: true, default: 4, description: 'Период в секундах; должен быть больше нуля.' },
  ],
  fade: [
    { name: 'from', type: 'number', min: 0, max: 1, default: 1, description: 'Начальная непрозрачность.' },
    { name: 'to', type: 'number', min: 0, max: 1, default: 0, description: 'Конечная непрозрачность.' },
    { name: 't0', type: 'number', min: 0, description: 'Начало в секундах.' },
    { name: 't1', type: 'number', min: 0, description: 'Конец в секундах.' },
  ],
};

export const TRANSITION_TYPES = ['cut', 'fade', 'crossfade', 'slide', 'wipe', 'dip'] as const;
export const TRANSITION_DIRS = ['left', 'right', 'up', 'down'] as const;

export const TRANSITION_SPEC: readonly FieldSpec[] = [
  { name: 'type', type: 'enum', values: TRANSITION_TYPES, default: 'cut', description: 'Тип перехода между соседними сценами.' },
  { name: 'duration', type: 'number', min: 0, description: 'Длина наложения в секундах; для cut игнорируется.' },
  { name: 'dir', type: 'enum', values: TRANSITION_DIRS, default: 'left', description: 'Направление для slide и wipe.' },
  { name: 'color', type: 'color', default: '#000', description: 'Цвет для fade и dip.' },
];

export const SPEC_KEYS = {
  scene: SCENE_SPEC.fields.map(({ name }) => name),
  layer: SCENE_SPEC.layer.map(({ name }) => name),
  object: SCENE_SPEC.object.map(({ name }) => name),
  style: SCENE_SPEC.style.map(({ name }) => name),
  camera: SCENE_SPEC.camera.map(({ name }) => name),
  animation: ['type', ...new Set(Object.values(ANIM_SPEC).flatMap((fields) => fields.map(({ name }) => name)))],
} as const;
