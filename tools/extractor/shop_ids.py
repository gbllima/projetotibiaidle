"""Collect client item ids sold by NPCs (shops.lua + per-NPC tables)."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SERVER = ROOT / "servidor"
ENTRY = re.compile(r'\{\s*itemName\s*=\s*"([^"]+)"\s*,\s*clientId\s*=\s*(\d+)', re.I)


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

    ids: set[int] = set()
    for file in files:
        text = file.read_text(encoding="utf-8", errors="replace")
        for match in ENTRY.finditer(text):
            item_id = int(match.group(2))
            if item_id:
                ids.add(item_id)
    return ids
