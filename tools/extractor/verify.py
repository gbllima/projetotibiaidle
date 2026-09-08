"""Rebuild sprites from the packed atlas and compare against the source.

This is the check that matters: the atlas is only useful if a renderer can go
metadata -> frame -> pixels and get back exactly what the client would draw.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from PIL import Image  # noqa: E402

from tibia import Appearances, SpriteCatalog  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "cliente pc" / "things" / "luminaris"
OUT = Path(__file__).parent / "out" / "assets"
PREVIEW = Path(__file__).parent / "out" / "preview"

# Mask colours on layer 1, confirmed from looktype 128 in the probe.
TINTS = {
    "head": (255, 210, 120),
    "body": (200, 60, 60),
    "legs": (70, 110, 200),
    "feet": (90, 90, 90),
}


class Atlas:
    def __init__(self, name: str) -> None:
        self.doc = json.loads((OUT / f"{name}.json").read_text(encoding="utf-8"))
        self.frames = self.doc["atlas"]["frames"]
        self.entries = self.doc["entries"]
        self._pages = [Image.open(OUT / f).convert("RGBA") for f in self.doc["atlas"]["pages"]]

    def sprite(self, sprite_id: int) -> Image.Image | None:
        frame = self.frames.get(str(sprite_id))
        if not frame:
            return None
        page, x, y, w, h = frame
        return self._pages[page].crop((x, y, x + w, y + h))


def recolor(base: Image.Image, mask: Image.Image) -> Image.Image:
    """Reference implementation of the outfit shader, on the CPU."""
    out = base.copy()
    bp, mp, op = base.load(), mask.load(), out.load()
    for y in range(base.height):
        for x in range(base.width):
            r, g, b, a = mp[x, y]
            if a == 0:
                continue
            if r > 127 and g > 127:
                tint = TINTS["head"]
            elif r > 127:
                tint = TINTS["body"]
            elif g > 127:
                tint = TINTS["legs"]
            elif b > 127:
                tint = TINTS["feet"]
            else:
                continue
            br, bg, bb, ba = bp[x, y]
            op[x, y] = (br * tint[0] // 255, bg * tint[1] // 255, bb * tint[2] // 255, ba)
    return out


def main() -> None:
    PREVIEW.mkdir(parents=True, exist_ok=True)
    catalog = SpriteCatalog(ASSETS)
    source = Appearances.load(catalog.appearances_path)

    creatures = Atlas("creatures")
    items = Atlas("items")
    effects = Atlas("effects")

    # 1. Round-trip check against the original sheets.
    #
    # Compared on visible pixels only. Lossless WebP zeroes the RGB channels of
    # fully transparent pixels, so a raw byte compare reports differences that
    # cannot affect rendering.
    print("round-trip check (atlas pixels vs source sheets)")
    checked = mismatched = 0
    for atlas in (creatures, items, effects):
        ids = [int(s) for s in list(atlas.frames)[:1500]]
        for sid, original in catalog.iter_sprites(ids):
            packed = atlas.sprite(sid)
            checked += 1
            if packed is None or packed.size != original.size:
                mismatched += 1
                continue
            op, pp = original.load(), packed.load()
            for y in range(original.height):
                for x in range(original.width):
                    a, b = op[x, y], pp[x, y]
                    if a[3] != b[3] or (a[3] != 0 and a[:3] != b[:3]):
                        mismatched += 1
                        if mismatched <= 5:
                            print(f"  MISMATCH sprite {sid} at ({x},{y}): {a} vs {b}")
                        break
                else:
                    continue
                break
    print(f"  {checked} sprites checked, {mismatched} mismatched\n")

    # 2. Visual sheets.
    lookups = json.loads((Path(__file__).parent / "out" / "monster_looktypes.json").read_text(encoding="utf-8"))
    monsters = lookups["monsters"]

    def creature_row(look: int, group: str = "1") -> Image.Image | None:
        entry = creatures.entries.get(str(look))
        if not entry:
            return None
        info = entry["groups"].get(group) or next(iter(entry["groups"].values()))
        pw, layers = info["patternWidth"], info["layers"]
        ph, pd = info["patternHeight"], info["patternDepth"]
        tiles = []
        for phase in range(info["frames"]):
            index = phase
            index = index * pd + 0
            index = index * ph + 0
            index = index * pw + 2  # south
            index = index * layers
            sprites = info["sprites"]
            if index >= len(sprites):
                continue
            base = creatures.sprite(sprites[index])
            if base is None:
                continue
            if layers >= 2 and index + 1 < len(sprites):
                mask = creatures.sprite(sprites[index + 1])
                if mask is not None:
                    base = recolor(base, mask)
            tiles.append(base)
        if not tiles:
            return None
        w, h = tiles[0].size
        strip = Image.new("RGBA", (w * len(tiles), h))
        for i, t in enumerate(tiles):
            strip.paste(t, (i * w, 0))
        return strip

    showcase = ["Rat", "Rotworm", "Dragon", "Demon", "Cyclops", "Minotaur Mage",
                "Giant Spider", "Hydra", "Warlock", "Ferumbras"]
    rows = []
    for name in showcase:
        info = monsters.get(name.lower())
        if not info or not info["lookType"]:
            continue
        row = creature_row(info["lookType"])
        if row:
            rows.append((name, row))
    if rows:
        width = max(r.width for _, r in rows)
        height = sum(r.height for _, r in rows)
        sheet = Image.new("RGBA", (width, height), (24, 24, 28, 255))
        y = 0
        for name, row in rows:
            sheet.paste(row, (0, y), row)
            y += row.height
        sheet.resize((width * 2, height * 2), Image.NEAREST).save(PREVIEW / "creatures.png")
        print(f"creatures preview: {[n for n, _ in rows]} -> {PREVIEW / 'creatures.png'}")

    # Player outfit with recolor applied.
    row = creature_row(128, "1") or creature_row(128, "0")
    if row:
        row.resize((row.width * 3, row.height * 3), Image.NEAREST).save(PREVIEW / "outfit_recolored.png")
        print(f"outfit recolor  : {PREVIEW / 'outfit_recolored.png'}")

    # Items grid.
    wanted = ["gold coin", "plate armor", "dragon shield", "sudden death rune",
              "magic plate armor", "great health potion", "crossbow", "demon helmet",
              "boots of haste", "steel helmet", "serpent sword", "life crystal"]
    by_name = {}
    for key, entry in items.entries.items():
        n = entry.get("name")
        if n and n.lower() in wanted and n.lower() not in by_name:
            by_name[n.lower()] = (key, entry)
    grid = Image.new("RGBA", (32 * len(wanted), 32), (24, 24, 28, 255))
    placed = 0
    for name in wanted:
        found = by_name.get(name)
        if not found:
            continue
        _, entry = found
        info = next(iter(entry["groups"].values()))
        sprite = items.sprite(info["sprites"][0])
        if sprite:
            grid.paste(sprite.crop((0, 0, 32, 32)), (placed * 32, 0), sprite.crop((0, 0, 32, 32)))
            placed += 1
    grid.resize((grid.width * 3, grid.height * 3), Image.NEAREST).save(PREVIEW / "items.png")
    print(f"items preview   : {placed}/{len(wanted)} found -> {PREVIEW / 'items.png'}")

    # Effect animation.
    entry = effects.entries.get("1")
    info = next(iter(entry["groups"].values()))
    tiles = [effects.sprite(s) for s in info["sprites"]]
    tiles = [t for t in tiles if t]
    strip = Image.new("RGBA", (32 * len(tiles), 32), (24, 24, 28, 255))
    for i, t in enumerate(tiles):
        strip.paste(t, (i * 32, 0), t)
    strip.resize((strip.width * 3, strip.height * 3), Image.NEAREST).save(PREVIEW / "effect.png")
    print(f"effect preview  : {len(tiles)} frames -> {PREVIEW / 'effect.png'}")

    sizes = {p.name: p.stat().st_size for p in sorted(OUT.glob("*"))}
    total = sum(sizes.values())
    print(f"\ntotal output: {total / 1024 / 1024:.1f} MB across {len(sizes)} files")


if __name__ == "__main__":
    main()
