// Minecraft アセット(blockstates/models/textures)からブロックの面テクスチャを解決し、
// three.js テクスチャをロードする。assets/<version>/ をローカル fetch する前提。
import * as THREE from 'three';
import { splitState } from './schem.js';
import { blockAppearance } from './colors.js';

const ASSET_BASE = './assets';

// 6 面の方向ベクトル
const DIRS = {
  up: [0, 1, 0], down: [0, -1, 0],
  north: [0, 0, -1], south: [0, 0, 1],
  east: [1, 0, 0], west: [-1, 0, 0],
};
const DIR_NAMES = Object.keys(DIRS);
function dirName(v) {
  for (const n of DIR_NAMES) {
    const d = DIRS[n];
    if (d[0] === v[0] && d[1] === v[1] && d[2] === v[2]) return n;
  }
  return null;
}
// 90°ステップ回転（MC blockstate の x→y 順）。MC の回転符号に合わせる
// （y: 東+x→南+z の時計回り。x も同符号の規約）。
function rotX(v, s) { let [x, y, z] = v; for (let i = 0; i < s; i++) [x, y, z] = [x, z, -y]; return [x, y, z]; }
function rotY(v, s) { let [x, y, z] = v; for (let i = 0; i < s; i++) [x, y, z] = [-z, y, x]; return [x, y, z]; }

