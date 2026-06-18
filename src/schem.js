// Sponge Schematic v3 (.schem) の解釈・回転・再シリアライズ。
import { parse, write, gunzip, gzip, TAG } from './nbt.js';

// --- varint ---
function decodeVarints(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    let value = 0, shift = 0, b;
    do {
      b = bytes[i++];
      value |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    out.push(value >>> 0);
  }
  return out;
}
function encodeVarints(values) {
  const out = [];
  for (let v of values) {
    v = v >>> 0;
    do {
      let b = v & 0x7f;
      v >>>= 7;
      if (v !== 0) b |= 0x80;
      out.push(b);
    } while (v !== 0);
  }
  return new Uint8Array(out);
}

// --- block state 文字列の分解/再構築 ---
// "minecraft:oak_stairs[facing=north,half=bottom]" -> {name, props}
export function splitState(str) {
  const i = str.indexOf('[');
  if (i < 0) return { name: str, props: {} };
  const name = str.slice(0, i);
  const inner = str.slice(i + 1, str.lastIndexOf(']'));
  const props = {};
  for (const part of inner.split(',')) {
    const eq = part.indexOf('=');
    props[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return { name, props };
}
export function joinState(name, props) {
  const keys = Object.keys(props).sort();
  if (keys.length === 0) return name;
  return name + '[' + keys.map(k => k + '=' + props[k]).join(',') + ']';
}

// --- 方角の 90° 時計回り（上から見て N->E->S->W） ---
const CW = { north: 'east', east: 'south', south: 'west', west: 'north' };
function rotFacing(d) { return CW[d] || d; }

// エンティティ(額縁/絵画)の向き 0-5(down,up,north,south,west,east) を確定する。
// 額縁は Facing(大文字, 3D Direction byte 0-5) を使う（Rotation は [null,null] で空のことが多い）。
// 絵画は facing(小文字)+Rotation(yaw,pitch) を使う。下記の優先順で確定。
// MC yaw: 0=南(+z),90=西(-x),180=北(-z),270=東(+x) / pitch: -90=上,+90=下。
export function entityFacing(data) {
  if (!data) return 2;
  // 1) 額縁の Facing(大文字, 3D Direction)
  const F = data.Facing && data.Facing.value;
  if (typeof F === 'number') return F;
  // 2) 有効な Rotation[yaw,pitch]（絵画など）
  const rt = data.Rotation && data.Rotation.value;
  const items = rt && (rt.items || rt);
  if (items && items.length >= 2 && items[0] != null && items[1] != null) {
    const yaw = Number(items[0]), pitch = Number(items[1]);
    if (pitch <= -45) return 1; // up
    if (pitch >= 45) return 0;  // down
    const y = ((Math.round(yaw / 90) % 4) + 4) % 4; // 0=南,1=西,2=北,3=東
    return [3, 4, 2, 5][y];
  }
  // 3) facing(小文字) byte フォールバック
  const f = data.facing && data.facing.value;
  return (typeof f === 'number') ? f : 2;
}

// ブロック状態を 90°CW 回転（times 回適用）
export function rotateBlockState(str, times) {
  let { name, props } = splitState(str);
  for (let t = 0; t < times; t++) {
    const next = {};
    // 単純 facing
    // 多方向接続 (north/east/south/west キー) を回す
    const dirKeys = ['north', 'east', 'south', 'west'];
    const hasDirSet = dirKeys.some(k => k in props);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'facing' && v in CW) {
        next.facing = rotFacing(v);
      } else if (k === 'axis') {
        next.axis = v === 'x' ? 'z' : v === 'z' ? 'x' : v;
      } else if (hasDirSet && dirKeys.includes(k)) {
        // 値はこの接続の回転先キーへ移す: new[CW[k]] = old[k]
        next[rotFacing(k)] = v;
      } else {
        next[k] = v;
      }
    }
    props = next;
  }
  return joinState(name, props);
}

// --- 読み込み ---
export async function loadSchem(arrayBuffer) {
  const raw = await gunzip(arrayBuffer);
  const root = parse(raw);
  if (!root.value.Schematic) throw new Error('Schematic タグが見つかりません (v2 は未対応)');
  const schc = root.value.Schematic.value;
  const get = (k) => schc[k] && schc[k].value;
  const width = get('Width');
  const height = get('Height');
  const length = get('Length');
  const blocksC = schc.Blocks.value;
  const paletteC = blocksC.Palette.value;
  // palette: name -> index。index 順の配列へ。
  const palette = [];
  for (const [nm, tag] of Object.entries(paletteC)) palette[tag.value] = nm;
  const indices = decodeVarints(blocksC.Data.value);
  // BlockEntities (任意)
  let blockEntities = [];
  if (blocksC.BlockEntities) blockEntities = blocksC.BlockEntities.value.items;

  // Entities (任意・額縁/絵画など)。Schematic 直下（Blocks と兄弟）。
  // Pos は schem 原点基準の double 3要素。Data に facing/Item/Rotation 等。
  let entities = [];
  if (schc.Entities) {
    entities = (schc.Entities.value.items || []).map(e => {
      const pv = e.Pos && e.Pos.value;
      const pos = pv ? (pv.items || pv) : null;
      const data = (e.Data && e.Data.value) || {};
      return {
        id: (e.Id && e.Id.value) || (e.id && e.id.value) || '',
        pos: pos ? [Number(pos[0]), Number(pos[1]), Number(pos[2])] : null,
        data,
        facing: entityFacing(data), // 0-5(down,up,north,south,west,east) を確定
      };
    });
  }

  return {
    width, height, length,
    palette,
    indices,          // index = x + z*W + y*W*L
    blockEntities,
    entities,         // [{id, pos:[x,y,z], data}]
    root,             // 元の構造（再保存時のメタ保持用）
  };
}

