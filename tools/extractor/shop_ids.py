"""Collect item client ids that must be available in the browser atlas.

Most ids come from NPC shops. A tiny set of gameplay-only objects is also kept
here because they are rendered directly by the web client even though no NPC
sells them.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SERVER = ROOT / "servidor"
ENTRY = re.compile(r'\{\s*itemName\s*=\s*"([^"]+)"\s*,\s*clientId\s*=\s*(\d+)', re.I)

# TFS player corpses. They are not shop items, but the combat renderer needs
# their appearances in items.json so a dead character can leave a real body on
# the floor instead of a CSS/placeholder marker.
PLAYER_CORPSE_IDS = {3058, 3065}


def walk_lua(dir: Path) -> list[Path]:
    out: list[Path] = []
    if not dir.exists():
        return out
    for path in dir.rglob("*.lua"):
        out.append(path)
    return out


def load_shop_client_ids() -> set[int]:
    files = walk_lua(SERVER / "data-global" / "npc")
    shops = SERVER / "data" / "scripts" / "lib" / "shops.lua"
    if shops.exists():
        files.append(shops)

    # Start with renderer-required objects, then add the normal shop catalogue.
    ids: set[int] = set(PLAYER_CORPSE_IDS)
    for file in files:
        text = file.read_text(encoding="utf-8", errors="replace")
        for match in ENTRY.finditer(text):
            item_id = int(match.group(2))
            if item_id:
                ids.add(item_id)
    return ids
