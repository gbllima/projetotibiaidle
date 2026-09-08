#!/usr/bin/env python3
"""Pack animated attack/*.webp into horizontal strips for the web client."""
from __future__ import annotations

import json
import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'attack'
OUT = ROOT / 'tools' / 'extractor' / 'out' / 'assets' / 'attack'

MAPPING = {
    'attack-sword.webp': 'sword',
    'attack-axe.webp': 'axe',
    'attack-club.webp': 'club',
    'attack-fist.webp': 'fist',
    'attack-monk-daggers.webp': 'monk-daggers',
    'attack-monk-staff.webp': 'monk-staff',
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    meta: dict = {
        'frameWidth': 128,
        'frameHeight': 128,
        'frameCount': 5,
        'animationSpeed': 0.32,
        'sprites': {},
    }

    for fname, key in MAPPING.items():
        path = SRC / fname
        if not path.exists():
            raise SystemExit(f'missing {path}')

        img = Image.open(path)
        frames = []
        for i in range(getattr(img, 'n_frames', 1)):
            img.seek(i)
            frames.append(img.copy().convert('RGBA'))

        w, h = frames[0].size
        strip = Image.new('RGBA', (w * len(frames), h))
        for i, frame in enumerate(frames):
            strip.paste(frame, (i * w, 0))

        strip_name = f'{key}-strip.webp'
        strip.save(OUT / strip_name, 'WEBP', lossless=True)
        meta['frameWidth'] = w
        meta['frameHeight'] = h
        meta['frameCount'] = len(frames)
        meta['sprites'][key] = strip_name

    (OUT / 'attack-effects.json').write_text(json.dumps(meta, indent=2), encoding='utf-8')
    print(f'packed {len(meta["sprites"])} attack effects -> {OUT}')


if __name__ == '__main__':
    main()
