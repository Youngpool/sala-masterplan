# SALA — Interactive Master Plan

Code from the Figma section "UI MASTER PLAN SECTION" (file Yf13AguwKZMteDUXNND9at, node 31:3900).
Plain HTML/CSS/JS. Nothing to build or install.

## Opening it
- `index.html`: the website section (Bản đồ tổng quan / Bản đồ khu đô thị)
- `masterplan.html`: the full-screen Masterplan page (3 tabs: Tổng quan / Khu đô thị / Tiện ích)

Double-click a file to open it in Chrome or Edge. It works offline from file://.
If you need a local server, run `npx serve .` or `python -m http.server` in this folder.

## v4.9
- Opening the urban 3D map no longer lights up every road. Only the subtle running comets show; a road lights up only on hover or tap.

## v4.8
- The hover road name is always the top label: above project tags and bridge badges. The bridge nodes now live in the marker layer.
- Shop House = the long strip (2407). Sarimi = 2405 + the buildings 2406.

## v4.2: mode button, bridge leaders, road names on hover
- **Section ⇄ Page** is one demo-only button in the left control column, in the same style as zoom and reload. It has a swap icon (⇄), and its tooltip reads "DEMO · Chuyển sang chế độ Page / Chuyển về chế độ Section". Remove it (`.mm-ctrl--mode` in `app.js`) when the pages go live behind the real menu hub. The current view carries over (`#view=urban|tod|amenity`). Hrefs come from `window.SALA_MODE_HREF` (default `index.html` / `masterplan.html`).
- **Bridges:** one node per bridge, a dot with its name badge right beside it and no leader line. When the bridge is outside the frame, the dot waits on the frame edge with the badge on the inner side. As the bridge comes into the frame, the same dot travels onto it and the badge stays next to it, on the designer's side (`dir`). The badge moves to another side if that spot is taken, gliding when it swaps sides. Clicking an off-screen badge glides the map to the bridge.
- **Road names on hover** (both maps): the gold Figma road label (brand #BC8E49, like the Nguyễn Cơ Thạch pill) (pill, leader and dot) pops up at the pointer's spot on the road and follows it along the road. It hangs below the road near the top of the frame. Streets have no permanent label on any map, including the 3D page: the name only appears while the road is hovered, as on the overview.

## v4.0: lit buildings, off-screen bridge nodes
- Hovering or selecting a project shows the building cut out from the dusk render (`assets/img/map-3d-dusk.jpg`, image `Group 2147223724` in Figma frame 57:7825) by its outline, so the building lights up. The gold Figma tint stays very light on top (16%), with the outline stroke and the comet running around it.
- Bridges outside the frame keep a node pinned to the frame edge, with an arrow pointing to the bridge and its name. The node keeps clear of the zoom controls and other nodes. Clicking it glides the map to the bridge. While a bridge is off-screen, its own label is hidden so it never shows twice.

## v3.9: bridge nodes on the real bridges, lighter idle roads
- The bridge anchors were read from `map-3d.jpg` and sit on the bridge decks. Thủ Thiêm 2 is the inverted-Y cable-stayed bridge, Thủ Thiêm 3 the single-pylon bridge (confirmed by Hyun), Thủ Thiêm 1 the long bridge on the right, and Thủ Thiêm 4 the arch bridge on the left. Cầu đi bộ (confirmed by Hyun) keeps the designer's Figma anchor, because its deck is not clearly visible in the render.
- Idle road lines on the 3D map are 0%: only the running comet shows. The bold gold Figma stroke only appears on hover.

## v3.8: one road logic on both maps
- Road lights on the urban 3D map use the same logic and look as the overview (`ROAD_FX` + `roadLights()` in `app.js`): the same gold comet with the same size and timing, and the same hover: the map dims, the road lights up tapered to 0% at both ends, and the other comets fade. On touch, tap a road to toggle. Sizes are scaled by 1.289 because the 3D roads are drawn at that scale.
- Where a building outline sits on top of a road (e.g. the Shop House strip on Nguyễn Cơ Thạch), the building gets the hover.

## v3.7: building outlines from Figma (frame "Map" 43:7639)
- The hover and selection zones for projects use the outlines Hyun drew in Figma (Vector 2392 and 2401–2408). They are converted to map space in `js/data.js` → `projectZones`. Each outline keeps its own fill and stroke gradient from Figma; Saritown has a multi-stop gradient.
- Mapping: 2392 Sarene residence, 2401 Sadora, 2408 Saroma Villa, 2404 Saritown, 2403 Savila, 2405 + 2406 Sarimi (the buildings), 2402 Sarina, 2407 Shop House (the long strip along Nguyễn Cơ Thạch). Sarene has no outline yet.
- Hover: the map dims, the building shows its Figma fill and stroke, and a soft comet runs once around the outline (0% at head and tail).

## v3.6: depth on the 3D master map (Figma Map 49:7667)
- Base image: exposure -0.12, saturation -0.44 and temperature +0.05 (as CSS `filter`), plus 20% black (`.mm-3d-dim`) and a progressive blur at the top (`.mm-dof`).
- The SALA core is shown on top in full colour and sharpness (`.mm-3d-focus`) through a soft mask. `assets/img/map-3d-focus.png` is Figma's Vector 2373 with its 85.6px layer blur, so camera pan and zoom stay smooth.
- The soft-light gradient sits on top, as in Figma.

## v3.2: brown road highlight on the overview map
- The 4 brown arterial roads on `map-tong.jpg` (Võ Văn Kiệt – Mai Chí Thọ, Nguyễn Hữu Cảnh, Cao tốc Long Thành – Dầu Giây, Đỗ Xuân Hợp) are traced from the image into SVG paths in `js/data.js` → `overviewRoads`. The Figma file has no separate vector for them.
- Idle: a soft gold light runs along each axis as a comet. It fades in at the head and out along the tail, with no hard dash ends. Every road light (comet, opening sweep, hover highlight and the static line on the 3D map) is drawn through a mask of soft dots along the path (`makeLight` in `app.js`). Brightness is shaped along the path and always tapers to 0% at both ends of the road. The 3D map's road lights use the same effect. When the map opens, the axes are drawn on one after another.
- Hover (tap on mobile): the map dims slightly, the road glows gold with a bright core drawn along it.

## v3: cloud layer and clean Figma images
- The maps use only the original image layers from Figma, with no baked-in clouds. Figma effects are rebuilt in CSS: progressive blur at the top of the 3D image (6.5px → 0 at 56%), the soft-light gradient, and the 30% shade on the top-view.
- The TOD 2D map has 4 separate Figma layers: base, direction arrows (5.4), transit icons (5.3) and dotted routes (5.2). After the clouds part, the routes spread out from the center, then the icons and arrows fade in.
- Clouds are a single WebGL shader layer on top of the map, like explore.ownprimland.com: two cloud layers (near and far), lit from the top left, drifting slowly. When idle, the clouds stay at the edges of the frame and follow the camera with parallax. On transition, the clouds thicken while flying into the bank, open a gap from the center, then sweep past the camera.

## v2 — GSAP
- Motion uses GSAP 3.14.2 (bundled in `js/vendor/gsap.min.js`, so it works offline). The approach follows the official greensock/gsap-skills: timelines, `autoAlpha`, transform aliases, `ticker`.
- Cloud transition: the 2 Figma cloud bands close in, with ~54 cloud puffs (cut from the Figma cloud texture) flying toward the camera on a canvas, Three.js "Clouds" demo style. Then they part and the map zooms back into place.
- Building hover: outline traced per building on the 3D image. The fill and stroke use the Figma material from Vector 2392 (gold gradient #BC8E49→#564121 @60%, stroke #E1CFA6). The rest of the map dims to spotlight the building and a light line runs around the outline. Sarene residence uses the exact Figma shape.
- Roads: hovering a road or its label (page) lights up a glowing run along it and dims the other roads.
- Drag has inertia (the map keeps gliding after you let go). Markers and pins appear in a stagger, and the panel content flows in.

## Interactions
- Pan by dragging. Zoom with the +/- buttons, by double-clicking, or with Ctrl/⌘ + scroll (in the section). On the full page, plain scroll zooms. On phones, use two fingers.
- "Bản đồ tổng quan" mode: the location map. Clicking the SALA pin flies through the clouds to the green TOD plan, still in "Bản đồ tổng quan" mode (title "Dòng chảy kết nối", with the in-map Khu đô thị / Tiện ích tab bar as in Figma). Clicking "Bản đồ tổng quan" again returns to the location map.
- "Bản đồ khu đô thị" mode: flies through the clouds straight to the 3D master map, where light runs along the roads. The Tiện ích tab crossfades to the top-view amenity map.
- Hovering a project label raises it (Sarene residence also highlights its zone). Clicking a label opens the "Dự án" panel and the other labels turn gray.
- The Tiện ích tab shows the top-view map with its pins. Clicking a pin enlarges it, turns it red and opens the "Tiện ích" panel.
- Reload: clouds cover the map, the SALA logo spins, and the view resets.
- Mobile: the panel becomes a bottom sheet. On the Masterplan page in portrait, a "Hãy xoay ngang điện thoại" prompt appears. Landscape uses the 932×430 layout.

## Text
- The UI only shows text that exists in Figma. There is no hover card, no amenity tooltip, no road names along the roads, no gesture hints and no "đang cập nhật" placeholder.

## Editing content
- `js/data.js` holds titles, project, road label and amenity coordinates, and panel content.
  Items with `data: null` have no content in the Figma file yet, so clicking them does not open the panel. Add `data` to enable it.
- `js/app.js` → `CONFIG.planBeforeMaster`: set it to `false` to go straight to the 3D map instead of showing the 2D plan first.
- Fonts: the design uses Cerigo Std VU / Optima VU. If they are installed on the machine they load automatically.
  Otherwise the page falls back to Alegreya / Alegreya Sans from Google Fonts.