// --- ジオメトリ焼き込み（model elements → ローカル0..16 のクアッド群） ---
// 箱(b: x1,y1,z1,x2,y2,z2)の各面の頂点（外向きCCW, v0..v3）
const FACE_VERTS = {
  west:  b => [[b.x1,b.y2,b.z1],[b.x1,b.y2,b.z2],[b.x1,b.y1,b.z2],[b.x1,b.y1,b.z1]],
  east:  b => [[b.x2,b.y2,b.z2],[b.x2,b.y2,b.z1],[b.x2,b.y1,b.z1],[b.x2,b.y1,b.z2]],
  down:  b => [[b.x1,b.y1,b.z2],[b.x2,b.y1,b.z2],[b.x2,b.y1,b.z1],[b.x1,b.y1,b.z1]],
  up:    b => [[b.x1,b.y2,b.z1],[b.x2,b.y2,b.z1],[b.x2,b.y2,b.z2],[b.x1,b.y2,b.z2]],
  north: b => [[b.x2,b.y2,b.z1],[b.x1,b.y2,b.z1],[b.x1,b.y1,b.z1],[b.x2,b.y1,b.z1]],
  south: b => [[b.x1,b.y2,b.z2],[b.x2,b.y2,b.z2],[b.x2,b.y1,b.z2],[b.x1,b.y1,b.z2]],
};
// face.uv 省略時のデフォルト(ピクセル, v上→下)
function defaultUV(dir, b) {
  switch (dir) {
    case 'down': return [b.x1, b.z1, b.x2, b.z2];
    case 'up':   return [b.x1, b.z1, b.x2, b.z2];
    case 'north':return [16 - b.x2, 16 - b.y2, 16 - b.x1, 16 - b.y1];
    case 'south':return [b.x1, 16 - b.y2, b.x2, 16 - b.y1];
    case 'west': return [b.z1, 16 - b.y2, b.z2, 16 - b.y1];
    case 'east': return [16 - b.z2, 16 - b.y2, 16 - b.z1, 16 - b.y1];
  }
}
// uvrect[ x1,y1,x2,y2 ](ピクセル) + 回転 → three uv 4頂点(v0..v3)
function faceUV(rect, rotation) {
  const [u1, v1, u2, v2] = rect;
  // v0..v3 = (u1,v1)(u2,v1)(u2,v2)(u1,v2) ピクセル(v上→下)
  let c = [[u1, v1], [u2, v1], [u2, v2], [u1, v2]];
  const steps = ((rotation || 0) / 90) & 3;
  for (let i = 0; i < steps; i++) c = [c[3], c[0], c[1], c[2]];
  return c.map(([u, v]) => [u / 16, 1 - v / 16]);
}
// uvrect(ピクセル) + 回転 → three uv 4頂点。テクスチャ寸法 tw×th で正規化（entity アトラス用）。
function faceUVSize(rect, rotation, tw, th) {
  const [u1, v1, u2, v2] = rect;
  let c = [[u1, v1], [u2, v1], [u2, v2], [u1, v2]];
  const steps = ((rotation || 0) / 90) & 3;
  for (let i = 0; i < steps; i++) c = [c[3], c[0], c[1], c[2]];
  return c.map(([u, v]) => [u / tw, 1 - v / th]);
}
// MC エンティティの box-UV ネット展開。box(0..16 model px) と texOffs(ou,ov) から
// 各 MC 方向の uv rect(アトラス px, v上→下) を返す。1 model unit = 1 texel。
function boxUVNet(b, ou, ov) {
  const w = b.x2 - b.x1, h = b.y2 - b.y1, d = b.z2 - b.z1;
  return {
    up:    [ou + d,         ov,     ou + d + w,         ov + d],
    down:  [ou + d + w,     ov,     ou + d + w + w,     ov + d],
    east:  [ou,             ov + d, ou + d,             ov + d + h],
    north: [ou + d,         ov + d, ou + d + w,         ov + d + h],
    west:  [ou + d + w,     ov + d, ou + d + w + d,     ov + d + h],
    south: [ou + d + w + d, ov + d, ou + d + w + d + w, ov + d + h],
  };
}
// 要素ローカル回転 {origin,axis,angle}
function applyElemRot(p, rot) {
  if (!rot) return p;
  const o = rot.origin || [8, 8, 8];
  const a = (rot.angle || 0) * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  let [x, y, z] = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
  if (rot.axis === 'x') [y, z] = [y * c - z * s, y * s + z * c];
  else if (rot.axis === 'y') [x, z] = [x * c + z * s, -x * s + z * c];
  else if (rot.axis === 'z') [x, y] = [x * c - y * s, x * s + y * c];
  return [x + o[0], y + o[1], z + o[2]];
}
function applyElemRotVec(v, rot) {
  if (!rot) return v;
  return applyElemRot([v[0] + (rot.origin?.[0] ?? 8), v[1] + (rot.origin?.[1] ?? 8), v[2] + (rot.origin?.[2] ?? 8)], rot)
    .map((c, i) => c - (rot.origin?.[i] ?? 8));
}
// blockstate 回転(中心8,8,8まわり, 90°ステップ) を座標へ
function stateRotPos(p, xs, ys) {
  let r = [p[0] - 8, p[1] - 8, p[2] - 8];
  r = rotX(r, xs); r = rotY(r, ys);
  return [r[0] + 8, r[1] + 8, r[2] + 8];
}
function snapDir(v) {
  // 最大成分を ±1 に丸めて方向名へ
  const a = v.map(Math.abs);
  const m = Math.max(...a);
  const s = [0, 0, 0];
  for (let i = 0; i < 3; i++) if (a[i] === m) { s[i] = v[i] > 0 ? 1 : -1; break; }
  return dirName(s);
}
function shadeForNormal(n) {
  if (n[1] > 0.5) return 1.0;
  if (n[1] < -0.5) return 0.5;
  if (Math.abs(n[2]) > 0.5) return 0.8;
  if (Math.abs(n[0]) > 0.5) return 0.65;
  return 0.8;
}

