"""Sprite catalog: resolves global sprite IDs to RGBA tiles.

Asset layout (Tibia 12+/15.x):
  catalog-content.json  indexes every blob in the folder
  *.bmp.lzma            LZMA1-compressed 384x384 BGRA BMP sheets

The `.bmp.lzma` container is CIP-specific:

    offset  size  content
    [0]       24  0x00 padding
    [24]       8  metadata (varies per file, unused)
    [32]       5  LZMA1 properties (lc/lp/pb byte + little-endian dict size)
    [37]       8  uint64 LE COMPRESSED payload size
    [45]       N  raw LZMA1 stream

The field at [37] is the *compressed* size. Several community write-ups claim it
is the uncompressed size; feeding that to a raw LZMA decoder fails without a
useful error, so it is worth stating plainly.
"""

from __future__ import annotations

import bisect
import io
import json
import lzma
import struct
from collections import OrderedDict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

SHEET_SIZE = 384

# spritetype -> (tile width, tile height)
TILE_SIZES: dict[int, tuple[int, int]] = {
    0: (32, 32),
    1: (32, 64),
    2: (64, 32),
    3: (64, 64),
}


@dataclass(frozen=True, slots=True)
class SheetEntry:
    first_id: int
    last_id: int
    file: str
    sprite_type: int

    @property
    def tile_size(self) -> tuple[int, int]:
        return TILE_SIZES[self.sprite_type]


def decompress_sheet(path: Path) -> bytes:
    raw = path.read_bytes()
    props = raw[32:37]
    compressed_size = struct.unpack_from("<Q", raw, 37)[0]
    prop_byte = props[0]
    lc = prop_byte % 9
    lp = (prop_byte // 9) % 5
    pb = prop_byte // 45
    dict_size = struct.unpack_from("<I", props, 1)[0]
    return lzma.decompress(
        raw[45 : 45 + compressed_size],
        format=lzma.FORMAT_RAW,
        filters=[{"id": lzma.FILTER_LZMA1, "lc": lc, "lp": lp, "pb": pb, "dict_size": dict_size}],
    )


class SpriteCatalog:
    def __init__(self, assets_dir: Path, sheet_cache_size: int = 48) -> None:
        self.dir = Path(assets_dir)
        raw = json.loads((self.dir / "catalog-content.json").read_text(encoding="utf-8"))

        self.sheets: list[SheetEntry] = sorted(
            (
                SheetEntry(e["firstspriteid"], e["lastspriteid"], e["file"], e["spritetype"])
                for e in raw
                if e.get("type") == "sprite"
            ),
            key=lambda s: s.first_id,
        )
        self._starts = [s.first_id for s in self.sheets]
        self._cache: OrderedDict[str, Image.Image] = OrderedDict()
        self._cache_size = sheet_cache_size

        self.files: dict[str, str] = {
            e["type"]: e["file"] for e in raw if e.get("type") != "sprite"
        }

    @property
    def appearances_path(self) -> Path:
        return self.dir / self.files["appearances"]

    @property
    def max_sprite_id(self) -> int:
        return self.sheets[-1].last_id

    def find_sheet(self, sprite_id: int) -> SheetEntry | None:
        idx = bisect.bisect_right(self._starts, sprite_id) - 1
        if idx < 0:
            return None
        sheet = self.sheets[idx]
        return sheet if sheet.first_id <= sprite_id <= sheet.last_id else None

    def _load(self, sheet: SheetEntry) -> Image.Image:
        cached = self._cache.get(sheet.file)
        if cached is not None:
            self._cache.move_to_end(sheet.file)
            return cached
        image = Image.open(io.BytesIO(decompress_sheet(self.dir / sheet.file))).convert("RGBA")
        self._cache[sheet.file] = image
        if len(self._cache) > self._cache_size:
            self._cache.popitem(last=False)
        return image

    def get_sprite(self, sprite_id: int) -> Image.Image | None:
        sheet = self.find_sheet(sprite_id)
        if sheet is None:
            return None
        tw, th = sheet.tile_size
        local = sprite_id - sheet.first_id
        cols = SHEET_SIZE // tw
        x, y = (local % cols) * tw, (local // cols) * th
        return self._load(sheet).crop((x, y, x + tw, y + th))

    def iter_sprites(self, sprite_ids: Iterable[int]) -> Iterator[tuple[int, Image.Image]]:
        """Stream tiles grouped by sheet.

        Each sheet is decompressed exactly once and released immediately, so
        peak memory stays at one sheet regardless of how many IDs are requested.
        """
        by_sheet: dict[str, list[int]] = {}
        entries: dict[str, SheetEntry] = {}
        for sid in sprite_ids:
            sheet = self.find_sheet(sid)
            if sheet is None:
                continue
            by_sheet.setdefault(sheet.file, []).append(sid)
            entries[sheet.file] = sheet

        for file, ids in by_sheet.items():
            sheet = entries[file]
            image = self._load(sheet)
            tw, th = sheet.tile_size
            cols = SHEET_SIZE // tw
            for sid in ids:
                local = sid - sheet.first_id
                x, y = (local % cols) * tw, (local // cols) * th
                yield sid, image.crop((x, y, x + tw, y + th))
            self._cache.pop(file, None)

    def missing(self, sprite_ids: Iterable[int]) -> list[int]:
        return [sid for sid in sprite_ids if self.find_sheet(sid) is None]
