# Thais Depot

The city uses its own 19 x 21 surface cut, including the main hall's north,
south and side walls. Hunt maps keep their existing 13 x 11 cuts.

From the repository root, regenerate the map, collision metadata and atlas:

```powershell
node tools/mapcut/cut-thais-depot.mjs
py -3 tools/mapcut/pack-thais-depot.py
```

The source is `servidor/data-global/world/world.otbm`. Bounds are declared in
`cut-thais-depot.mjs`. Movement and rendering share
`packages/data/generated/thais-depot.json`; blocking flags come from the client
appearance data. The small dedicated atlas lives in `apps/web/public/city-assets`
and is included in production builds.

Spawn is the center tile. After changing bounds, verify that spawn remains
walkable and update the merchant and navigation tests if needed:

```powershell
pnpm.cmd --filter @tibia-idle/server exec vitest run test/city.test.ts
pnpm.cmd --filter @tibia-idle/web build
```
