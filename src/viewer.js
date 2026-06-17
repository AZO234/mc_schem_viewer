// three.js による 3D 表示。面カリング + 面ごとの陰影焼き込み。
import * as THREE from 'three';
import { blockAppearance, biomeTint } from './colors.js';
import { splitState } from './schem.js';

// 染料色 → CSS（看板文字色）
const SIGN_DYE = {
  white: '#f9fffe', orange: '#f9801d', magenta: '#c74ebd', light_blue: '#3ab3da',
  yellow: '#fed83d', lime: '#80c71f', pink: '#f38baa', gray: '#474f52',
  light_gray: '#9d9d97', cyan: '#169c9c', purple: '#8932b8', blue: '#3c44aa',
  brown: '#835432', green: '#5e7c16', red: '#b02e26', black: '#1d1d21',
};

// 看板テキスト（JSON text component or プレーン文字列）→ 表示文字列
function signLineText(msg) {
  if (typeof msg !== 'string') return '';
  const s = msg.trim();
  if (s && (s[0] === '{' || s[0] === '"' || s[0] === '[')) {
    try {
      const j = JSON.parse(s);
      if (typeof j === 'string') return j;
      if (j && typeof j === 'object') return (j.text || '') + (Array.isArray(j.extra) ? j.extra.map(e => e.text || '').join('') : '');
    } catch {}
  }
  return msg;
}

// 看板文字のキャンバステクスチャ（透明背景＋中央寄せ4行）
function signTexture(lines, color) {
  const S = 128;
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = SIGN_DYE[color] || '#1d1d21';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < 4; i++) {
    const ln = lines[i]; if (!ln) continue;
    let fs = 22;
    ctx.font = `bold ${fs}px sans-serif`;
    while (ctx.measureText(ln).width > S - 8 && fs > 8) { fs--; ctx.font = `bold ${fs}px sans-serif`; }
    ctx.fillText(ln, S / 2, S * (i + 0.5) / 4);
  }
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}


// 6 面の定義: 法線方向と 4 頂点（単位立方体 0..1）、陰影倍率
const FACES = [
  { name: 'up',    dir: [0, 1, 0], shade: 1.00, verts: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]], uv: [[0,0],[0,1],[1,1],[1,0]] },
  { name: 'down',  dir: [0,-1, 0], shade: 0.50, verts: [[0,0,1],[0,0,0],[1,0,0],[1,0,1]], uv: [[0,1],[0,0],[1,0],[1,1]] },
  { name: 'north', dir: [0, 0,-1], shade: 0.80, verts: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], uv: [[1,0],[0,0],[0,1],[1,1]] },
  { name: 'south', dir: [0, 0, 1], shade: 0.80, verts: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], uv: [[0,0],[1,0],[1,1],[0,1]] },
  { name: 'east',  dir: [1, 0, 0], shade: 0.65, verts: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]], uv: [[1,0],[0,0],[0,1],[1,1]] },
  { name: 'west',  dir: [-1,0, 0], shade: 0.65, verts: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]], uv: [[0,0],[1,0],[1,1],[0,1]] },
];

// 光源用のソフトな放射グラデーション・テクスチャ（加算合成のハロー）。1度だけ生成。
let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const sz = 64;
  const cv = document.createElement('canvas'); cv.width = cv.height = sz;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, sz, sz);
  _glowTex = new THREE.CanvasTexture(cv);
  return _glowTex;
}

