// ブロック名 -> 代表色（Phase1: 色キューブ用）。
// block state は無視し、ベース名でマッチする。未知のブロックはフォールバック色。
import { splitState } from './schem.js';

// ベース名(minecraft: 抜き) -> {color, opacity?}
const TABLE = {
  air: null, // 描画しない
  cave_air: null,
  void_air: null,

  stone: 0x7d7d7d,
  cobblestone: 0x828282,
  cobblestone_wall: 0x828282,
  cobblestone_slab: 0x828282,
  stone_bricks: 0x7a7a7a,
  gravel: 0x8a8580,
  dirt: 0x866043,
  grass_block: 0x6a9c3f,
  sand: 0xdbcfa0,

  oak_planks: 0xb38b4d,
  oak_log: 0x8a6f3e,
  oak_slab: 0xb38b4d,
  oak_stairs: 0xb38b4d,
  oak_door: 0x90673a,
  oak_fence: 0x9c7a45,
  oak_wall_sign: 0xa9824b,
  oak_sign: 0xa9824b,
  oak_leaves: 0x59ae30, // foliage tint（葉テクスチャに乗算）兼 色キューブ用

  birch_planks: 0xd7c890,
  birch_log: 0xd8d4cb,
  birch_stairs: 0xd7c890,
  birch_slab: 0xd7c890,

  spruce_planks: 0x7a5a35,
  dark_oak_planks: 0x4b3621,

  glass: { color: 0xbfe3ea, opacity: 0.35 },
  glass_pane: { color: 0xbfe3ea, opacity: 0.35 },
  white_stained_glass: { color: 0xffffff, opacity: 0.4 },

  chest: 0x8f6b2e,
  furnace: 0x6f6f6f,
  blast_furnace: 0x5e5e5e,
  crafting_table: 0x9c6f3c,
  anvil: 0x4a4a4a,
  ladder: 0x9c7a45,

  torch: { color: 0xffd24a, emissive: true },
  wall_torch: { color: 0xffd24a, emissive: true },
  lantern: { color: 0xffcf5a, emissive: true },
  glowstone: { color: 0xffd97a, emissive: true },

  white_bed: 0xe7e7e7,
  red_bed: 0xc0392b,
  white_wool: 0xeeeeee,

  water: { color: 0x3a6fd8, opacity: 0.5 },
  lava: { color: 0xe06010, emissive: true },
};

const FALLBACK = 0xb050d0; // 目立つ紫（未対応ブロック検出用）

// 名前 -> {color:int, opacity:number(0-1), emissive:bool}
export function blockAppearance(stateString) {
  const { name } = splitState(stateString);
  const base = name.replace(/^minecraft:/, '');
  let e = TABLE[base];
  if (e === null) return null; // air 等
  if (e === undefined) {
    // ヒューリスティック: 名前から推定
    // 空気は厳密一致で判定（"stairs" が部分文字列 "air" を含むため includes は不可）。
    if (base === 'air' || base.endsWith('_air')) return null;
    e = guess(base);
  }
  if (typeof e === 'number') return { color: e, opacity: 1, emissive: false };
  return { color: e.color, opacity: e.opacity ?? 1, emissive: !!e.emissive };
}

function guess(base) {
  if (base.includes('glass')) return { color: 0xbfe3ea, opacity: 0.35 };
  if (base.includes('leaves')) return 0x59ae30;
  // 植生 tint（grass/fern/つる等）: 草テクスチャはグレースケールでバイオーム色を乗算する。
  // プレーンズ相当の草緑を返す（tintindex 面の乗算色 兼 色キューブ用）。
  if (base.includes('grass') || base.includes('fern') || base === 'vine'
      || base.includes('sugar_cane') || base.includes('lily_pad') || base.includes('bamboo'))
    return 0x91bd59;
  if (base.includes('log') || base.includes('wood')) return 0x8a6f3e;
  if (base.includes('planks') || base.includes('stairs') || base.includes('slab') || base.includes('fence') || base.includes('door')) return 0xb38b4d;
  if (base.includes('wool')) return 0xdddddd;
  if (base.includes('stone') || base.includes('brick')) return 0x808080;
  return FALLBACK;
}

// --- バイオーム別の tint 色（草/葉/水）。代表的なバイオームの近似値。 ---
export const BIOMES = [
  { id: 'plains', label: '平原', grass: 0x91bd59, foliage: 0x77ab2f, water: 0x3f76e4 },
  { id: 'forest', label: '森林', grass: 0x79c05a, foliage: 0x59ae30, water: 0x3f76e4 },
  { id: 'birch_forest', label: '白樺の森', grass: 0x88bb67, foliage: 0x6ba941, water: 0x3f76e4 },
  { id: 'jungle', label: 'ジャングル', grass: 0x59c93c, foliage: 0x30bb0b, water: 0x3f76e4 },
  { id: 'taiga', label: 'タイガ', grass: 0x86b783, foliage: 0x68a464, water: 0x3f76e4 },
  { id: 'snowy_plains', label: '雪原', grass: 0x80b497, foliage: 0x60a17b, water: 0x3d57d6 },
  { id: 'savanna', label: 'サバンナ', grass: 0xbfb755, foliage: 0xaea42a, water: 0x3f76e4 },
  { id: 'desert', label: '砂漠', grass: 0xbfb755, foliage: 0xaea42a, water: 0x3f76e4 },
  { id: 'badlands', label: '荒野', grass: 0x90814d, foliage: 0x9e814d, water: 0x3f76e4 },
  { id: 'swamp', label: '湿地', grass: 0x6a7039, foliage: 0x6a7039, water: 0x617b64 },
  { id: 'dark_forest', label: '暗い森', grass: 0x507a32, foliage: 0x59ae30, water: 0x3f76e4 },
  { id: 'mushroom_fields', label: 'キノコ島', grass: 0x55c93f, foliage: 0x2bbb0f, water: 0x3f76e4 },
  { id: 'cherry_grove', label: '桜の林', grass: 0xb6db61, foliage: 0xb6db61, water: 0x5db7ef },
  { id: 'mangrove_swamp', label: 'マングローブ湿地', grass: 0x6a7039, foliage: 0x8db127, water: 0x3a7a6b },
];

// バイオーム非依存（固定色）の tint ブロック
const FIXED_TINT = {
  spruce_leaves: 0x619961, birch_leaves: 0x80a755, lily_pad: 0x208030,
};

// tint 対象ブロックの色を返す（非対象は null）。biomeId 未指定時は plains。
export function biomeTint(stateString, biomeId) {
  const base = stateString.replace(/^minecraft:/, '').split('[')[0];
  if (base in FIXED_TINT) return FIXED_TINT[base];
  const b = BIOMES.find(x => x.id === biomeId) || BIOMES[0];
  if (base === 'water' || base === 'bubble_column') return b.water;
  if (base.endsWith('_leaves') || base === 'vine') return b.foliage;
  if (base === 'grass_block' || base === 'short_grass' || base === 'tall_grass'
    || base === 'fern' || base === 'large_fern' || base === 'potted_fern'
    || base === 'sugar_cane' || base.endsWith('_grass')) return b.grass;
  return null;
}
