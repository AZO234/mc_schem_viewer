# mc schem viewer

*Languages: English | [日本語 (Japanese)](README_ja.md)*

A browser-based 3D viewer for Minecraft `.schem` (WorldEdit / Sponge Schematic v3) and
`.litematic` (Litematica) files. It can rotate the whole build in 90° steps and re-export it
as a `.schem` with the rotation baked in. (Even when loading a `.litematic`, the export is in
`.schem` format.)

## Usage

Because it uses ES modules and `fetch`, open it through a local HTTP server (opening via
`file://` directly will not work).

```bash
cd mc_schem_viewer
python3 -m http.server 8765
# open http://localhost:8765/ in your browser
```

- On startup it automatically loads `planes_house.schem` from the same folder.
- To load another file (`.schem` / `.litematic`), use **📂 Open** or **drag & drop** it onto the window.
- **💾 Save rotation**: downloads `<name>_rot<angle>.schem` with the current rotation applied (a red badge is shown while rotated).
- **Display**: switch between color cubes / latest textures (textures are always the latest release only).
- The **compass** at the top-left of the menu tracks the current view (up = look direction) and shows N/E/S/W.
- Light-emitting blocks such as torches glow softly (a soft halo).

## Getting textures

Real textures require Minecraft's assets, which cannot be redistributed, so they are fetched
locally. `tools/fetch_assets.mjs` downloads the official assets and extracts them into
`assets/<latest>/`. **Only the latest release is treated as canonical**; past versions are not
fetched or kept (older versions are deleted automatically on fetch).

```bash
node tools/fetch_assets.mjs            # fetch the latest release
node tools/fetch_assets.mjs --list     # show the latest release / snapshot
```

- Source: Mojang's version manifest → client.jar → `textures/{block,entity/chest}`, `models/block`, `blockstates`.
- Entity textures (block entities such as chests) are also fetched. In recent Minecraft versions, beds/signs are usually turned into regular block models.
- `assets/versions.json` records the latest id and DataVersion (auto-selected on startup).
- When assets are not available, it automatically falls back to **color-cube display**.
- **⬇ Texture DL button**: fetches the latest `client.jar` from Mojang's official CDN **inside the browser**,
  unpacks the ZIP itself (`DecompressionStream`), and applies the textures. Because each user's browser
  fetches it directly, it does not constitute redistribution, so even the GitHub Pages build can show real
  textures. The button is disabled when textures are already installed.

## Publishing on GitHub Pages

It is a static site (no build step, relative paths), so it can be published as-is.
**However, Mojang assets cannot be redistributed**, so `assets/` is not included in the repository
(it is already in `.gitignore`). The published site shows **color cubes**, and each user runs
`fetch_assets.mjs` locally to see real textures.

```bash
git init && git add . && git commit -m "mc schem viewer"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
# On GitHub: Settings → Pages → Source: select "GitHub Actions"
```

- CI: `.github/workflows/pages.yml` runs **syntax check → automatic Pages deploy** on push (official `actions/*` only, minimal permissions, zero dependencies).
- If you need stricter supply-chain hardening, pin `@v4` etc. in the workflow to full commit SHAs.
- `.nojekyll` is included (disables Pages' Jekyll processing).
- When published, the panel shows a note that textures are not fetched (= color cubes).
- `planes_house.schem` is bundled as a demo. If you do not want to publish it, delete it and load files via drag & drop on startup.

### Controls

| Action | Effect |
|---|---|
| Left 90° / Right 90° / 0° | Rotate the whole build (doors, stairs, fences, etc. orient with it). 0° also resets the view. |
| ↻ Redraw | Rebuild the current mesh (view is kept). |
| WASD | Move horizontally relative to the view (Minecraft creative-flight style). |
| W/A/S/D double-tap | Dash (released when you let go of the movement key). |
| Space / Shift | Ascend / descend. |
| Left drag | Rotate the view in place (FPS mouse-look). |
| Mouse wheel | Dolly forward/backward along the look direction (zoom-like). |
| Middle button (wheel push) / right drag | Pan (CAD-style). |

## Structure

| File | Role |
|---|---|
| `index.html` | UI and layout (resolves three via importmap). |
| `src/nbt.js` | NBT read/write + gzip (browser-native `DecompressionStream`/`CompressionStream`). |
| `src/schem.js` | schem parsing, varint decoding, 90° rotation, re-serialization. |
| `src/litematic.js` | Litematica (.litematic) parsing (palette + bit-packed long array expansion, multi-region merge). Converts to the internal format. |
| `src/jar.js` | In-browser fetch of Mojang's official client.jar + self-contained ZIP extraction (for the texture DL button, zero dependencies). |
| `src/colors.js` | Block → representative color (fallback when textures are unresolved). |
| `src/textures.js` | blockstate/model resolution + texture loading (AssetPack). |
| `src/viewer.js` | three.js rendering (face culling + shading + textures) / camera controls. |
| `src/main.js` | UI control for loading / rotation / saving / version switching. |
| `tools/fetch_assets.mjs` | Official asset fetch script (version selection). |
| `vendor/` | three.js r160 (MIT, vendored, no external dependencies). |
| `assets/<ver>/` | Fetched MC textures etc. (generated artifacts, not redistributable). |

## Design notes

- **Rotation**: 90° clockwise viewed from above (north → east → south → west). Position `(x,z) → (L-1-z, x)`,
  and block-state `facing` / `axis` / `north..west` (fence/wall connections) are rotated at the same time.
  A `chest`'s `type` (left/right), a `stairs`' `shape`, and a `door`'s `hinge` are facing-relative, so they stay unchanged.
- **Zero-dependency operation**: no npm packages, no build step. three.js is vendored at a fixed version.
- Verified: NBT round-trip equality / returning to the original after 4 rotations / dimension swap / facing rotation / position mapping.

## Phase 2: Real textures + actual-shape geometry (implemented)

- `blockstate` → variant (props match / rotation x,y) → `model` parent chain → `#ref` resolution. The new `{sprite}` form is also interpreted.
- **Block model `elements` (the `from`/`to` boxes) are generated as actual geometry**: stairs = steps, slabs = thin plates,
  fences = thin posts, glass panes = thin plates, doors = thin plates. Per-face `uv` / texture rotation / element `rotation` /
  blockstate `x`/`y` rotation are all applied (around the center 8,8,8).
- Block entities (chest/bed/sign, etc.) have no block model, so `syntheticModel()` approximates them with simple shapes
  reusing existing block textures (chest = oak box / bed = low wool block / sign = thin plate).
  furnace, crafting_table, anvil, etc. use normal models, so they are shown with textures as-is.
- Any other unresolved block falls back to the color cube in `src/colors.js`.
- Rendering uses `MeshBasicMaterial` + `map` (`NearestFilter`, no mipmaps) to keep the pixelated look.
  Cutouts use `alphaTest=0.5`, translucent faces use `DoubleSide`. Shading is computed from normals and baked into `vertexColors`.
- Face culling skips a quad when the neighbor in its `cullface` direction is an opaque block.

## Phase 3 (planned): Lighting

- `MeshBasicMaterial` → `MeshLambert`/`MeshStandard`, sun (directional) + ambient/hemisphere light.
- **Baked AO** at voxel corners for depth (the baked shading will be replaced by real lights at this stage).
- Light-emitting blocks (torches, etc.) as emissive or point lights.