// 簡易合成モデル：ブロックエンティティ系（block model が無い chest/bed/sign 等）を
// 既存の block テクスチャを流用した「それっぽい形」で近似する。
function box(x1, y1, z1, x2, y2, z2, ref) {
  const faces = {};
  for (const d of DIR_NAMES) faces[d] = { texture: '#' + ref };
  return { from: [x1, y1, z1], to: [x2, y2, z2], faces };
}
// entity アトラス用の箱。td=[tw,th,td] を渡すとその texel 寸法で UV ネットを作る
// （モデル寸法と texel が異なる看板用）。省略時はモデル寸法=texel。
function ebox(x1, y1, z1, x2, y2, z2, ref, ou, ov, td) {
  const dim = td ? { x1: 0, y1: 0, z1: 0, x2: td[0], y2: td[1], z2: td[2] }
                 : { x1, y1, z1, x2, y2, z2 };
  const net = boxUVNet(dim, ou, ov);
  const faces = {};
  for (const d of DIR_NAMES) faces[d] = { texture: '#' + ref, uv: net[d] };
  return { from: [x1, y1, z1], to: [x2, y2, z2], faces };
}
// entity アトラス用の箱（面ごとに uv rect を明示指定。bed のように回転で面対応が
// 入れ替わるケース用）。rects = {up:[..],down:[..],...}（アトラス px）。
function eboxFaces(x1, y1, z1, x2, y2, z2, ref, rects) {
  const faces = {};
  for (const d of DIR_NAMES) if (rects[d]) faces[d] = { texture: '#' + ref, uv: rects[d], rotation: rects[d][4] || 0 };
  return { from: [x1, y1, z1], to: [x2, y2, z2], faces };
}
// facing -> yRot ステップ数。rotY は時計回り [x,y,z]->[-z,y,x]。
// 正面を north に作った形を facing 方向へ回す対応表（north=0,east=1,south=2,west=3）。
const FACE_Y_NORTH = { north: 0, east: 1, south: 2, west: 3 };
// 正面を south に作った形（south=0,west=1,north=2,east=3）。
const FACE_Y_SOUTH = { south: 0, west: 1, north: 2, east: 3 };

// signs アトラスの木材名（無いものは oak にフォールバック）
const SIGN_WOODS = new Set(['oak','spruce','birch','jungle','acacia','dark_oak','mangrove','cherry','bamboo','crimson','warped','pale_oak']);
const BED_COLORS = new Set(['white','orange','magenta','light_blue','yellow','lime','pink','gray','light_gray','cyan','purple','blue','brown','green','red','black']);