// pack(AssetPack) を渡すとテクスチャ表示。未指定/未解決ブロックは色キューブにフォールバック。
// biome: 葉/草/水の tint 色を決めるバイオームID（colors.js の BIOMES）。
export async function buildMesh(s, pack = null, biome = 'plains') {
  const W = s.width, H = s.height, L = s.length;
  // パレットごとのバイオーム tint 色（tint対象でなければ null）
  const tintByPalette = s.palette.map(name => biomeTint(name, biome));

  // 看板テキスト: ブロックエンティティから "x,y,z" -> {lines,color} を構築
  const signText = new Map();
  for (const be of (s.blockEntities || [])) {
    const id = (be.Id && be.Id.value) || (be.id && be.id.value) || '';
    if (!/sign/i.test(id)) continue;
    const pos = be.Pos && be.Pos.value;
    if (!pos) continue;
    let lines = [], color = 'black';
    const data = be.Data && be.Data.value;
    const ft = data && data.front_text && data.front_text.value;
    const msgs = ft && ft.messages && ft.messages.value && ft.messages.value.items;
    if (msgs) {
      lines = msgs.map(signLineText);
      color = (ft.color && ft.color.value) || 'black';
    } else {
      lines = [1, 2, 3, 4].map(i => (be['Text' + i] ? signLineText(be['Text' + i].value) : ''));
    }
    if (lines.some(l => l)) signText.set(`${pos[0]},${pos[1]},${pos[2]}`, { lines, color });
  }
  const signs = []; // 描画対象 {x,y,z,name,lines,color}

  // パレットごとにディスクリプタを解決（テクスチャ or 色）
  const descByPalette = new Array(s.palette.length);
  await Promise.all(s.palette.map(async (name, i) => {
    if (pack) {
      descByPalette[i] = await pack.describe(name);
    } else {
      const a = blockAppearance(name);
      descByPalette[i] = a ? { faces: null, opaque: a.opacity >= 1, color: a.color, opacity: a.opacity, emissive: a.emissive } : null;
    }
  }));

  const idx = (x, y, z) => x + z * W + y * W * L;
  const descAt = (x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= L) return null;
    return descByPalette[s.indices[idx(x, y, z)]];
  };
  const DELTA = { up: [0,1,0], down: [0,-1,0], north: [0,0,-1], south: [0,0,1], east: [1,0,0], west: [-1,0,0] };

  // マテリアルグループ: key 単位で頂点蓄積
  const groups = new Map();
  const groupFor = (key, make) => {
    let g = groups.get(key);
    if (!g) { g = { pos: [], norm: [], col: [], uv: [], index: [], count: 0, ...make() }; groups.set(key, g); }
    return g;
  };
  // クアッド1枚を追加（pos: [[x,y,z]*4], uv: [[u,v]*4]）
  // flip=true で三角形の巻き順を反転（モデル由来ジオメトリは外向き法線に対し巻きが逆のため）。
  const pushQuad = (g, x, y, z, pos, normal, uv, col, flip = false) => {
    const base = g.count;
    for (let k = 0; k < 4; k++) {
      g.pos.push(x + pos[k][0], y + pos[k][1], z + pos[k][2]);
      g.norm.push(normal[0], normal[1], normal[2]);
      g.col.push(col[0], col[1], col[2]);
      g.uv.push(uv[k][0], uv[k][1]);
    }
    if (flip) g.index.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else g.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    g.count += 4;
  };

  const lights = []; // 発光ブロック位置（トーチ等）→ ソフトな光スプライト用
  for (let y = 0; y < H; y++) {
    for (let z = 0; z < L; z++) {
      for (let x = 0; x < W; x++) {
        const pi = s.indices[idx(x, y, z)];
        const d = descByPalette[pi];
        if (!d) continue;
        if (d.emissive) lights.push({ x, y, z, color: d.color });
        // 看板でテキストがあれば収集
        if (/sign/.test(s.palette[pi] || '')) {
          const st = signText.get(`${x},${y},${z}`);
          if (st) signs.push({ x, y, z, name: s.palette[pi], lines: st.lines, color: st.color });
        }
        // tint対象はバイオーム色、それ以外はブロック色（色キューブ/乗算共通の基準色）
        const tcol = (tintByPalette[pi] != null) ? tintByPalette[pi] : d.color;
        const r = ((tcol >> 16) & 255) / 255;
        const gg = ((tcol >> 8) & 255) / 255;
        const b = (tcol & 255) / 255;

        if (d.quads) {
          // model elements 由来の実ジオメトリ
          for (const q of d.quads) {
            if (q.cull) {
              const dl = DELTA[q.cull];
              const n = dl && descAt(x + dl[0], y + dl[1], z + dl[2]);
              if (n && n.opaque) continue;
            }
            let g, col;
            if (q.tex) {
              g = groupFor('T|' + q.tex + '|' + (d.opaque ? 'o' : 't'), () => ({ tex: q.tex, transparent: !d.opaque }));
              // tint 面はブロック色を乗算（バイオーム着色の代用）、それ以外は白×陰影
              col = q.tint ? [r * q.shade, gg * q.shade, b * q.shade] : [q.shade, q.shade, q.shade];
            } else {
              g = groupFor('C|' + d.color + '|' + d.opacity, () => ({ tex: null, color: d.color, opacity: d.opacity }));
              col = [r * q.shade, gg * q.shade, b * q.shade];
            }
            pushQuad(g, x, y, z, q.pos, q.normal, q.uv, col, true); // モデル巻きは反転
          }
        } else {
          // 色キューブ（フォールバック）
          for (const f of FACES) {
            const n = descAt(x + f.dir[0], y + f.dir[1], z + f.dir[2]);
            if (n && n.opaque) continue;
            const sh = d.emissive ? 1.0 : f.shade;
            const g = groupFor('C|' + d.color + '|' + d.opacity, () => ({ tex: null, color: d.color, opacity: d.opacity }));
            pushQuad(g, x, y, z, f.verts, f.dir, f.uv, [r * sh, gg * sh, b * sh]);
          }
        }
      }
    }
  }

  const root = new THREE.Group();
  // マテリアル作成前に全テクスチャを先読み（読込中の透け抜けを防ぐ）
  if (pack) {
    const files = new Set();
    for (const g of groups.values()) if (g.tex) files.add(g.tex);
    await Promise.all([...files].map(f => pack.preload(f)));
  }

  for (const g of groups.values()) {
    if (g.count === 0) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.norm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    geo.setIndex(g.index);
    let mat;
    if (g.tex) {
      // 不透明面は alphaTest 無し（読込中でも透けない）。カットアウト面のみ alphaTest。
      // 巻き順は修正済みなので常に FrontSide（DoubleSide だとランタン等の内側裏面が透けて形が崩れる。
      // 十字モデル＝花/草は model 側が両面を定義済みなので FrontSide で両面とも出る）。
      mat = new THREE.MeshBasicMaterial({
        map: pack.texture(g.tex),
        vertexColors: true,
        alphaTest: g.transparent ? 0.5 : 0,
        transparent: false,
        side: THREE.FrontSide,
      });
    } else {
      mat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: g.opacity < 1,
        opacity: g.opacity,
        side: g.opacity < 1 ? THREE.DoubleSide : THREE.FrontSide,
        depthWrite: g.opacity >= 1,
      });
    }
    root.add(new THREE.Mesh(geo, mat));
  }
  // 光源のソフトなハロー（加算合成スプライト）。トーチ等がぼんやり光る。
  if (lights.length) {
    const tex = glowTexture();
    for (const l of lights) {
      const mat = new THREE.SpriteMaterial({
        map: tex, color: l.color, blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false, opacity: 0.55,
      });
      const sp = new THREE.Sprite(mat);
      sp.position.set(l.x + 0.5, l.y + 0.5, l.z + 0.5);
      sp.scale.set(1.8, 1.8, 1.8);
      root.add(sp);
    }
  }
  // 看板テキスト: 板の前面に薄い文字クアッドを world 空間で正しい向きに構築
  const UPV = new THREE.Vector3(0, 1, 0);
  for (const sg of signs) {
    const { name, x, y, z, lines, color } = sg;
    const { name: base, props } = splitState(name);
    const isWall = base.endsWith('_wall_sign');
    // 文字が向く方向 n（wall=facing / standing=rotation）
    let n;
    if (isWall) { const d = DELTA[props.facing] || DELTA.south; n = new THREE.Vector3(d[0], d[1], d[2]); }
    else { const a = (Number(props.rotation) || 0) * Math.PI / 8; n = new THREE.Vector3(Math.sin(a), 0, Math.cos(a)); }
    const right = new THREE.Vector3().crossVectors(UPV, n).normalize(); // 正面から見た右
    const cy = isWall ? 8.5 : 11;                 // 文字中心の高さ(px)
    const depth = isWall ? 7.6 : 1.4;             // 板前面までのオフセット(px)
    const center = new THREE.Vector3(8, cy, 8).addScaledVector(n, depth);
    const hw = 6.5, hh = 3.4;                      // 文字面の半寸(px)
    const corner = (sx, sy) => center.clone().addScaledVector(right, sx * hw).addScaledVector(UPV, sy * hh);
    const cs = [corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)]; // TL,TR,BR,BL
    const posArr = [];
    for (const c of cs) posArr.push(x + c.x / 16, y + c.y / 16, z + c.z / 16);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const tex = signTexture(lines, color);
    tex.flipY = false; // canvas は上が v=0
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: false, alphaTest: 0.4, side: THREE.DoubleSide, depthWrite: true,
    });
    root.add(new THREE.Mesh(geo, mat));
  }
  root.position.set(-W / 2, -H / 2, -L / 2);
  const pivot = new THREE.Group();
  pivot.add(root);
  pivot.userData.dims = { W, H, L };
  return pivot;
}

