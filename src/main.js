import { loadSchem, rotate, saveSchem } from './schem.js';
import { loadLitematic } from './litematic.js';
import { Viewer, buildMesh } from './viewer.js';
import { AssetPack, loadVersions } from './textures.js';

const canvas = document.getElementById('view');
const viewer = new Viewer(canvas);

let original = null;   // 読み込んだ元データ（回転は常にここから適用）
let rotation = 0;      // 0..3 (×90° CW)
let current = null;    // 表示中の（回転後）schem
let fileName = 'schematic';
let pack = null;       // AssetPack（null = 色キューブ）

const $ = (id) => document.getElementById(id);
const info = $('info');
const compass = $('compass');
const verSel = $('version');

function setStatus(msg) { info.textContent = msg; }

// 方角コンパス: 現在の視点(yaw)に追従して N/E/S/W を回転表示（上=視線方向）。
const dial = $('compassDial');
const dctx = dial.getContext('2d');
function drawCompass() {
  const w = dial.width, h = dial.height, cx = w / 2, cy = h / 2, R = cx - 13;
  dctx.clearRect(0, 0, w, h);
  dctx.beginPath(); dctx.arc(cx, cy, R + 7, 0, Math.PI * 2);
  dctx.fillStyle = 'rgba(0,0,0,0.28)'; dctx.fill();
  dctx.strokeStyle = 'rgba(255,255,255,0.3)'; dctx.lineWidth = 1; dctx.stroke();
  const yaw = viewer.yaw;
  const dirs = [['N', 0, '#ff5a45'], ['E', Math.PI / 2, '#cfd6e0'], ['S', Math.PI, '#cfd6e0'], ['W', 3 * Math.PI / 2, '#cfd6e0']];
  dctx.font = 'bold 12px sans-serif'; dctx.textAlign = 'center'; dctx.textBaseline = 'middle';
  for (const [t, phi, col] of dirs) {
    const a = phi + yaw; // 上=視線方向になるよう yaw を加算
    dctx.fillStyle = col;
    dctx.fillText(t, cx + Math.sin(a) * R, cy - Math.cos(a) * R);
  }
  // 上部の視線マーカー（▼）と中心点
  dctx.fillStyle = '#ffd24a';
  dctx.beginPath(); dctx.moveTo(cx - 5, 3); dctx.lineTo(cx + 5, 3); dctx.lineTo(cx, 11); dctx.closePath(); dctx.fill();
  dctx.beginPath(); dctx.arc(cx, cy, 2, 0, Math.PI * 2); dctx.fillStyle = '#fff'; dctx.fill();
  requestAnimationFrame(drawCompass);
}
drawCompass();

async function applyRotation(frame = false) {
  current = rotate(original, rotation);
  viewer.setMesh(await buildMesh(current, pack), frame);
  const dirs = ['元の向き (0°)', '90° CW', '180°', '270° CW'];
  compass.textContent = dirs[rotation];
  const mode = pack ? `tex:${pack.version}` : '色キューブ';
  setStatus(`${fileName} — ${current.width}×${current.height}×${current.length} / パレット${current.palette.length}種 / 回転 ${rotation * 90}° / ${mode}`);
  // 回転中（0°以外）は保存ボタンに赤バッヂ
  $('save').classList.toggle('badge', rotation !== 0);
}

// 表示モード選択肢（テクスチャは常に最新版のみ／色キューブ）。デフォルト=最新テクスチャ。
async function initVersions() {
  const reg = await loadVersions();
  verSel.innerHTML = '';
  const optColor = document.createElement('option');
  optColor.value = ''; optColor.textContent = '色キューブ';
  verSel.appendChild(optColor);
  // 正規は最新のみ（過去 ver は保持しない方針）
  if (reg.latest) {
    const o = document.createElement('option');
    o.value = reg.latest; o.textContent = `テクスチャ（最新 ${reg.latest}）`;
    verSel.appendChild(o);
    verSel.value = reg.latest; pack = new AssetPack(reg.latest);
  } else {
    // アセット未取得（例: GitHub Pages 公開版）→ 色キューブのみ
    const o = document.createElement('option');
    o.value = ''; o.disabled = true; o.textContent = 'テクスチャ未取得（ローカルで取得）';
    verSel.appendChild(o);
    verSel.value = ''; pack = null;
    const note = $('texNote');
    if (note) note.style.display = '';
  }
}

verSel.addEventListener('change', async () => {
  pack = verSel.value ? new AssetPack(verSel.value) : null;
  if (original) await applyRotation(false);
});

async function load(arrayBuffer, name) {
  setStatus('読み込み中…');
  // 拡張子で .litematic / .schem を判定（litematic は読込後 Sponge 互換ルートを合成済み）
  const isLite = /\.litematic$/i.test(name);
  original = isLite ? await loadLitematic(arrayBuffer) : await loadSchem(arrayBuffer);
  fileName = name.replace(/\.(schem|litematic)$/i, '');
  rotation = 0;
  await applyRotation(true);
}

// --- UI ---
$('rotL').addEventListener('click', () => { rotation = (rotation + 3) % 4; applyRotation(); });
$('rotR').addEventListener('click', () => { rotation = (rotation + 1) % 4; applyRotation(); });
$('reset').addEventListener('click', () => { rotation = 0; applyRotation(true); });

$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) await load(await f.arrayBuffer(), f.name);
});

$('save').addEventListener('click', async () => {
  if (!current) return;
  setStatus('保存ファイル生成中…');
  const bytes = await saveSchem(current);
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${fileName}_rot${rotation * 90}.schem`;
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus(`保存しました: ${a.download}`);
});

// ドラッグ&ドロップ
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) await load(await f.arrayBuffer(), f.name);
});

// 起動時: バージョン初期化 → 同梱の planes_house.schem を自動読み込み（あれば）
(async () => {
  await initVersions();
  try {
    const res = await fetch('./planes_house.schem');
    if (res.ok) await load(await res.arrayBuffer(), 'planes_house.schem');
    else setStatus('.schem / .litematic ファイルをドラッグ&ドロップ、または選択してください');
  } catch {
    setStatus('.schem / .litematic ファイルをドラッグ&ドロップ、または選択してください');
  }
})();
