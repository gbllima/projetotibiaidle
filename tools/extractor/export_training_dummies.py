"""Export full-resolution training dummy sprites for the online training room.

Icons in item-icons/ are squashed to 32×32 for inventory — house dummies need
their native tile size (often 64×64) composited without downscaling.

    python tools/extractor/export_training_dummies.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from PIL import Image  # noqa: E402

from tibia.appearances import Appearances  # noqa: E402
from tibia.catalog import SpriteCatalog  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "cliente pc" / "things" / "luminaris"
OUT = Path(__file__).parent / "out" / "assets"
SCENE_DIR = OUT / "item-scenes"
MANIFEST = OUT / "item-scenes.json"

# All dummies used in apps/web/src/trainingRooms.ts
DUMMY_IDS = [
    15710, 15711, 28558, 28559, 28561, 28563, 50435, 12047, 12048, 50143,
]

GROUP_ORDER = (2, 0, 1)


def pick_sprite_id(appearance) -> int | None:
    by_kind = {group.kind: group for group in appearance.frame_groups}
    ordered = [by_kind[k] for k in GROUP_ORDER if k in by_kind]
    ordered.extend(g for g in appearance.frame_groups if g.kind not in GROUP_ORDER)
    for group in ordered:
        info = group.sprite_info
        sid = info.sprite_at(phase=0, direction=2, addon=0, mount=0, layer=0)
        if sid is not None:
            return sid
        if info.sprite_ids:
            return info.sprite_ids[0]
    return None


def main() -> None:
    catalog = SpriteCatalog(ASSETS)
    appearances = Appearances.load(catalog.appearances_path)
    SCENE_DIR.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, dict] = {}
    if MANIFEST.exists():
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

    written = 0
    for item_id in DUMMY_IDS:
        appearance = appearances.objects.get(item_id)
        if appearance is None:
            print(f"skip {item_id}: no appearance")
            continue
        sprite_id = pick_sprite_id(appearance)
        if sprite_id is None:
            print(f"skip {item_id}: no sprite")
            continue
        tile = catalog.get_sprite(sprite_id)
        if tile is None:
            print(f"skip {item_id}: sprite {sprite_id} missing")
            continue

        image = tile.convert("RGBA")
        out_path = SCENE_DIR / f"{item_id}.webp"
        image.save(out_path, format="WEBP", lossless=True, quality=95, method=6)
        manifest[str(item_id)] = {
            "file": f"item-scenes/{item_id}.webp",
            "width": image.width,
            "height": image.height,
            "name": appearance.name or f"item {item_id}",
        }
        written += 1
        print(f"  {item_id} -> {image.width}x{image.height} ({appearance.name!r})")

    MANIFEST.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"item-scenes: {written} sprites -> {MANIFEST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
