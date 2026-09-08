"""Atlas packing.

Every Tibia tile is 32x32, 32x64, 64x32 or 64x64, so a uniform grid per size
class packs at 100% efficiency and runs in linear time. A general rectangle
packer (MaxRects et al.) would be strictly worse here and much slower.

Sprites are not trimmed. Rendering alignment depends on the full tile, and the
transparent margins cost almost nothing once the page is compressed.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image


@dataclass(slots=True)
class Frame:
    page: int
    x: int
    y: int
    w: int
    h: int


@dataclass
class AtlasBuilder:
    name: str
    page_size: int = 2048
    _pages: list[Image.Image] = field(default_factory=list)
    _frames: dict[int, Frame] = field(default_factory=dict)
    # content hash -> frame, so identical tiles are stored once
    _by_hash: dict[bytes, Frame] = field(default_factory=dict)
    # (tile_w, tile_h) -> (page index, next slot)
    _cursors: dict[tuple[int, int], tuple[int, int]] = field(default_factory=dict)
    empty_ids: set[int] = field(default_factory=set)
    duplicate_count: int = 0

    def add(self, sprite_id: int, image: Image.Image) -> None:
        if sprite_id in self._frames or sprite_id in self.empty_ids:
            return
        if image.getbbox() is None:
            self.empty_ids.add(sprite_id)
            return

        digest = hashlib.blake2b(image.tobytes(), digest_size=16).digest()
        existing = self._by_hash.get(digest)
        if existing is not None:
            self._frames[sprite_id] = existing
            self.duplicate_count += 1
            return

        frame = self._allocate(image.width, image.height)
        self._pages[frame.page].paste(image, (frame.x, frame.y))
        self._frames[sprite_id] = frame
        self._by_hash[digest] = frame

    def _allocate(self, w: int, h: int) -> Frame:
        cols = self.page_size // w
        rows = self.page_size // h
        per_page = cols * rows
        key = (w, h)
        page, slot = self._cursors.get(key, (-1, per_page))
        if slot >= per_page:
            page = len(self._pages)
            self._pages.append(Image.new("RGBA", (self.page_size, self.page_size), (0, 0, 0, 0)))
            slot = 0
        self._cursors[key] = (page, slot + 1)
        return Frame(page, (slot % cols) * w, (slot // cols) * h, w, h)

    def save(self, out_dir: Path, *, fmt: str = "webp", quality: int = 95) -> dict:
        out_dir.mkdir(parents=True, exist_ok=True)
        files: list[str] = []
        for index, page in enumerate(self._pages):
            filename = f"{self.name}-{index}.{fmt}"
            path = out_dir / filename
            if fmt == "webp":
                page.save(path, "WEBP", lossless=True, quality=quality, method=6)
            else:
                page.save(path, "PNG", optimize=True)
            files.append(filename)

        total_bytes = sum((out_dir / f).stat().st_size for f in files)
        return {
            "pages": files,
            "pageSize": self.page_size,
            "frames": {
                str(sid): [f.page, f.x, f.y, f.w, f.h] for sid, f in sorted(self._frames.items())
            },
            "emptySprites": sorted(self.empty_ids),
            "stats": {
                "uniqueFrames": len(self._by_hash),
                "mappedSprites": len(self._frames),
                "duplicates": self.duplicate_count,
                "empty": len(self.empty_ids),
                "pageCount": len(self._pages),
                "bytes": total_bytes,
            },
        }