function syntheticModel(base, props) {
  // チェスト類 → 本体＋蓋＋かんぬき（実 entity テクスチャ・box-UV）。かんぬきが facing を向く。
  if (base === 'chest' || base === 'trapped_chest' || base === 'ender_chest') {
    const tex = base === 'ender_chest' ? 'entity/chest/ender'
              : base === 'trapped_chest' ? 'entity/chest/trapped'
              : 'entity/chest/normal';
    return {
      atlas: [64, 64],
      textures: { t: tex },
      elements: [
        ebox(1, 0, 1, 15, 10, 15, 't', 0, 19),  // 本体 14×10×14
        ebox(1, 9, 1, 15, 14, 15, 't', 0, 0),   // 蓋 14×5×14
        ebox(7, 8, 0, 9, 12, 1, 't', 0, 0),     // かんぬき 2×4×1（北面・鍵穴）
      ],
      yRot: FACE_Y_NORTH[props.facing] || 0,
    };
  }
  // ベッド → マットレス＋脚（実 entity テクスチャ）。枕/掛け布はテクスチャに含まれる。
  // facing=頭の向き、part で頭/足を出し分け。MC モデルは縦箱を X+90°回転した配置。
  if (base.endsWith('_bed')) {
    const color = base.slice(0, -4);
    const tex = `entity/bed/${BED_COLORS.has(color) ? color : 'red'}`;
    const head = props.part === 'head';
    const v0 = head ? 0 : 22;   // 頭=texOffs(0,0) / 足=texOffs(0,22)
    // マットレス（16×6×16）。縦箱(16w×16h×6d)の各面 → 寝かせた面へ対応付け。
    //  天面 = 縦箱の正面(16×16, 掛け布+枕) / 端面 = 縦箱の上下(16×6) / 側面 = 縦箱の左右(6×16)
    const top    = [6, v0 + 6, 22, v0 + 22];
    const bottom = [28, v0 + 6, 44, v0 + 22];
    const endOut = [6, v0 + 0, 22, v0 + 6];   // 外側端（枕側 or 足先）
    const endIn  = [22, v0 + 0, 38, v0 + 6];  // 内側端（2マスの継ぎ目）
    const sideE  = [0, v0 + 6, 6, v0 + 22, 90];
    const sideW  = [22, v0 + 6, 28, v0 + 22, 90];
    // 頭は +Z(南)側が枕端。FACE_Y_SOUTH で facing へ回す。
    const rects = head
      ? { up: top, down: bottom, south: endOut, north: endIn, east: sideE, west: sideW }
      : { up: top, down: bottom, north: endOut, south: endIn, east: sideE, west: sideW };
    const els = [eboxFaces(0, 3, 0, 16, 9, 16, 't', rects)];
    // 脚 3×3×3（texOffs はアトラス右側 50,0 〜）。頭/足で 2 本ずつ。
    const legUV = (ou, ov) => boxUVNet({ x1: 0, y1: 0, z1: 0, x2: 3, y2: 3, z2: 3 }, ou, ov);
    const leg = (x, z, ou, ov) => {
      const net = legUV(ou, ov), faces = {};
      for (const d of DIR_NAMES) faces[d] = { texture: '#t', uv: net[d] };
      return { from: [x, 0, z], to: [x + 3, 3, z + 3], faces };
    };
    if (head) { els.push(leg(0, 13, 50, 6)); els.push(leg(13, 13, 50, 0)); }
    else { els.push(leg(0, 0, 50, 18)); els.push(leg(13, 0, 50, 12)); }
    return { atlas: [64, 64], textures: { t: tex }, elements: els, yRot: FACE_Y_SOUTH[props.facing] || 0 };
  }
  // 看板類 → 板（24×12×2 を 2/3 スケール=16×8×1.33）。実 entity テクスチャ・box-UV。
  if (base.endsWith('_sign') || base.endsWith('_wall_sign') || base.endsWith('_hanging_sign')) {
    let wood = base.replace(/_(wall_|hanging_)?sign$/, '');
    if (!SIGN_WOODS.has(wood)) wood = 'oak';
    const tex = `entity/signs/${wood}`;
    if (base.endsWith('_wall_sign')) {
      // 壁掛け: 北端(背面の壁側)に板を貼り、表(北面)が facing を向く（FACE_Y_NORTH 規約）。
      return {
        atlas: [64, 32],
        textures: { t: tex },
        elements: [ebox(0, 4.5, 0.17, 16, 12.5, 1.5, 't', 0, 0, [24, 12, 2])],
        yRot: FACE_Y_NORTH[props.facing] || 0,
      };
    }
    // 立て看板/吊り看板: 支柱＋板。rotation(0-15) を 90°刻みに丸めて向ける。
    return {
      atlas: [64, 32],
      textures: { t: tex },
      elements: [
        ebox(7, 0, 7.33, 9, 9, 8.67, 't', 0, 14, [2, 14, 2]),    // 支柱
        ebox(0, 7, 7.33, 16, 15, 8.67, 't', 0, 0, [24, 12, 2]),  // 板
      ],
      yRot: Math.round((Number(props.rotation) || 0) / 4) % 4,
    };
  }
  return null;
}

// 半透明/カットアウト判定（カリングと描画モード用）
const NON_OPAQUE = /glass|leaves|ice|slime|honey|web|cobweb|door|trapdoor|fence|pane|bars|ladder|torch|sapling|flower|grass$|rail|sign|banner|carpet|snow|bed|chest|lantern|chain|vine/;

export class AssetPack {
  constructor(version) {
    this.version = version;
    this.base = `${ASSET_BASE}/${version}`;
    this._bs = new Map();      // blockstate json
    this._model = new Map();   // model json
    this._tex = new Map();     // THREE.Texture
    this._desc = new Map();    // 解決済みディスクリプタ（state文字列 -> desc）
    this._loader = new THREE.TextureLoader();
  }

