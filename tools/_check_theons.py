import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "extractor"))
from tibia.catalog import SpriteCatalog
from tibia.appearances import Appearances

ROOT = Path(__file__).resolve().parents[1]
items = json.loads((ROOT / "packages/data/generated/items.json").read_text())
meta = json.loads((ROOT / "tools/extractor/out/assets/items.json").read_text())
icons = json.loads((ROOT / "tools/extractor/out/assets/item-icons.json").read_text())

catalog = SpriteCatalog(ROOT / "cliente pc/things/luminaris")
apps = Appearances.load(catalog.appearances_path)

for q in ["theons", "200 theons", "50 theons", "7197 theons", "25 years backpack"]:
    matches = [i for i in items if q in i["name"].lower()]
    print(f"\n=== {q} ({len(matches)}) ===")
    for i in matches[:5]:
        iid = i["id"]
        cid = i.get("clientId") or iid
        app = apps.objects.get(int(cid))
        export = False
        if app:
            for g in app.frame_groups:
                for sid in g.sprite_info.sprite_ids:
                    if catalog.get_sprite(sid):
                        export = True
                        break
                if export:
                    break
        print(
            f"  id={iid} name={i['name']!r} hs={i.get('hasSprite')} cid={i.get('clientId')} "
            f"type={i.get('type')} icon={str(iid) in icons} app={app is not None} export={export}"
        )
        if app:
            print(f"    appearance name={app.name!r} takeable={app.is_takeable} market={app.market_category}")
