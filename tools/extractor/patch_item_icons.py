"""Export standalone item icons missing from the items atlas.

By default patches every server item whose sprite is not packed in items.json
but exists in the local Tibia client catalog (Cyclopedia coverage).

    python tools/extractor/patch_item_icons.py
    python tools/extractor/patch_item_icons.py --shop-only
    python tools/extractor/patch_item_icons.py --refresh-bad
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from tibia.appearances import Appearances  # noqa: E402
from tibia.catalog import SpriteCatalog  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "cliente pc" / "things" / "luminaris"
OUT = Path(__file__).parent / "out" / "assets"
ITEMS_JSON = ROOT / "packages" / "data" / "generated" / "items.json"
MONSTERS_JSON = ROOT / "packages" / "data" / "generated" / "monsters.json"
META_JSON = OUT / "items.json"
ICON_DIR = OUT / "item-icons"
MANIFEST = OUT / "item-icons.json"

GROUP_ORDER = ("0", "1", "2")
COIN_FALLBACK_IDS = (3043, 3035, 3031)  # crystal, platinum, gold


def load_atlas_packed() -> tuple[dict, set[int]]:
    if not META_JSON.exists():
        return {}, set()
    meta = json.loads(META_JSON.read_text(encoding="utf-8"))
    entries = meta.get("entries", {})
    frames = meta.get("atlas", {}).get("frames", {})
    packed: set[int] = set()
    for key, entry in entries.items():
        for group in entry.get("groups", {}).values():
            for sprite_id in group.get("sprites", []):
                if str(sprite_id) in frames:
                    packed.add(int(key))
                    break
            else:
                continue
            break
    return meta, packed


def atlas_renderable(meta: dict, client_id: int) -> bool:
    entry = meta.get("entries", {}).get(str(client_id))
    if not entry:
        return False
    frames = meta.get("atlas", {}).get("frames", {})
    for group in entry.get("groups", {}).values():
        for sprite_id in group.get("sprites", []):
            if str(sprite_id) in frames:
                return True
    return False


def image_visible(image: Image.Image) -> bool:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    if alpha.getextrema()[1] <= 16:
        return False
    pixels = rgba.load()
    visible = 0
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, a = pixels[x, y]
            if a > 24 and (r + g + b) < 720:
                visible += 1
                if visible > 6:
                    return True
    return visible > 6


def load_existing_icon(path: Path) -> Image.Image | None:
    if not path.exists() or path.stat().st_size < 180:
        return None
    try:
        image = Image.open(path).convert("RGBA")
    except OSError:
        return None
    return image if image_visible(image) else None


def loot_ids() -> set[int]:
    if not MONSTERS_JSON.exists():
        return set()
    out: set[int] = set()
    for monster in json.loads(MONSTERS_JSON.read_text(encoding="utf-8")):
        for drop in monster.get("loot", []):
            item_id = drop.get("itemId")
            if item_id is not None:
                out.add(int(item_id))
    return out


def shop_only_items(items: list[dict], loot: set[int]) -> list[dict]:
    rows: list[dict] = []
    for item in items:
        item_id = int(item["id"])
        if (
            item.get("buyPrice") is not None
            or item.get("sellPrice") is not None
            or item.get("slot")
            or item.get("marketCategory") is not None
            or item_id in loot
        ):
            rows.append(item)
    return rows


def pick_sprite(catalog: SpriteCatalog, appearance) -> Image.Image | None:
    groups = appearance.frame_groups
    by_kind = {str(group.kind): group for group in groups}
    ordered = [by_kind[key] for key in GROUP_ORDER if key in by_kind]
    ordered.extend(group for group in groups if str(group.kind) not in GROUP_ORDER)
    for group in ordered:
        for sprite_id in group.sprite_info.sprite_ids:
            image = catalog.get_sprite(sprite_id)
            if image is not None and image_visible(image):
                return image.convert("RGBA")
    return None


def tint_image(base: Image.Image, rgb: tuple[int, int, int]) -> Image.Image:
    img = base.convert("RGBA").resize((32, 32), Image.Resampling.NEAREST)
    tr, tg, tb = rgb
    pixels = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = pixels[x, y]
            if a <= 0:
                continue
            pixels[x, y] = (
                min(255, (r * 2 + tr) // 3),
                min(255, (g * 2 + tg) // 3),
                min(255, (b * 2 + tb) // 3),
                a,
            )
    return img


def pick_coin_sprite(catalog: SpriteCatalog, appearances) -> Image.Image | None:
    for item_id in COIN_FALLBACK_IDS:
        appearance = appearances.objects.get(item_id)
        if appearance is None:
            continue
        image = pick_sprite(catalog, appearance)
        if image is not None:
            return image
    return None


def draw_token(label: str, accent: tuple[int, int, int]) -> Image.Image:
    img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse((3, 3, 28, 28), fill=(*accent, 255), outline=(255, 220, 120, 255), width=1)
    text = label if len(label) <= 4 else label[:3] + "…"
    draw.text((16, 16), text, fill=(255, 255, 255, 255), anchor="mm")
    return img


def fallback_icon(catalog: SpriteCatalog, appearances, item: dict) -> Image.Image | None:
    name = (item.get("name") or "").lower()
    if "theon" in name:
        coin = pick_coin_sprite(catalog, appearances)
        if coin is not None:
            return tint_image(coin, (170, 110, 255))
        amount = re.sub(r"[^0-9].*", "", item.get("name") or "")
        return draw_token(amount or "T", (140, 90, 220))
    if "coin" in name or "gold" in name or "platinum" in name or "crystal" in name:
        coin = pick_coin_sprite(catalog, appearances)
        if coin is not None:
            return coin
    if item.get("type") in {"quest items", "valuables"}:
        coin = pick_coin_sprite(catalog, appearances)
        if coin is not None:
            return tint_image(coin, (120, 200, 255))
    return None


def appearance_for(item: dict, appearances) -> tuple[int, object] | None:
    candidates = [int(item["id"])]
    if item.get("clientId") is not None:
        cid = int(item["clientId"])
        if cid not in candidates:
            candidates.append(cid)
    for client_id in candidates:
        appearance = appearances.objects.get(client_id)
        if appearance is not None:
            return client_id, appearance
    return None


def save_icon(image: Image.Image, out_path: Path) -> None:
    canvas = image.convert("RGBA").resize((32, 32), Image.Resampling.NEAREST)
    canvas.save(out_path, format="WEBP", quality=92)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--shop-only", action="store_true", help="only shop/loot/equipment rows")
    parser.add_argument("--refresh-bad", action="store_true", help="re-export blank or tiny icons")
    args = parser.parse_args()

    t0 = time.perf_counter()
    if not ITEMS_JSON.exists():
        raise SystemExit(f"missing {ITEMS_JSON} — run pnpm datagen first")

    items = json.loads(ITEMS_JSON.read_text(encoding="utf-8"))
    items_by_id = {int(item["id"]): item for item in items}
    meta, _ = load_atlas_packed()
    loot = loot_ids()
    if args.shop_only:
        candidates = shop_only_items(items, loot)
    else:
        candidates = items

    catalog = SpriteCatalog(ASSETS)
    appearances = Appearances.load(catalog.appearances_path)
    ICON_DIR.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, dict] = {}
    if MANIFEST.exists():
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

    if args.refresh_bad:
        refresh_ids = [
            int(item_id)
            for item_id in manifest
            if load_existing_icon(ICON_DIR / f"{item_id}.webp") is None
        ]
        extra = [items_by_id[iid] for iid in refresh_ids if iid in items_by_id]
        seen = {int(item["id"]) for item in candidates}
        candidates = candidates + [item for item in extra if int(item["id"]) not in seen]
        print(f"[refresh-bad] {len(refresh_ids)} icons to regenerate")

    written = 0
    kept = 0
    missing = 0
    skipped_atlas = 0
    fallback = 0

    for index, item in enumerate(candidates):
        item_id = int(item["id"])
        resolved = appearance_for(item, appearances)
        out_path = ICON_DIR / f"{item_id}.webp"
        key = str(item_id)

        existing = load_existing_icon(out_path)
        if existing is not None and not args.refresh_bad:
            kept += 1
            manifest[key] = {
                "clientId": int(item.get("clientId") or item_id),
                "name": item.get("name"),
                "file": f"item-icons/{item_id}.webp",
            }
            continue

        client_id = int(item.get("clientId") or item_id)
        if resolved is not None:
            client_id, appearance = resolved
        else:
            appearance = None

        if atlas_renderable(meta, client_id) and existing is None:
            skipped_atlas += 1
            continue

        image: Image.Image | None = None
        if appearance is not None:
            image = pick_sprite(catalog, appearance)
        if image is None:
            image = fallback_icon(catalog, appearances, item)
            if image is not None:
                fallback += 1
        if image is None:
            missing += 1
            continue

        save_icon(image, out_path)
        manifest[key] = {
            "clientId": client_id,
            "name": item.get("name"),
            "file": f"item-icons/{item_id}.webp",
        }
        written += 1

        if written and written % 500 == 0:
            print(f"  … {written} written ({index + 1}/{len(candidates)})")

    MANIFEST.write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
    print(
        f"item-icons: {written} written, {kept} kept, {fallback} synthetic, "
        f"{skipped_atlas} already in atlas, {missing} missing, {len(manifest)} total "
        f"({time.perf_counter() - t0:.1f}s)"
    )


if __name__ == "__main__":
    main()
