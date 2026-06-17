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
