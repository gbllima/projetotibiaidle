"""Map sim spell ids to Tibia client spell icon indices (spell-icons-32x32 sheet).

    python tools/extractor/generate_spell_icons.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLIENT_SPELLS = (
    ROOT
    / "cliente pc"
    / "assets_unpacked"
    / "modules"
    / "game_cyclopedia"
    / "tab"
    / "magicalArchives"
    / "spells.json"
)
SIM_SPELLS = ROOT / "packages" / "sim" / "src" / "spells.ts"
OUT = Path(__file__).parent / "out" / "assets" / "spell-icons.json"

SPELL_RE = re.compile(
    r"id:\s*'([^']+)'[^}]*?words:\s*'([^']+)'",
    re.DOTALL,
)


def main() -> None:
    client = json.loads(CLIENT_SPELLS.read_text(encoding="utf-8"))
    by_words: dict[str, int] = {}
    for entry in client:
        words = (entry.get("formulaWithoutParams") or "").lower().strip()
        icon = entry.get("iconIndex")
        if words and icon is not None:
            by_words[words] = int(icon)

    source = SIM_SPELLS.read_text(encoding="utf-8")
    manifest: dict[str, int] = {}
    missing: list[tuple[str, str]] = []
    for spell_id, words in SPELL_RE.findall(source):
        key = words.lower().strip()
        icon = by_words.get(key)
        if icon is None:
            missing.append((spell_id, words))
        else:
            manifest[spell_id] = icon

    OUT.write_text(
        json.dumps(
            {
                "version": 1,
                "sheet": "ui/game/spells/spell-icons-32x32.webp",
                "iconSize": 32,
                "iconsPerRow": 20,
                "icons": manifest,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"wrote {len(manifest)} icons -> {OUT}")
    if missing:
        print("missing:", ", ".join(f"{sid} ({w})" for sid, w in missing))


if __name__ == "__main__":
    main()
