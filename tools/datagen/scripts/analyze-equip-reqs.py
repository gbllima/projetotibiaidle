"""Compare items.xml equip restrictions vs generated items.json."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
XML = ROOT / "servidor/data/items/items.xml"
JSON = ROOT / "packages/data/generated/items.json"


def parse_xml_blocks(text: str) -> list[tuple[int, str, dict]]:
    rows: list[tuple[int, str, dict]] = []
    for block in re.split(r"(?=<item id=)", text):
        m = re.search(r'<item id="(\d+)"[^>]*name="([^"]+)"', block)
        if not m:
            continue
        item_id = int(m.group(1))
        name = m.group(2)
        level = 0
        vocations: list[str] = []
        slot = None
        for am in re.finditer(r'<attribute key="([^"]+)" value="([^"]*)"', block):
            key, value = am.group(1).lower(), am.group(2)
            if key == "level":
                try:
                    level = max(level, int(value))
                except ValueError:
                    pass
            elif key == "vocation":
                parts = [
                    p.strip().lower()
                    for p in re.split(r"[;,]", value)
                    if p.strip().lower() not in ("", "true", "false")
                ]
                vocations.extend(parts)
            elif key in ("slot", "slottype"):
                slot = value
        rows.append((item_id, name, {"level": level, "vocations": sorted(set(vocations)), "slot": slot}))
    return rows


def main() -> None:
    xml_rows = parse_xml_blocks(XML.read_text(encoding="utf-8"))
    items = {row["id"]: row for row in json.loads(JSON.read_text(encoding="utf-8"))}

    missing_level = 0
    missing_voc = 0
    wrong_level = 0
    wrong_voc = 0
    samples_level: list[str] = []
    samples_voc: list[str] = []

    for item_id, name, xml in xml_rows:
        gen = items.get(item_id)
        if not gen:
            continue
        if xml["level"] and gen.get("levelRequired", 0) != xml["level"]:
            wrong_level += 1
            if len(samples_level) < 8:
                samples_level.append(f"{name} ({item_id}): xml={xml['level']} json={gen.get('levelRequired')}")
        if xml["level"] and not gen.get("levelRequired"):
            missing_level += 1
        xml_v = xml["vocations"]
        gen_v = [v.lower() for v in gen.get("vocations") or []]
        if xml_v and sorted(set(gen_v)) != xml_v:
            wrong_voc += 1
            if len(samples_voc) < 8:
                samples_voc.append(f"{name} ({item_id}): xml={xml_v} json={gen_v}")
        if xml_v and not gen_v:
            missing_voc += 1

    with_level = sum(1 for _, _, x in xml_rows if x["level"] > 0)
    with_voc = sum(1 for _, _, x in xml_rows if x["vocations"])

    print(f"XML items parsed: {len(xml_rows)}")
    print(f"XML with level>0: {with_level}")
    print(f"XML with vocation: {with_voc}")
    print(f"JSON level mismatches: {wrong_level} (missing {missing_level})")
    print(f"JSON vocation mismatches: {wrong_voc} (missing {missing_voc})")
    if samples_level:
        print("\nLevel mismatch samples:")
        for line in samples_level:
            print(" ", line)
    if samples_voc:
        print("\nVocation mismatch samples:")
        for line in samples_voc:
            print(" ", line)

    plate = items.get(3357)
    print("\nplate armor json:", {k: plate.get(k) for k in ("levelRequired", "vocations", "slot", "armor")} if plate else None)


if __name__ == "__main__":
    main()