  async _json(path, cache, key) {
    if (cache.has(key)) return cache.get(key);
    let data = null;
    try { const r = await fetch(path); if (r.ok) data = await r.json(); } catch {}
    cache.set(key, data);
    return data;
  }
  _blockstate(name) { return this._json(`${this.base}/blockstates/${name}.json`, this._bs, name); }
  _modelJson(name) { return this._json(`${this.base}/models/${name}.json`, this._model, name); } // name 例: block/oak_log

  // モデル名を正規化: "minecraft:block/oak_log" -> "block/oak_log"
  _norm(m) { return m.replace(/^minecraft:/, ''); }

  // 親チェーンを解決して {textures, elements} を返す
  async _resolveModel(modelName) {
    const name = this._norm(modelName);
    const m = await this._modelJson(name);
    if (!m) return { textures: {}, elements: null };
    let textures = {}, elements = m.elements || null;
    if (m.parent) {
      const p = await this._resolveModel(m.parent);
      textures = { ...p.textures };
      if (!elements) elements = p.elements;
    }
    if (m.textures) {
      for (const [k, v] of Object.entries(m.textures)) {
        textures[k] = (v && typeof v === 'object') ? v.sprite : v; // 新形式 {sprite,...}
      }
    }
    return { textures, elements };
  }

  // #ref をテクスチャ名(block/xxx)まで解決
  _resolveRef(textures, ref) {
    let r = ref, guard = 0;
    while (typeof r === 'string' && r.startsWith('#') && guard++ < 20) r = textures[r.slice(1)];
    return (typeof r === 'string') ? this._norm(r) : null;
  }

  // テクスチャ名 -> ファイルキー。block は接頭辞を外す("block/oak_log"->"oak_log")。
  // entity 等は textures/ 以下のパスをそのまま保持("entity/chest/normal")。
  _texFile(texName) {
    if (!texName) return null;
    return texName.startsWith('block/') ? texName.slice(6) : texName;
  }
  // ファイルキー -> 画像URL。'/' を含むなら textures/ 直下、無ければ textures/block/。
  _texUrl(file) {
    return file.includes('/') ? `${this.base}/textures/${file}.png` : `${this.base}/textures/block/${file}.png`;
  }

  // blockstate から最初に一致する variant を選ぶ
  _pickVariant(bs, props) {
    if (!bs) return null;
    if (bs.variants) {
      for (const [key, val] of Object.entries(bs.variants)) {
        if (key === '') return Array.isArray(val) ? val[0] : val;
        const ok = key.split(',').every(pair => {
          const [k, v] = pair.split('=');
          return props[k] === v;
        });
        if (ok) return Array.isArray(val) ? val[0] : val;
      }
      // 一致なし → 最初
      const first = Object.values(bs.variants)[0];
      return Array.isArray(first) ? first[0] : first;
    }
    if (bs.multipart) {
      // 代表として最初の apply モデルを使う
      const ap = bs.multipart[0] && bs.multipart[0].apply;
      return Array.isArray(ap) ? ap[0] : ap;
    }
    return null;
  }

  // state 文字列 -> ディスクリプタ
  // { quads:[{pos:[[x,y,z]*4](0..1), normal, uv:[[u,v]*4], tex, cull, shade}], opaque, emissive, opacity, color }
  async describe(stateString) {
    if (this._desc.has(stateString)) return this._desc.get(stateString);
    const { name, props } = splitState(stateString);
    const base = name.replace(/^minecraft:/, '');
    const appear = blockAppearance(stateString); // null=air
    const desc = await this._build(base, props, appear);
    this._desc.set(stateString, desc);
    return desc;
  }

