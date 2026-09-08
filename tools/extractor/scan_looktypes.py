"""Scan monster Lua files for looktypes, to decide creature atlas scope.

This is a *selection* pass, not the real data pipeline. A shallow regex is fine
here because we only need "which looktypes exist"; the authoritative monster
parsing happens later in tools/datagen with a real Lua VM.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from tibia import Appearances, SpriteCatalog  # noqa: E402

ROOT = Path(r"C:\Users\Dev Alx\Desktop\Cursor pro idle")
MONSTERS = ROOT / "servidor" / "data-global" / "monster"
ASSETS = ROOT / "cliente pc" / "things" / "luminaris"
HUNTS = ROOT / "cliente pc" / "assets_unpacked" / "data" / "json" / "hunting_places.json"

RE_NAME = re.compile(r'Game\.createMonsterType\(\s*"([^"]+)"', re.I)
RE_LOOKTYPE = re.compile(r"lookType\s*=\s*(\d+)")
RE_TYPEEX = re.compile(r"lookTypeEx\s*=\s*(\d+)")


def scan() -> dict[str, dict]:
    found: dict[str, dict] = {}
    for path in MONSTERS.rglob("*.lua"):
        text = path.read_text(encoding="utf-8", errors="replace")
        name = RE_NAME.search(text)
        if not name:
            continue
        look = RE_LOOKTYPE.search(text)
        typeex = RE_TYPEEX.search(text)
        found[name.group(1).lower()] = {
            "name": name.group(1),
            "lookType": int(look.group(1)) if look else None,
            "lookTypeEx": int(typeex.group(1)) if typeex else None,
            "category": path.parent.name,
        }
    return found


def main() -> None:
    monsters = scan()
    looktypes = {m["lookType"] for m in monsters.values() if m["lookType"]}
    typeex = {m["lookTypeEx"] for m in monsters.values() if m["lookTypeEx"]}
    print(f"monster files parsed : {len(monsters)}")
    print(f"distinct lookType    : {len(looktypes)}")
    print(f"distinct lookTypeEx  : {len(typeex)}  (item-shaped monsters)")

    hunts = json.loads(HUNTS.read_text(encoding="utf-8"))
    hunt_names = {m["Name"].lower() for h in hunts for m in h.get("Monsters", [])}
    matched = {n for n in hunt_names if n in monsters}
    print(f"\nhunt monsters        : {len(hunt_names)}")
    print(f"matched to lua       : {len(matched)}")
    missing = sorted(hunt_names - matched)
    print(f"unmatched            : {len(missing)}  e.g. {missing[:8]}")

    hunt_looktypes = {
        monsters[n]["lookType"] for n in matched if monsters[n]["lookType"]
    }
    print(f"hunt lookTypes       : {len(hunt_looktypes)}")

    catalog = SpriteCatalog(ASSETS)
    app = Appearances.load(catalog.appearances_path)

    def cost(label: str, looks: set[int], *, groups: tuple[int, ...], directions: int | None) -> None:
        ids: set[int] = set()
        missing_look = 0
        for lt in looks:
            appearance = app.outfits.get(lt)
            if appearance is None:
                missing_look += 1
                continue
            for group in appearance.frame_groups:
                if group.kind not in groups:
                    continue
                info = group.sprite_info
                if directions is None:
                    ids |= set(info.sprite_ids)
                    continue
                for phase in range(info.frame_count):
                    for d in range(min(directions, info.pattern_width)):
                        for layer in range(info.layers):
                            sid = info.sprite_at(phase=phase, direction=d, layer=layer)
                            if sid:
                                ids.add(sid)
        px = 0
        for sid in ids:
            sheet = catalog.find_sheet(sid)
            if sheet:
                w, h = sheet.tile_size
                px += w * h
        print(
            f"  {label:<42} {len(ids):>7} sprites  {px * 4 / 1024 / 1024:>7.1f} MB raw"
            + (f"  (missing looktype: {missing_look})" if missing_look else "")
        )

    print("\ncreature atlas cost, all monster lookTypes:")
    cost("idle only, 4 dirs", looktypes, groups=(0,), directions=4)
    cost("idle + moving, 4 dirs", looktypes, groups=(0, 1), directions=4)
    cost("idle + moving, 2 dirs", looktypes, groups=(0, 1), directions=2)
    cost("idle + moving, 1 dir", looktypes, groups=(0, 1), directions=1)

    print("\ncreature atlas cost, hunt monsters only:")
    cost("idle + moving, 4 dirs", hunt_looktypes, groups=(0, 1), directions=4)
    cost("idle + moving, 2 dirs", hunt_looktypes, groups=(0, 1), directions=2)

    out = ROOT / "tools" / "extractor" / "out" / "monster_looktypes.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "monsters": monsters,
                "allLookTypes": sorted(looktypes),
                "huntLookTypes": sorted(hunt_looktypes),
                "unmatchedHuntMonsters": missing,
            },
            indent=1,
        ),
        encoding="utf-8",
    )
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
