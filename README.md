# mc schem viewer

Minecraft の `.schem`（WorldEdit / Sponge Schematic v3）と `.litematic`（Litematica）を
ブラウザで 3D 表示するビューア。建物全体を 90° 単位で回転し、回転後の `.schem` として再保存できる。
（`.litematic` 読込時も保存は `.schem` 形式になる）

## 使い方

ES モジュールと `fetch` を使うため、ローカル HTTP サーバ経由で開く（`file://` 直開きは不可）。

```bash
cd mc_schem_viewer
python3 -m http.server 8765
# ブラウザで http://localhost:8765/ を開く
```

- 起動時、同じフォルダの `planes_house.schem` を自動で読み込む
- 別ファイル（`.schem` / `.litematic`）は **📂開く** か、ウィンドウへ **ドラッグ&ドロップ**
- **💾回転を保存**: 現在の回転を反映した `<名前>_rot<角度>.schem` をダウンロード（回転中は赤バッヂ表示）
- **表示**: 色キューブ / 最新テクスチャを切替（テクスチャは常に最新版のみ）
- メニュー左上の**コンパス**は現在の視点（上＝視線方向）に追従して N/E/S/W を表示
- トーチ等の発光ブロックはぼんやり光る（ソフトなハロー）

## テクスチャの取得

本物テクスチャ表示には MC のアセットが必要（再配布不可のためローカル取得）。
`tools/fetch_assets.mjs` が公式アセットを取得して `assets/<latest>/` に展開する。
**常に最新リリースのみを正規**とし、過去バージョンは取得・保持しない（取得時に旧版は自動削除）。

```bash
node tools/fetch_assets.mjs            # 最新リリースを取得
node tools/fetch_assets.mjs --list     # 最新リリース/スナップショットを表示
```

- 取得元: Mojang の version manifest → client.jar → `textures/{block,entity/chest}` `models/block` `blockstates`
- entity テクスチャ（chest 等のブロックエンティティ）も取得。bed/sign は新しめの MC では通常ブロックモデル化されている。
- `assets/versions.json` に最新の id と DataVersion を記録（起動時に自動選択）。
- アセット未取得時は自動で **色キューブ表示** にフォールバックする。

## GitHub Pages で公開

静的サイト（ビルド不要・相対パス）なのでそのまま公開できる。
**ただし Mojang アセットは再配布不可**のため `assets/` はリポジトリに含めない（`.gitignore` 済み）。
公開サイトは **色キューブ表示**になり、本物テクスチャは各自が手元で `fetch_assets.mjs` を実行して見る。

```bash
git init && git add . && git commit -m "mc schem viewer"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
# GitHub の Settings → Pages → Source: GitHub Actions を選択
```

- CI: `.github/workflows/pages.yml` が push 時に**構文チェック→Pages 自動デプロイ**を実行（公式 `actions/*` のみ・権限最小・依存ゼロ）。
- より厳格なサプライチェーン対策が必要なら、ワークフロー内の `@v4` 等を full commit SHA に固定する。
- `.nojekyll` 同梱（Pages の Jekyll 処理を無効化）。
- 公開時はパネルに「テクスチャ未取得＝色キューブ」の旨を表示する。
- `planes_house.schem` はデモとして同梱。公開したくない場合は削除し、起動時はドラッグ&ドロップで読み込む。

### 操作

| 操作 | 効果 |
|---|---|
| 左90° / 右90° / 0° | 建物全体を回転（ドア・階段・フェンス等の向きも追従）。0° は視点リセット |
| ↻ 再描画 | 現在のメッシュを再構築（視点は維持） |
| WASD | 視点基準で水平移動（マイクラ・クリエ風フライト） |
| W/A/S/D ダブルタップ | ダッシュ（移動キーを離すと解除） |
| Space / Shift | 上昇 / 下降 |
| 左ドラッグ | その場で視点回転（FPS マウスルック） |
| ホイール回転 | 視線方向へ前後ドリー（ズーム相当） |
| 中ボタン(ホイールプッシュ)・右ドラッグ | 平行移動（CAD 風パン） |

## 構成

| ファイル | 役割 |
|---|---|
| `index.html` | UI とレイアウト（importmap で three を解決） |
| `src/nbt.js` | NBT 読み書き＋gzip（ブラウザ標準 `DecompressionStream`/`CompressionStream`） |
| `src/schem.js` | schem の解釈・varint デコード・90°回転・再シリアライズ |
| `src/litematic.js` | Litematica (.litematic) の解釈（パレット＋ビットパック long 配列展開・複数リージョン統合）。内部形式へ変換 |
| `src/colors.js` | ブロック→代表色（テクスチャ未解決時のフォールバック） |
| `src/textures.js` | blockstate/model 解決＋テクスチャロード（AssetPack） |
| `src/viewer.js` | three.js 描画（面カリング＋陰影＋テクスチャ）／カメラ操作 |
| `src/main.js` | 読み込み/回転/保存/バージョン切替の UI 制御 |
| `tools/fetch_assets.mjs` | 公式アセット取得スクリプト（バージョン選択） |
| `vendor/` | three.js r160（MIT, ベンダリング済み・外部依存なし） |
| `assets/<ver>/` | 取得した MC テクスチャ等（生成物・再配布不可） |

## 設計メモ

- **回転**: 構造を上から見て時計回りに 90°（北→東→南→西）。位置 `(x,z) → (L-1-z, x)`、
  ブロック状態の `facing` / `axis` / `north..west`（フェンス・壁の接続）も同時に回す。
  `chest` の `type`(left/right) や `stairs` の `shape`、`door` の `hinge` は facing 相対のため不変。
- **依存ゼロ運用**: npm パッケージ・ビルド工程なし。three.js は固定版をベンダリング。
- 検証: NBT 往復一致 / 4回転で元に戻る / 寸法入替 / facing 回転 / 位置対応 を確認済み。

## Phase2: 本物テクスチャ＋実形状ジオメトリ（実装済み）

- `blockstate` → variant（props 一致／回転 x,y）→ `model` 親チェーン → `#ref` 解決。新形式 `{sprite}` も解釈。
- **block model の `elements`（`from`/`to` の箱）を実ジオメトリとして生成**：階段＝段差、スラブ＝薄板、
  フェンス＝細い支柱、ガラス窓＝薄板、ドア＝薄板。面ごとの `uv`・テクスチャ回転・要素の `rotation`・
  blockstate の `x`/`y` 回転をすべて適用（中心 8,8,8 まわり）。
- ブロックエンティティ（chest/bed/sign 等）は block model が無いため、`syntheticModel()` で
  既存 block テクスチャを流用した簡易シェイプで近似（chest=オーク箱／bed=低い羊毛ブロック／sign=薄板）。
  furnace・crafting_table・anvil 等は通常モデルなのでそのままテクスチャ表示。
- それ以外の未解決ブロックは `src/colors.js` の色キューブにフォールバック。
- 描画は `MeshBasicMaterial` + `map`（`NearestFilter`・mipmap 無し）でドット感維持。
  カットアウトは `alphaTest=0.5`、半透明面は `DoubleSide`。陰影は法線から算出し `vertexColors` に焼き込み。
- 面カリングは各クアッドの `cullface` 方向の隣が不透明ブロックなら省略。

## Phase3（予定）: ライティング

- `MeshBasicMaterial` → `MeshLambert`/`MeshStandard`、太陽（directional）＋環境光/hemisphere。
- ボクセル角の**ベイク AO** で奥行き（焼き込み陰影はこの段で実ライトへ置換）。
- 発光ブロック（torch 等）は emissive または点光源。