// idx ヘルパ
export function blockIndexAt(s, x, y, z) {
  return x + z * s.width + y * s.width * s.length;
}

// --- 90°CW 回転（times: 1..3）して新しい schem オブジェクトを返す ---
export function rotate(s, times) {
  times = ((times % 4) + 4) % 4;
  if (times === 0) return s;
  let cur = s;
  for (let t = 0; t < times; t++) cur = rotateOnce(cur);
  return cur;
}

function rotateOnce(s) {
  const W = s.width, H = s.height, L = s.length;
  const nW = L, nL = W, nH = H;
  // 新パレットを構築しつつ index を割り当て
  const newPaletteMap = new Map();
  const newPalette = [];
  const paletteRot = s.palette.map(p => rotateBlockState(p, 1));
  function idForRotated(name) {
    if (newPaletteMap.has(name)) return newPaletteMap.get(name);
    const id = newPalette.length;
    newPalette.push(name);
    newPaletteMap.set(name, id);
    return id;
  }
  const newIndices = new Array(nW * nH * nL);
  for (let y = 0; y < H; y++) {
    for (let z = 0; z < L; z++) {
      for (let x = 0; x < W; x++) {
        const oldIdx = x + z * W + y * W * L;
        const pid = s.indices[oldIdx];
        const rotName = paletteRot[pid];
        // 位置変換 CW: (x,z) -> (L-1-z, x)
        const nx = (L - 1) - z;
        const nz = x;
        const newIdx = nx + nz * nW + y * nW * nL;
        newIndices[newIdx] = idForRotated(rotName);
      }
    }
  }
  // BlockEntities の Pos を回転
  const newBE = s.blockEntities.map(be => {
    const beCopy = cloneTag(be);
    if (beCopy.Pos) {
      const p = beCopy.Pos.value; // [x,y,z]
      const ox = p[0], oy = p[1], oz = p[2];
      beCopy.Pos.value = Int32Array.from([(L - 1) - oz, oy, ox]);
    }
    return beCopy;
  });

  // Entities の位置と facing を 90°CW 回転（連続座標: nx=L-pz, nz=px）
  const FACE_CW = { 2: 5, 5: 3, 3: 4, 4: 2 }; // north→east→south→west（down/up不変）
  const newEnts = (s.entities || []).map(e => {
    const cur = (e.facing != null) ? e.facing : (e.data && e.data.facing);
    return {
      id: e.id,
      data: e.data,
      pos: e.pos ? [L - e.pos[2], e.pos[1], e.pos[0]] : e.pos,
      facing: (cur in FACE_CW) ? FACE_CW[cur] : cur, // 実効 facing（描画はこちらを優先）
    };
  });

  return {
    width: nW, height: nH, length: nL,
    palette: newPalette,
    indices: newIndices,
    blockEntities: newBE,
    entities: newEnts,
    root: s.root,
  };
}

// タグツリーの簡易ディープコピー（TypedArray/BigInt/list 対応）
function cloneTag(v) {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Int32Array) return Int32Array.from(v);
  if (v instanceof BigInt64Array) return BigInt64Array.from(v);
  if (v instanceof Uint8Array) return Uint8Array.from(v);
  if (v.__list) return { __list: true, elementType: v.elementType, items: v.items.map(cloneTag) };
  const out = Array.isArray(v) ? [] : {};
  for (const k of Object.keys(v)) out[k] = cloneTag(v[k]);
  return out;
}

// --- 再シリアライズして gzip 済み .schem (Uint8Array) を返す ---
export async function saveSchem(s) {
  // root をクローンし Schematic を上書き
  const root = cloneTag(s.root);
  const schc = root.value.Schematic.value;
  schc.Width.value = s.width;
  schc.Height.value = s.height;
  schc.Length.value = s.length;
  // Palette
  const palObj = {};
  s.palette.forEach((name, i) => { palObj[name] = { type: TAG.INT, value: i }; });
  schc.Blocks.value.Palette = { type: TAG.COMPOUND, value: palObj };
  // Data (varint)
  schc.Blocks.value.Data = { type: TAG.BYTE_ARRAY, value: encodeVarints(s.indices) };
  // BlockEntities
  if (schc.Blocks.value.BlockEntities) {
    schc.Blocks.value.BlockEntities.value.items = s.blockEntities;
  }
  const nbtBytes = write(root);
  return await gzip(nbtBytes);
}
