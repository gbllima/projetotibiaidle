"""Extract the fresh human corpse, before the decayed and skeleton stages."""
from pathlib import Path
from tibia.appearances import Appearances
from tibia.catalog import SpriteCatalog

root = Path(__file__).resolve().parents[2]
catalog = SpriteCatalog(root / 'cliente pc' / 'things' / 'luminaris')
appearances = Appearances.load(catalog.appearances_path)
appearance = appearances.objects[4240]
sprite_id = appearance.frame_groups[0].sprite_info.sprite_ids[0]
sprite = catalog.get_sprite(sprite_id)
assert sprite is not None
target = root / 'apps' / 'web' / 'public' / 'sprites' / 'player-corpse.png'
target.parent.mkdir(parents=True, exist_ok=True)
sprite.save(target)
print(target)
