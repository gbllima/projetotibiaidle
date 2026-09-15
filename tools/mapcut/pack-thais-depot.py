"""Build the small Thais Depot atlas and its collision metadata from client flags."""
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/extractor'))
from extract import build
from tibia import SpriteCatalog, Appearances
from tibia.wire import read_fields
catalog = SpriteCatalog(ROOT / 'cliente pc/things/luminaris')
appearances = Appearances.load(catalog.appearances_path)
room = json.loads((ROOT / 'packages/data/generated/thais-depot.json').read_text())
ids = sorted(({i for row in room['ground'] for i in row} | {i for row in room['stack'] for tile in row for i in tile}) - {0})
flags = {}
for field, _, value in read_fields(catalog.appearances_path.read_bytes()):
    if field == 1:
        fields = {k: v for k, _, v in read_fields(value)}
        if fields[1] in ids:
            flags[fields[1]] = {k: v for k, _, v in read_fields(fields.get(3, b''))}
blocked = [i for i in ids if flags.get(i, {}).get(13)]
(ROOT / 'packages/data/generated/thais-depot-blocked.json').write_text(json.dumps(blocked))
missing = [i for i in ids if i not in appearances.objects]
if missing:
    raise RuntimeError(f'Missing appearances: {missing}')
document = build('thais-depot', {i: appearances.objects[i] for i in ids}, catalog,
      ROOT / 'apps/web/public/city-assets', directions=None, page_size=2048, fmt='webp')
for item_id, entry in document['entries'].items():
    shift = flags.get(int(item_id), {}).get(26)
    if shift:
        values = {k: v for k, _, v in read_fields(shift)}
        entry['displacement'] = {'x': values.get(1, 0), 'y': values.get(2, 0)}
(ROOT / 'apps/web/public/city-assets/thais-depot.json').write_text(
    json.dumps(document, separators=(',', ':')), encoding='utf-8')
