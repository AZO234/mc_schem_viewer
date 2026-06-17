#!/usr/bin/env node
// Minecraft 公式アセット(block テクスチャ/モデル/blockstates)を取得して
//   assets/<version>/ に展開し、assets/versions.json を更新する。
//
// 使い方:
//   node tools/fetch_assets.mjs --list           リリース一覧（最新20件）
//   node tools/fetch_assets.mjs                   最新リリースを取得（デフォルト）
//   node tools/fetch_assets.mjs latest            同上
//   node tools/fetch_assets.mjs 1.21.5            指定バージョンを取得
//
// Mojang のアセットは再配布不可。各自のローカル利用のみを想定。
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS_DIR = join(ROOT, 'assets');
const MANIFEST = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

async function main() {
  const arg = process.argv[2];
  const manifest = await getJSON(MANIFEST);

  if (arg === '--list') {
    console.log('latest release:', manifest.latest.release, '/ snapshot:', manifest.latest.snapshot);
    return;
  }

  // 方針: 常に最新リリースのみを正規とする（過去 ver は取得・保持しない）。
  const id = manifest.latest.release;
  const entry = manifest.versions.find(v => v.id === id);
  if (!entry) throw new Error(`最新リリース ${id} が見つかりません`);

  console.log(`▶ ${id} のメタ情報取得…`);
  const ver = await getJSON(entry.url);
  const client = ver.downloads.client;
  console.log(`▶ client.jar DL (${(client.size / 1e6).toFixed(1)} MB)…`);

  const tmp = mkdtempSync(join(tmpdir(), 'mcjar-'));
  const jarPath = join(tmp, 'client.jar');
  const buf = Buffer.from(await (await fetch(client.url)).arrayBuffer());
  writeFileSync(jarPath, buf);

  const outDir = join(ASSETS_DIR, id);
  mkdirSync(outDir, { recursive: true });

  // 必要なパスだけ展開（block 系 + ブロックエンティティ用 entity テクスチャ）
  const want = [
    'assets/minecraft/textures/block/*',
    'assets/minecraft/models/block/*',
    'assets/minecraft/blockstates/*',
    'assets/minecraft/textures/entity/chest/*',
    'assets/minecraft/textures/entity/bed/*',
    'assets/minecraft/textures/entity/signs/*',
    'version.json',
  ];
  console.log('▶ 展開中…');
  // バージョンによっては一部パス（例: 26.2 で entity/bed, entity/signs はブロックモデル化）が
  // 存在せず unzip が exit 1/11 を返す。該当ファイルは展開済みなので致命的エラー以外は続行。
  try {
    execFileSync('unzip', ['-o', '-q', jarPath, ...want, '-d', tmp], { stdio: 'inherit' });
  } catch (e) {
    if (e.status !== 1 && e.status !== 11) throw e;
    console.log('  （このバージョンに無いパスはスキップしました）');
  }

  // DataVersion を読む
  let dataVersion = null;
  const vjson = join(tmp, 'version.json');
  if (existsSync(vjson)) {
    try { dataVersion = JSON.parse(readFileSync(vjson, 'utf8')).world_version ?? null; } catch {}
  }

  // 展開物を assets/<id>/ へ移動（textures/block, models/block, blockstates）
  const src = join(tmp, 'assets', 'minecraft');
  for (const sub of [['textures', 'block'], ['textures', 'entity'], ['models', 'block'], ['blockstates']]) {
    const from = join(src, ...sub);
    const to = join(outDir, ...sub);
    if (existsSync(from)) {
      mkdirSync(dirname(to), { recursive: true });
      execFileSync('cp', ['-r', from, dirname(to) + '/']);
    }
  }
  rmSync(tmp, { recursive: true, force: true });

  // テクスチャ一覧（軽量なファイル名リスト。fetch で存在確認せず使えるように）
  const texDir = join(outDir, 'textures', 'block');
  const textures = existsSync(texDir)
    ? readdirSync(texDir).filter(f => f.endsWith('.png')).map(f => f.replace(/\.png$/, ''))
    : [];
  writeFileSync(join(outDir, 'textures.json'), JSON.stringify(textures));

  // 旧バージョンの展開物を削除（最新のみ保持）
  for (const d of readdirSync(ASSETS_DIR)) {
    const p = join(ASSETS_DIR, d);
    if (d !== id && d !== 'versions.json' && statSync(p).isDirectory()) {
      rmSync(p, { recursive: true, force: true });
      console.log(`  旧版 ${d} を削除`);
    }
  }

  // versions.json は最新のみ
  mkdirSync(ASSETS_DIR, { recursive: true });
  const reg = { latest: id, versions: [{ id, dataVersion, textures: textures.length }] };
  writeFileSync(join(ASSETS_DIR, 'versions.json'), JSON.stringify(reg, null, 2));

  console.log(`✅ ${id} 完了: textures/block ${textures.length}枚, DataVersion=${dataVersion}`);
  console.log(`   assets/${id}/ に展開 / versions.json 更新 (latest のみ保持)`);
}

main().catch(e => { console.error('エラー:', e.message); process.exit(1); });
