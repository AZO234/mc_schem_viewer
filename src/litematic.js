// Litematica (.litematic) を読み込み、内部形式（schem.js の loadSchem と同じ）へ変換する。
// 内部形式: { width,height,length, palette[name], indices[x+z*W+y*W*L], blockEntities[], root }
// root には Sponge v3 互換構造を合成し、回転後の保存（saveSchem → .schem）も通るようにする。
import { gunzip, parse, TAG } from './nbt.js';
import { joinState } from './schem.js';

const vec3 = (c) => ({ x: c.x.value, y: c.y.value, z: c.z.value });

// パレットサイズ size を表すのに必要なビット数（Litematica: 最小2bit）
function bitsFor(size) {
  const n = size - 1;
  return Math.max(2, n <= 0 ? 0 : 32 - Math.clz32(n));
}

// Litematica の連続ビットパック long 配列から index 番目の値を取り出すリーダを作る。
// （エントリは 64bit 境界をまたいで連続詰めされる方式）
function makeBitReader(longs, bits) {
  const B = BigInt(bits);
  const mask = (1n << B) - 1n;
  const len = longs.length;
  const u = (v) => BigInt.asUintN(64, v);
  return (i) => {
    const bitIndex = BigInt(i) * B;
    const startLong = Number(bitIndex >> 6n);
    const offset = bitIndex & 63n;
    let val = u(longs[startLong]) >> offset;
    if (offset + B > 64n && startLong + 1 < len) {
      val |= u(longs[startLong + 1]) << (64n - offset);
    }
    return Number(val & mask);
  };
}

const tag = (type, value) => ({ type, value });

// saveSchem が書き戻せる最小の Sponge v3 ルートを合成（W/H/L/Palette/Data は保存時に上書きされる）
function buildSpongeRoot(W, H, L, dataVersion) {
  return {
    name: '', type: TAG.COMPOUND, value: {
      Schematic: tag(TAG.COMPOUND, {
        Version: tag(TAG.INT, 3),
        DataVersion: tag(TAG.INT, dataVersion || 0),
        Width: tag(TAG.SHORT, W),
        Height: tag(TAG.SHORT, H),
        Length: tag(TAG.SHORT, L),
        Blocks: tag(TAG.COMPOUND, {
          Palette: tag(TAG.COMPOUND, {}),
          Data: tag(TAG.BYTE_ARRAY, new Uint8Array(0)),
          BlockEntities: tag(TAG.LIST, { __list: true, elementType: TAG.COMPOUND, items: [] }),
        }),
      }),
    },
  };
}

export async function loadLitematic(arrayBuffer) {
  const raw = await gunzip(arrayBuffer);
  const root = parse(raw);
  const rv = root.value;
  const regionsTag = rv.Regions && rv.Regions.value;
  if (!regionsTag) throw new Error('Regions タグが見つかりません (.litematic ではない?)');
  const dataVersion = (rv.MinecraftDataVersion && rv.MinecraftDataVersion.value) || 0;

  // 各リージョンを準備（パレット文字列・ビットリーダ・ワールド最小角）
  const regions = [];
  for (const regTag of Object.values(regionsTag)) {
    const reg = regTag.value;
    const pos = vec3(reg.Position.value);
    const size = vec3(reg.Size.value);
    const ax = Math.abs(size.x), ay = Math.abs(size.y), az = Math.abs(size.z);
    const palItems = reg.BlockStatePalette.value.items;
    const pal = palItems.map(c => {
      const props = {};
      if (c.Properties) for (const [k, t] of Object.entries(c.Properties.value)) props[k] = t.value;
      return joinState(c.Name.value, props);
    });
    const bits = bitsFor(pal.length);
    const decode = makeBitReader(reg.BlockStates.value, bits);
    regions.push({ pal, decode, ax, ay, az, size, pos });
  }

  // 全リージョンを含む境界（負サイズは負方向へ伸びる）
  let gMinX = Infinity, gMinY = Infinity, gMinZ = Infinity;
  let gMaxX = -Infinity, gMaxY = -Infinity, gMaxZ = -Infinity;
  for (const r of regions) {
    const minX = r.size.x < 0 ? r.pos.x + r.size.x + 1 : r.pos.x;
    const minY = r.size.y < 0 ? r.pos.y + r.size.y + 1 : r.pos.y;
    const minZ = r.size.z < 0 ? r.pos.z + r.size.z + 1 : r.pos.z;
    gMinX = Math.min(gMinX, minX); gMinY = Math.min(gMinY, minY); gMinZ = Math.min(gMinZ, minZ);
    gMaxX = Math.max(gMaxX, minX + r.ax - 1);
    gMaxY = Math.max(gMaxY, minY + r.ay - 1);
    gMaxZ = Math.max(gMaxZ, minZ + r.az - 1);
  }
  const W = gMaxX - gMinX + 1, H = gMaxY - gMinY + 1, L = gMaxZ - gMinZ + 1;

  // 合成パレット（air=0）と indices
  const palette = ['minecraft:air'];
  const palMap = new Map([['minecraft:air', 0]]);
  const idFor = (nm) => {
    let id = palMap.get(nm);
    if (id === undefined) { id = palette.length; palette.push(nm); palMap.set(nm, id); }
    return id;
  };
  const indices = new Array(W * H * L).fill(0);

  for (const r of regions) {
    const stride = r.ax * r.az;
    for (let y = 0; y < r.ay; y++) for (let z = 0; z < r.az; z++) for (let x = 0; x < r.ax; x++) {
      const nm = r.pal[r.decode(y * stride + z * r.ax + x)];
      if (!nm || nm === 'minecraft:air' || nm.startsWith('minecraft:air[')) continue;
      const wx = r.pos.x + (r.size.x < 0 ? -x : x);
      const wy = r.pos.y + (r.size.y < 0 ? -y : y);
      const wz = r.pos.z + (r.size.z < 0 ? -z : z);
      const gx = wx - gMinX, gy = wy - gMinY, gz = wz - gMinZ;
      indices[gx + gz * W + gy * W * L] = idFor(nm);
    }
  }

  return {
    width: W, height: H, length: L,
    palette, indices, blockEntities: [], entities: [],
    root: buildSpongeRoot(W, H, L, dataVersion),
  };
}
