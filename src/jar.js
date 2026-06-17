// Mojang 公式 client.jar をブラウザ内で取得し、ZIP を手パースして必要ファイルを展開する。
// 依存ゼロ（ZIP セントラルディレクトリを自前で読み、deflate は DecompressionStream で展開）。
// 各ユーザーのブラウザが Mojang CDN から直接取得するため再配布に当たらない。

const MANIFEST = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';

// 最新リリースの client.jar を取得（onProgress(receivedBytes,totalBytes)）。
export async function fetchLatestClientJar(onProgress) {
  const manifest = await (await fetch(MANIFEST)).json();
  const id = manifest.latest.release;
  const entry = manifest.versions.find(v => v.id === id);
  const ver = await (await fetch(entry.url)).json();
  const dataVersion = ver.javaVersion ? (ver.world_version ?? null) : (ver.world_version ?? null);
  const client = ver.downloads.client;
  const res = await fetch(client.url);
  const total = client.size || Number(res.headers.get('content-length')) || 0;
  // 進捗付きで読み出し
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (onProgress) onProgress(received, total);
  }
  if (total && received !== total) throw new Error(`ダウンロード未完了 (${received}/${total} bytes) — 再試行してください`);
  const buf = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  return { id, dataVersion: ver.world_version ?? null, jar: new JarReader(buf.buffer) };
}

// ZIP(JAR) のセントラルディレクトリを読み、エントリを遅延展開するリーダ。
export class JarReader {
  constructor(arrayBuffer) {
    this.dv = new DataView(arrayBuffer);
    this.u8 = new Uint8Array(arrayBuffer);
    this.entries = new Map(); // name -> {method, compSize, size, localHeaderOffset}
    this._parseCentralDirectory();
  }

  _parseCentralDirectory() {
    const dv = this.dv;
    const n = dv.byteLength;
    // End of Central Directory (EOCD) を末尾から探す（コメント無し前提＋最大64KB）
    let eocd = -1;
    const minPos = Math.max(0, n - 22 - 65535);
    for (let i = n - 22; i >= minPos; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ZIP EOCD が見つかりません');
    const cdOffset = dv.getUint32(eocd + 16, true);
    const cdCount = dv.getUint16(eocd + 10, true);
    const dec = new TextDecoder('utf-8');
    let p = cdOffset;
    for (let k = 0; k < cdCount; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const size = dv.getUint32(p + 24, true);
      const fnLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localHeaderOffset = dv.getUint32(p + 42, true);
      const name = dec.decode(this.u8.subarray(p + 46, p + 46 + fnLen));
      this.entries.set(name, { method, compSize, size, localHeaderOffset });
      p += 46 + fnLen + extraLen + commentLen;
    }
  }

  has(name) { return this.entries.has(name); }

  // 指定エントリを Uint8Array に展開（method 0=無圧縮 / 8=deflate）
  async inflate(name) {
    const e = this.entries.get(name);
    if (!e) return null;
    const dv = this.dv;
    const lh = e.localHeaderOffset;
    if (dv.getUint32(lh, true) !== 0x04034b50) throw new Error('ローカルヘッダ不正: ' + name);
    const fnLen = dv.getUint16(lh + 26, true);
    const extraLen = dv.getUint16(lh + 28, true);
    const dataStart = lh + 30 + fnLen + extraLen;
    const comp = this.u8.subarray(dataStart, dataStart + e.compSize);
    if (e.method === 0) return comp.slice();
    if (e.method === 8) {
      const ds = new DecompressionStream('deflate-raw');
      const stream = new Blob([comp]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error('未対応の圧縮方式 ' + e.method + ': ' + name);
  }

  async inflateText(name) {
    const b = await this.inflate(name);
    return b ? new TextDecoder('utf-8').decode(b) : null;
  }
  async inflateJSON(name) {
    const t = await this.inflateText(name);
    return t ? JSON.parse(t) : null;
  }
}
