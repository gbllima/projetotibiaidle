"""Report sprite volume per category so we can size the atlases before packing."""

from __future__ import annotations

import collections
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from tibia import Appearances, SpriteCatalog  # noqa: E402

ASSETS = Path(r"C:\Users\Dev Alx\Desktop\Cursor pro idle\cliente pc\things\luminaris")


def area(catalog: SpriteCatalog, ids: set[int]) -> int:
    total = 0
    for sid in ids:
        sheet = catalog.find_sheet(sid)
        if sheet:
            w, h = sheet.tile_size
            total += w * h
    return total


def main() -> None:
    catalog = SpriteCatalog(ASSETS)
    print(f"sheets={len(catalog.sheets)}  max_sprite_id={catalog.max_sprite_id}")

    app = Appearances.load(catalog.appearances_path)
    print(
        f"objects={len(app.objects)} outfits={len(app.outfits)} "
        f"effects={len(app.effects)} missiles={len(app.missiles)}"
    )

    print(f"\n{'category':<12} {'entries':>8} {'sprites':>9} {'px area':>13} {'RGBA MB':>9}")
    print("-" * 56)
    per_category: dict[str, set[int]] = {}
    for name in ("outfit", "effect", "missile", "object"):
        entries = app.category(name)
        ids: set[int] = set()
        for a in entries.values():
            ids |= a.all_sprite_ids
        per_category[name] = ids
        px = area(catalog, ids)
        print(f"{name:<12} {len(entries):>8} {len(ids):>9} {px:>13,} {px * 4 / 1024 / 1024:>9.1f}")

    everything: set[int] = set()
    for ids in per_category.values():
        everything |= ids
    px = area(catalog, everything)
    print("-" * 56)
    print(f"{'TOTAL':<12} {'':>8} {len(everything):>9} {px:>13,} {px * 4 / 1024 / 1024:>9.1f}")

    # Layer usage tells us how many creatures need the recolor shader.
    layered = sum(
        1
        for a in app.outfits.values()
        if any(g.sprite_info.layers >= 2 for g in a.frame_groups)
    )
    mounts = sum(
        1
        for a in app.outfits.values()
        if any(g.sprite_info.pattern_depth >= 2 for g in a.frame_groups)
    )
    addons = sum(
        1
        for a in app.outfits.values()
        if any(g.sprite_info.pattern_height >= 3 for g in a.frame_groups)
    )
    print(f"\noutfits with recolor mask (layers>=2): {layered}")
    print(f"outfits with mount pattern  (depth>=2): {mounts}")
    print(f"outfits with addons        (height>=3): {addons}")

    tile_dist = collections.Counter()
    for sid in per_category["outfit"]:
        sheet = catalog.find_sheet(sid)
        if sheet:
            tile_dist[sheet.tile_size] += 1
    print(f"outfit tile sizes: {dict(tile_dist)}")

    # Objects are the bulk. Most are map decoration we will never draw.
    def report(label: str, keep) -> None:
        chosen = [a for a in app.objects.values() if keep(a)]
        ids: set[int] = set()
        for a in chosen:
            ids |= a.all_sprite_ids
        px = area(catalog, ids)
        print(f"  {label:<28} {len(chosen):>6} objs  {len(ids):>7} sprites  {px * 4 / 1024 / 1024:>7.1f} MB")

    print("\nobject subsets:")
    report("named", lambda a: bool(a.name))
    report("market listed", lambda a: a.market_category is not None)
    report("takeable", lambda a: a.is_takeable)
    report("takeable or market", lambda a: a.is_takeable or a.market_category is not None)
    report("ground tiles", lambda a: a.is_ground)
    report("corpses", lambda a: a.is_corpse)


if __name__ == "__main__":
    main()
