"""Copy the client's UI art into the web assets folder, converted to WebP.

The client ships ~2,800 UI PNGs totalling ~119 MB, but most of the weight is a
handful of large animated backgrounds for features we do not build (ranked PvP
queue, shader demos). Excluding those and re-encoding to lossless WebP brings it
down to something shippable.

    python tools/extractor/copy_ui.py
    python tools/extractor/copy_ui.py --include-all --max-mb 20
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "cliente pc" / "assets_unpacked" / "data" / "images"
DEFAULT_OUT = Path(__file__).parent / "out" / "assets" / "ui"

# Directories (relative to SOURCE) we do not need for this game.
EXCLUDED_DIRS = {
    "game/ranked-queue",   # ~60 MB of animated PvP-queue backdrops
    "shaders",             # shader demo art, not UI
    "game/mobile",
    "game/memorial",
    "game/transfer",
    "game/eventschedule",
    "voice",
    "latency",
}

# Individual files that are large and unused.
EXCLUDED_FILES = {"background3.png", "ki.png"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--include-all", action="store_true", help="ignore the exclusion list")
    parser.add_argument("--max-mb", type=float, default=1.5, help="skip source images larger than this")
    parser.add_argument("--keep-png", action="store_true", help="copy as-is instead of converting to WebP")
    args = parser.parse_args()

    if args.out.exists():
        shutil.rmtree(args.out)
    args.out.mkdir(parents=True, exist_ok=True)

    copied = skipped_excluded = skipped_large = 0
    source_bytes = out_bytes = 0

    for path in sorted(SOURCE.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(SOURCE)
        posix = rel.as_posix()

        if not args.include_all:
            if any(posix.startswith(d + "/") for d in EXCLUDED_DIRS) or path.name in EXCLUDED_FILES:
                skipped_excluded += 1
                continue

        size = path.stat().st_size
        if size > args.max_mb * 1024 * 1024:
            skipped_large += 1
            continue

        source_bytes += size
        dest = args.out / rel
        dest.parent.mkdir(parents=True, exist_ok=True)

        if args.keep_png or path.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
            shutil.copy2(path, dest)
        else:
            dest = dest.with_suffix(".webp")
            with Image.open(path) as image:
                image.convert("RGBA").save(dest, "WEBP", lossless=True, method=6)
        out_bytes += dest.stat().st_size
        copied += 1

    print(f"copied           : {copied}")
    print(f"skipped excluded : {skipped_excluded}")
    print(f"skipped >{args.max_mb} MB   : {skipped_large}")
    print(f"source           : {source_bytes / 1024 / 1024:.1f} MB")
    print(f"output           : {out_bytes / 1024 / 1024:.1f} MB  -> {args.out}")


if __name__ == "__main__":
    main()
