"""Extract Tibia client assets into browser-ready atlases + metadata.

    python tools/extractor/extract.py --all
    python tools/extractor/extract.py --creatures --directions 2 3
    python tools/extractor/extract.py --items --format png

Output goes to tools/extractor/out/assets/ by default:

    creatures-*.webp  creatures.json
    items-*.webp      items.json
    effects-*.webp    effects.json

Metadata keeps each appearance's *full* SpriteInfo (pattern dims and the
complete sprite_id list) even when only some directions are packed. That way
the standard OTClient index formula still works in the renderer, and widening
the packed scope later only changes the atlas, never the metadata contract.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from tibia import Appearance, Appearances, SpriteCatalog  # noqa: E402
from tibia.atlas import AtlasBuilder  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "cliente pc" / "things" / "luminaris"
MONSTER_DIR = ROOT / "servidor" / "data-global" / "monster"
DEFAULT_OUT = Path(__file__).parent / "out" / "assets"

IDLE, MOVING, INITIAL = 0, 1, 2
DIRECTION_NAMES = {0: "north", 1: "east", 2: "south", 3: "west"}


def sprite_info_json(appearance: Appearance) -> dict:
    groups = {}
    for group in appearance.frame_groups:
        info = group.sprite_info
        groups[str(group.kind)] = {
            "patternWidth": info.pattern_width,
            "patternHeight": info.pattern_height,
            "patternDepth": info.pattern_depth,
            "layers": info.layers,
            "frames": info.frame_count,
            "loopType": info.loop_type,
            "phases": [[p.duration_min, p.duration_max] for p in info.phases],
            "sprites": info.sprite_ids,
        }
    return groups


def selected_sprites(appearance: Appearance, directions: list[int] | None) -> set[int]:
    """Sprite IDs we actually want in the atlas for this appearance."""
    ids: set[int] = set()
    for group in appearance.frame_groups:
        info = group.sprite_info
        if directions is None or info.pattern_width <= 1:
            ids.update(info.sprite_ids)
            continue
        for phase in range(info.frame_count):
            for mount in range(info.pattern_depth):
                for addon in range(info.pattern_height):
                    for direction in directions:
                        if direction >= info.pattern_width:
                            continue
                        for layer in range(info.layers):
                            sid = info.sprite_at(
                                phase=phase, direction=direction, addon=addon,
                                mount=mount, layer=layer,
                            )
                            if sid:
                                ids.add(sid)
    return ids


def load_monster_looktypes() -> dict[str, dict]:
    import re

    re_name = re.compile(r'Game\.createMonsterType\(\s*"([^"]+)"', re.I)
    re_look = re.compile(r"lookType\s*=\s*(\d+)")
    out: dict[str, dict] = {}
    for path in MONSTER_DIR.rglob("*.lua"):
        text = path.read_text(encoding="utf-8", errors="replace")
        name = re_name.search(text)
        look = re_look.search(text)
        if name and look:
            out[name.group(1)] = {
                "lookType": int(look.group(1)),
                "category": path.parent.name,
            }
    return out


def build(
    label: str,
    entries: dict[int, Appearance],
    catalog: SpriteCatalog,
    out_dir: Path,
    *,
    directions: list[int] | None,
    page_size: int,
    fmt: str,
    extra: dict | None = None,
) -> dict:
    started = time.perf_counter()
    wanted: set[int] = set()
    meta: dict[str, dict] = {}
    for key, appearance in entries.items():
        ids = selected_sprites(appearance, directions)
        if not ids:
            continue
        wanted |= ids
        entry: dict = {"groups": sprite_info_json(appearance)}
        if appearance.name:
            entry["name"] = appearance.name
        if appearance.market_category is not None:
            entry["marketCategory"] = appearance.market_category
        if appearance.equip_slot is not None:
            entry["slot"] = appearance.equip_slot
        if appearance.is_stackable:
            entry["stackable"] = True
        if appearance.is_container:
            entry["container"] = True
        meta[str(key)] = entry

    print(f"[{label}] {len(meta)} appearances, {len(wanted)} sprites -> packing")
    builder = AtlasBuilder(label, page_size=page_size)
    done = 0
    for sprite_id, image in catalog.iter_sprites(sorted(wanted)):
        builder.add(sprite_id, image)
        done += 1
        if done % 5000 == 0:
            print(f"  {done}/{len(wanted)}")

    atlas = builder.save(out_dir, fmt=fmt)
    document = {
        "version": 1,
        "category": label,
        "directions": directions,
        "atlas": atlas,
        "entries": meta,
    }
    if extra:
        document.update(extra)
    (out_dir / f"{label}.json").write_text(json.dumps(document, separators=(",", ":")), encoding="utf-8")

    stats = atlas["stats"]
    print(
        f"[{label}] {stats['pageCount']} pages, {stats['uniqueFrames']} unique "
        f"({stats['duplicates']} dupes, {stats['empty']} empty), "
        f"{stats['bytes'] / 1024 / 1024:.1f} MB, {time.perf_counter() - started:.1f}s"
    )
    return document


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--all", action="store_true", help="extract every category")
    parser.add_argument("--creatures", action="store_true")
    parser.add_argument("--items", action="store_true")
    parser.add_argument("--effects", action="store_true", help="effects and missiles")
    parser.add_argument("--outfits", action="store_true", help="player vocation outfits")
    parser.add_argument("--mounts", action="store_true", help="mount lookTypes from mounts.xml")
    parser.add_argument("--tiles", action="store_true", help="ground tiles and hunt scenery")
    parser.add_argument(
        "--directions", type=int, nargs="*", default=[2, 3],
        help="creature directions to pack: 0=N 1=E 2=S 3=W (default: 2 3). Empty = all",
    )
    parser.add_argument("--page-size", type=int, default=2048)
    parser.add_argument("--format", choices=["webp", "png"], default="webp")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--limit", type=int, default=0, help="cap appearances per category (smoke test)")
    args = parser.parse_args()

    if args.all:
        args.creatures = args.items = args.effects = args.outfits = args.mounts = args.tiles = True
    if not (args.creatures or args.items or args.effects or args.outfits or args.mounts or args.tiles):
        parser.error("pick at least one of --creatures --items --effects --outfits --mounts --tiles --all")

    args.out.mkdir(parents=True, exist_ok=True)
    print(f"assets : {ASSETS}")
    print(f"output : {args.out}\n")

    catalog = SpriteCatalog(ASSETS)
    appearances = Appearances.load(catalog.appearances_path)
    print(
        f"loaded objects={len(appearances.objects)} outfits={len(appearances.outfits)} "
        f"effects={len(appearances.effects)} missiles={len(appearances.missiles)}\n"
    )

    def cap(entries: dict[int, Appearance]) -> dict[int, Appearance]:
        if not args.limit:
            return entries
        return dict(list(entries.items())[: args.limit])

    directions = args.directions or None

    if args.creatures:
        monsters = load_monster_looktypes()
        looktypes = {m["lookType"] for m in monsters.values()}
        chosen = {k: v for k, v in appearances.outfits.items() if k in looktypes}
        skipped = sorted(looktypes - set(chosen))
        print(f"[creatures] {len(monsters)} monsters -> {len(looktypes)} looktypes, {len(skipped)} absent from appearances")
        build(
            "creatures", cap(chosen), catalog, args.out,
            directions=directions, page_size=args.page_size, fmt=args.format,
            extra={
                "monsters": {name: m["lookType"] for name, m in sorted(monsters.items())},
                "missingLookTypes": skipped,
            },
        )

    if args.items:
        from shop_ids import load_shop_client_ids

        shop_ids = load_shop_client_ids()
        chosen = {
            k: v for k, v in appearances.objects.items()
            if v.is_takeable or v.market_category is not None or k in shop_ids
        }
        print(f"[items] {len(chosen)} appearances ({len(shop_ids)} npc shop ids)")
        build(
            "items", cap(chosen), catalog, args.out,
            directions=None, page_size=args.page_size, fmt=args.format,
        )

    if args.outfits:
        # Every looktype listed in servidor/data/XML/outfits.xml (global + custom).
        outfits_xml = ROOT / "servidor" / "data" / "XML" / "outfits.xml"
        wanted: set[int] = set()
        if outfits_xml.exists():
            import re
            text = outfits_xml.read_text(encoding="utf-8")
            wanted = {int(m) for m in re.findall(r'looktype="(\d+)"', text)}
        # Keep a few custom extras that may not be in the XML.
        wanted |= {1823, 1824, 1825}
        chosen = {k: v for k, v in appearances.outfits.items() if k in wanted}
        missing = sorted(wanted - set(chosen))
        print(f"[outfits] {len(chosen)} / {len(wanted)} looktypes ({len(missing)} absent from appearances)")
        if missing[:12]:
            print(f"  missing sample: {missing[:12]}")
        build(
            "outfits", cap(chosen), catalog, args.out,
            directions=directions, page_size=args.page_size, fmt=args.format,
        )

    if args.mounts:
        import re
        mounts_xml = ROOT / "servidor" / "data" / "XML" / "mounts.xml"
        wanted: set[int] = set()
        if mounts_xml.exists():
            text = mounts_xml.read_text(encoding="utf-8")
            wanted = {int(m) for m in re.findall(r'clientid="(\d+)"', text)}
        chosen = {k: v for k, v in appearances.outfits.items() if k in wanted}
        missing = sorted(wanted - set(chosen))
        print(f"[mounts] {len(chosen)} / {len(wanted)} looktypes ({len(missing)} absent from appearances)")
        if missing[:12]:
            print(f"  missing sample: {missing[:12]}")
        build(
            "mounts", cap(chosen), catalog, args.out,
            directions=directions, page_size=args.page_size, fmt=args.format,
        )

    if args.tiles:
        scenery = {
            1780, 1781, 1782, 2920, 2921, 2922, 2923, 3114, 3115, 3116,
            3577, 3723, 3724, 3725, 34300, 34301, 37019, 37020,
            44130, 44131, 44132, 44133, 44142, 44143, 42337,
            34272, 34273,
        }
        hunt_ids_path = ROOT / "packages" / "data" / "generated" / "hunt-map-ids.json"
        if hunt_ids_path.exists():
            hunt_ids = set(json.loads(hunt_ids_path.read_text(encoding="utf-8")))
            scenery |= {int(x) for x in hunt_ids}
            print(f"[tiles] +{len(hunt_ids)} ids from hunt-map cuts")
        chosen = {
            k: v for k, v in appearances.objects.items()
            if (v.is_ground and k < 2500) or k in scenery
        }
        print(f"[tiles] {len(chosen)} ground/scenery appearances")
        build(
            "tiles", cap(chosen), catalog, args.out,
            directions=None, page_size=args.page_size, fmt=args.format,
        )

    if args.effects:
        # Effects and missiles reuse the same small ID space, so they get
        # separate atlases rather than a merged one with an offset hack.
        build(
            "effects", cap(appearances.effects), catalog, args.out,
            directions=None, page_size=args.page_size, fmt=args.format,
        )
        build(
            "missiles", cap(appearances.missiles), catalog, args.out,
            directions=None, page_size=args.page_size, fmt=args.format,
        )

    print("\ndone")


if __name__ == "__main__":
    main()
