// 最小限の NBT (Named Binary Tag) 読み書き実装。
// Sponge Schematic v3 (.schem) を扱うのに必要なタグだけを実装している。
// ビッグエンディアン・modified UTF-8 は通常 UTF-8 で代用（schem 内のキーは ASCII のため問題なし）。

export const TAG = {
  END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6,
  BYTE_ARRAY: 7, STRING: 8, LIST: 9, COMPOUND: 10, INT_ARRAY: 11, LONG_ARRAY: 12,
};

// 値はタグ型情報を保持するためにラッパーを使う場面がある。
// Compound -> プレーンな JS オブジェクト { key: {type, value} }
// として保持し、書き戻し時に型を保つ。

class Reader {
  constructor(buf) {
    this.dv = new DataView(buf);
    this.off = 0;
    this.dec = new TextDecoder('utf-8');
  }
  u1() { return this.dv.getUint8(this.off++); }
  i1() { return this.dv.getInt8(this.off++); }
  i2() { const v = this.dv.getInt16(this.off); this.off += 2; return v; }
  u2() { const v = this.dv.getUint16(this.off); this.off += 2; return v; }
  i4() { const v = this.dv.getInt32(this.off); this.off += 4; return v; }
  i8() { const v = this.dv.getBigInt64(this.off); this.off += 8; return v; }
  f4() { const v = this.dv.getFloat32(this.off); this.off += 4; return v; }
  f8() { const v = this.dv.getFloat64(this.off); this.off += 8; return v; }
  str() {
    const len = this.u2();
    const bytes = new Uint8Array(this.dv.buffer, this.dv.byteOffset + this.off, len);
    this.off += len;
    return this.dec.decode(bytes);
  }
  bytes(n) {
    const b = new Uint8Array(this.dv.buffer, this.dv.byteOffset + this.off, n).slice();
    this.off += n;
    return b;
  }
  payload(type) {
    switch (type) {
      case TAG.BYTE: return this.i1();
      case TAG.SHORT: return this.i2();
      case TAG.INT: return this.i4();
      case TAG.LONG: return this.i8();
      case TAG.FLOAT: return this.f4();
      case TAG.DOUBLE: return this.f8();
      case TAG.BYTE_ARRAY: { const n = this.i4(); return this.bytes(n); }
      case TAG.STRING: return this.str();
      case TAG.LIST: {
        const et = this.u1();
        const n = this.i4();
        const items = [];
        for (let k = 0; k < n; k++) items.push(this.payload(et));
        return { __list: true, elementType: et, items };
      }
      case TAG.COMPOUND: {
        const obj = {};
        for (;;) {
          const t = this.u1();
          if (t === TAG.END) break;
          const name = this.str();
          obj[name] = { type: t, value: this.payload(t) };
        }
        return obj;
      }
      case TAG.INT_ARRAY: {
        const n = this.i4();
        const arr = new Int32Array(n);
        for (let k = 0; k < n; k++) arr[k] = this.i4();
        return arr;
      }
      case TAG.LONG_ARRAY: {
        const n = this.i4();
        const arr = new BigInt64Array(n);
        for (let k = 0; k < n; k++) arr[k] = this.i8();
        return arr;
      }
      default: throw new Error('Unknown tag type ' + type + ' at ' + this.off);
    }
  }
}

// ArrayBuffer を受け取りルート {name, type, value} を返す。
export function parse(buffer) {
  const r = new Reader(buffer);
  const type = r.u1();
  if (type !== TAG.COMPOUND) throw new Error('Root tag must be compound');
  const name = r.str();
  const value = r.payload(TAG.COMPOUND);
  return { name, type, value };
}

class Writer {
  constructor() {
    this.chunks = [];
    this.enc = new TextEncoder();
  }
  push(arr) { this.chunks.push(arr); }
  u1(v) { this.push(new Uint8Array([v & 0xff])); }
  i2(v) { const b = new DataView(new ArrayBuffer(2)); b.setInt16(0, v); this.push(new Uint8Array(b.buffer)); }
  u2(v) { const b = new DataView(new ArrayBuffer(2)); b.setUint16(0, v); this.push(new Uint8Array(b.buffer)); }
  i4(v) { const b = new DataView(new ArrayBuffer(4)); b.setInt32(0, v); this.push(new Uint8Array(b.buffer)); }
  i8(v) { const b = new DataView(new ArrayBuffer(8)); b.setBigInt64(0, BigInt(v)); this.push(new Uint8Array(b.buffer)); }
  f4(v) { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, v); this.push(new Uint8Array(b.buffer)); }
  f8(v) { const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, v); this.push(new Uint8Array(b.buffer)); }
  str(s) {
    const bytes = this.enc.encode(s);
    this.u2(bytes.length);
    this.push(bytes);
  }
  payload(type, value) {
    switch (type) {
      case TAG.BYTE: this.u1(value & 0xff); break;
      case TAG.SHORT: this.i2(value); break;
      case TAG.INT: this.i4(value); break;
      case TAG.LONG: this.i8(value); break;
      case TAG.FLOAT: this.f4(value); break;
      case TAG.DOUBLE: this.f8(value); break;
      case TAG.BYTE_ARRAY: this.i4(value.length); this.push(value); break;
      case TAG.STRING: this.str(value); break;
      case TAG.LIST: {
        this.u1(value.elementType);
        this.i4(value.items.length);
        for (const it of value.items) this.payload(value.elementType, it);
        break;
      }
      case TAG.COMPOUND: {
        for (const key of Object.keys(value)) {
          const child = value[key];
          this.u1(child.type);
          this.str(key);
          this.payload(child.type, child.value);
        }
        this.u1(TAG.END);
        break;
      }
      case TAG.INT_ARRAY: {
        this.i4(value.length);
        for (let k = 0; k < value.length; k++) this.i4(value[k]);
        break;
      }
      case TAG.LONG_ARRAY: {
        this.i4(value.length);
        for (let k = 0; k < value.length; k++) this.i8(value[k]);
        break;
      }
      default: throw new Error('Cannot write tag type ' + type);
    }
  }
}

// {name,type,value} を受け取り Uint8Array(非圧縮 NBT) を返す。
export function write(root) {
  const w = new Writer();
  w.u1(root.type);
  w.str(root.name);
  w.payload(root.type, root.value);
  // 連結
  let total = 0;
  for (const c of w.chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of w.chunks) { out.set(c, off); off += c.length; }
  return out;
}

// gzip 展開/圧縮（ブラウザ標準 API）
export async function gunzip(arrayBuffer) {
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([arrayBuffer]).stream().pipeThrough(ds);
  return await new Response(stream).arrayBuffer();
}
export async function gzip(uint8) {
  const cs = new CompressionStream('gzip');
  const stream = new Blob([uint8]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