  async _build(base, props, appear) {
    if (!appear) return null; // air
    const colorDesc = { quads: null, opaque: appear.opacity >= 1 && !NON_OPAQUE.test(base), emissive: appear.emissive, opacity: appear.opacity, color: appear.color };
    const bs = await this._blockstate(base);
    const variant = this._pickVariant(bs, props);
    if (!variant) return colorDesc;

    let textures = {}, elements = null, atlas = null;
    let xs = 0, ys = 0;
    if (variant.model) {
      const r = await this._resolveModel(variant.model);
      textures = r.textures; elements = r.elements;
      xs = ((variant.x || 0) / 90) | 0;
      ys = ((variant.y || 0) / 90) | 0;
    }
    if (!elements || !elements.length) {
      // ブロックエンティティ系（chest/bed/sign 等）は block model が無い → 合成モデルで近似
      const syn = syntheticModel(base, props);
      if (!syn) return colorDesc;
      textures = syn.textures; elements = syn.elements; xs = 0; ys = syn.yRot || 0;
      atlas = syn.atlas || null; // entity アトラス（UV を /16 でなく実寸で正規化）
    }

    // フルキューブ判定（カリング用）
    const el0 = elements[0];
    const isFullCube = elements.length === 1 && el0.from && el0.to &&
      el0.from[0] === 0 && el0.from[1] === 0 && el0.from[2] === 0 &&
      el0.to[0] === 16 && el0.to[1] === 16 && el0.to[2] === 16 &&
      el0.faces && DIR_NAMES.every(d => el0.faces[d]);

    const quads = [];
    for (const el of elements) {
      const b = { x1: el.from[0], y1: el.from[1], z1: el.from[2], x2: el.to[0], y2: el.to[1], z2: el.to[2] };
      const erot = el.rotation || null;
      for (const dir of DIR_NAMES) {
        const face = el.faces && el.faces[dir];
        if (!face) continue;
        const tex = this._texFile(this._resolveRef(textures, face.texture));
        const rect = face.uv || defaultUV(dir, b);
        const uv = atlas ? faceUVSize(rect, face.rotation, atlas[0], atlas[1]) : faceUV(rect, face.rotation);
        // 頂点(ピクセル) → 要素回転 → blockstate回転 → 0..1
        const pos = FACE_VERTS[dir](b).map(p => {
          let q = applyElemRot(p, erot);
          q = stateRotPos(q, xs, ys);
          return [q[0] / 16, q[1] / 16, q[2] / 16];
        });
        // 法線
        let nrm = applyElemRotVec(DIRS[dir], erot);
        nrm = rotX(nrm, xs); nrm = rotY(nrm, ys);
        // cull 方向
        let cull = null;
        if (face.cullface) {
          let cv = DIRS[face.cullface] || DIRS[dir];
          cv = applyElemRotVec(cv, erot);
          cv = rotX(cv, xs); cv = rotY(cv, ys);
          cull = snapDir(cv);
        }
        // tintindex があればバイオーム着色（葉/草など）→ ブロック色を乗算
        const tint = face.tintindex !== undefined && face.tintindex >= 0;
        quads.push({ pos, normal: nrm, uv, tex, cull, tint, shade: appear.emissive ? 1.0 : shadeForNormal(nrm) });
      }
    }

    const allTex = quads.every(q => q.tex);
    const opaque = isFullCube && allTex && appear.opacity >= 1 && !NON_OPAQUE.test(base);
    return { quads, opaque, emissive: appear.emissive, opacity: appear.opacity, color: appear.color };
  }

  // テクスチャ先読み（画像の読込完了まで待つ）。失敗時は null をキャッシュ。
  async preload(file) {
    if (!file || this._tex.has(file)) return;
    try {
      const t = await this._loader.loadAsync(this._texUrl(file));
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      this._tex.set(file, t);
    } catch {
      this._tex.set(file, null); // 欠落テクスチャ
    }
  }
  // 取得（先読み済みキャッシュ前提。未読込なら遅延ロードにフォールバック）
  texture(file) {
    if (!file) return null;
    if (this._tex.has(file)) return this._tex.get(file);
    const t = this._loader.load(this._texUrl(file));
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    this._tex.set(file, t);
    return t;
  }
}

// versions.json を読む
export async function loadVersions() {
  try {
    const r = await fetch(`${ASSET_BASE}/versions.json`);
    if (r.ok) return await r.json();
  } catch {}
  return { latest: null, versions: [] };
}