export class Viewer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fc4e8);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);

    this.mesh = null;
    this.moveSpeed = 8;          // units/sec（モデルサイズに応じて frame で更新）
    this.panSpeed = 0.05;        // units/px（同上）
    this.dollyStep = 2;          // units/notch（同上）
    this.yaw = 0;                // ヨー(rad, world Y まわり)
    this.pitch = 0;             // ピッチ(rad, ローカル X まわり)
    this._setupFlyControls();
    this._setupMouseLook(canvas);

    this._resize();
    addEventListener('resize', () => this._resize());
    this.clock = new THREE.Clock();
    const tick = () => {
      this._updateFly(this.clock.getDelta());
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(tick);
    };
    tick();
  }

  // カメラの向きを yaw/pitch から再構成（その場で視点回転 = FPS マウスルック）
  _applyOrientation() {
    this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  _setupMouseLook(canvas) {
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    let dragging = null;          // 0=左(視点回転) / 1or2=パン
    let px = 0, py = 0;
    canvas.addEventListener('pointerdown', (e) => {
      dragging = e.button;
      px = e.clientX; py = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch {}
    });
    canvas.addEventListener('pointermove', (e) => {
      if (dragging === null) return;
      const dx = e.clientX - px, dy = e.clientY - py;
      px = e.clientX; py = e.clientY;
      if (dragging === 0) {
        // その場で視点回転
        const sens = 0.0025;
        this.yaw -= dx * sens;
        this.pitch -= dy * sens;
        this._applyOrientation();
      } else {
        // 中・右ドラッグ = 画面の水平/垂直方向へ平行移動（CAD 風パン）
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
        this.camera.position.addScaledVector(right, -dx * this.panSpeed);
        this.camera.position.addScaledVector(up, dy * this.panSpeed);
      }
    });
    const end = (e) => {
      if (dragging !== null) { try { canvas.releasePointerCapture(e.pointerId); } catch {} }
      dragging = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    // ホイール = 視線方向へ前後ドリー（ズーム相当）
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const fwd = new THREE.Vector3();
      this.camera.getWorldDirection(fwd);
      const dir = e.deltaY < 0 ? 1 : -1;
      this.camera.position.addScaledVector(fwd, dir * this.dollyStep);
    }, { passive: false });
  }
  _setupFlyControls() {
    // マイクラ・クリエ風フライト。WASD=水平移動 / Space=上昇 / Shift=下降。
    // 移動キーのダブルタップでダッシュ（離すと解除）。
    this.keys = Object.create(null);
    this.dashing = false;
    this._lastTap = Object.create(null);
    const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight']);
    const DASH_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);

    addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (!MOVE_KEYS.has(e.code)) return;
      e.preventDefault();
      if (!e.repeat) {
        // ダブルタップ判定（同じ移動キーを短時間に2回）
        if (DASH_KEYS.has(e.code)) {
          const now = performance.now();
          if (now - (this._lastTap[e.code] || 0) < 300) this.dashing = true;
          this._lastTap[e.code] = now;
        }
      }
      this.keys[e.code] = true;
    });
    addEventListener('keyup', (e) => {
      if (!MOVE_KEYS.has(e.code)) return;
      this.keys[e.code] = false;
      // 全移動キーが離れたらダッシュ解除
      const anyHeld = [...MOVE_KEYS].some(k => this.keys[k]);
      if (!anyHeld) this.dashing = false;
    });
    // フォーカス喪失時にキー状態をリセット（押しっぱなし暴走を防ぐ）
    addEventListener('blur', () => { this.keys = Object.create(null); this.dashing = false; });
  }

  _updateFly(dt) {
    const k = this.keys;
    const ax = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);   // 右(+)/左(-)
    const az = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);   // 前(+)/後(-)
    const ay = (k.Space ? 1 : 0) - ((k.ShiftLeft || k.ShiftRight) ? 1 : 0); // 上(+)/下(-)
    if (ax === 0 && az === 0 && ay === 0) return;

    // カメラの向きから水平な前方/右方向を求める
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, this.camera.up).normalize();

    const move = new THREE.Vector3();
    move.addScaledVector(fwd, az);
    move.addScaledVector(right, ax);
    move.y += ay;
    if (move.lengthSq() > 1e-9) move.normalize();

    const speed = this.moveSpeed * (this.dashing ? 3 : 1) * dt;
    move.multiplyScalar(speed);
    this.camera.position.add(move);
  }

  _resize() {
    const c = this.renderer.domElement;
    const w = c.clientWidth, h = c.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  setMesh(pivot, frameCamera = true) {
    if (this.mesh) { this.scene.remove(this.mesh); disposeTree(this.mesh); }
    this.mesh = pivot;
    this.scene.add(pivot);
    if (frameCamera) this.frame();
  }
  frame() {
    const { W, H, L } = this.mesh.userData.dims;
    const r = Math.max(W, H, L);
    this.moveSpeed = Math.max(6, r * 0.5);   // 移動速度
    this.panSpeed = Math.max(0.02, r * 0.004); // パン速度(units/px)
    this.dollyStep = Math.max(0.5, r * 0.06);  // ドリー量(units/notch)
    const d = r * 1.6;
    // モデル中心(原点)を見る位置に配置し、その方向を向く
    this.camera.position.set(d, d * 0.8, d);
    const dir = new THREE.Vector3(0, 0, 0).sub(this.camera.position).normalize();
    this.yaw = Math.atan2(-dir.x, -dir.z); // -z を正面とする YXZ ヨー
    this.pitch = Math.asin(dir.y);
    this._applyOrientation();
  }
}

function disposeTree(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}
