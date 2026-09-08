"""Parser for `appearances-<sha>.dat` (protobuf, schema in servidor/src/protobuf).

Only the fields the game needs are decoded. Unknown fields are skipped by the
wire reader, so a schema addition upstream will not break this.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import IntEnum
from pathlib import Path

from .wire import WIRE_LEN, read_fields, read_packed_varints


class FrameGroupKind(IntEnum):
    OUTFIT_IDLE = 0
    OUTFIT_MOVING = 1
    OBJECT_INITIAL = 2


@dataclass(slots=True)
class SpritePhase:
    duration_min: int = 0
    duration_max: int = 0


@dataclass(slots=True)
class SpriteInfo:
    pattern_width: int = 1
    pattern_height: int = 1
    pattern_depth: int = 1
    layers: int = 1
    sprite_ids: list[int] = field(default_factory=list)
    phases: list[SpritePhase] = field(default_factory=list)
    loop_type: int = 0
    is_opaque: bool = False

    @property
    def frame_count(self) -> int:
        return max(1, len(self.phases))

    def sprite_index(
        self, *, phase: int = 0, direction: int = 0, addon: int = 0, mount: int = 0, layer: int = 0
    ) -> int:
        """Flat index into `sprite_ids`.

        Mirrors OTClient's ThingType::getSpriteIndex. Multi-tile sub-offsets
        (w/h) are omitted; creature and effect sprites are single-tile.
        """
        index = phase % self.frame_count
        index = index * self.pattern_depth + mount
        index = index * self.pattern_height + addon
        index = index * self.pattern_width + direction
        index = index * self.layers + layer
        return index

    def sprite_at(self, **kwargs: int) -> int | None:
        index = self.sprite_index(**kwargs)
        return self.sprite_ids[index] if 0 <= index < len(self.sprite_ids) else None


@dataclass(slots=True)
class FrameGroup:
    kind: int = FrameGroupKind.OBJECT_INITIAL
    sprite_info: SpriteInfo = field(default_factory=SpriteInfo)


class ItemCategory(IntEnum):
    ARMORS = 1
    AMULETS = 2
    BOOTS = 3
    CONTAINERS = 4
    DECORATION = 5
    FOOD = 6
    HELMETS_HATS = 7
    LEGS = 8
    OTHERS = 9
    POTIONS = 10
    RINGS = 11
    RUNES = 12


@dataclass(slots=True)
class Appearance:
    id: int = 0
    name: str | None = None
    frame_groups: list[FrameGroup] = field(default_factory=list)
    market_category: int | None = None
    equip_slot: int | None = None
    weapon_type: int | None = None
    is_ground: bool = False
    is_container: bool = False
    is_stackable: bool = False
    is_corpse: bool = False
    is_ammo: bool = False
    is_takeable: bool = False

    @property
    def all_sprite_ids(self) -> set[int]:
        return {sid for g in self.frame_groups for sid in g.sprite_info.sprite_ids}

    def group(self, kind: int) -> FrameGroup | None:
        for g in self.frame_groups:
            if g.kind == kind:
                return g
        return self.frame_groups[0] if self.frame_groups else None


def _parse_sprite_info(buf: bytes) -> SpriteInfo:
    info = SpriteInfo()
    for fid, wire, value in read_fields(buf):
        if fid == 1:
            info.pattern_width = value
        elif fid == 2:
            info.pattern_height = value
        elif fid == 3:
            info.pattern_depth = value
        elif fid == 4:
            info.layers = value
        elif fid == 5:
            info.sprite_ids.extend(read_packed_varints(value) if wire == WIRE_LEN else [value])
        elif fid == 6:
            for afid, _, avalue in read_fields(value):
                if afid == 4:
                    info.loop_type = avalue
                elif afid == 6:
                    phase = SpritePhase()
                    for pfid, _, pvalue in read_fields(avalue):
                        if pfid == 1:
                            phase.duration_min = pvalue
                        elif pfid == 2:
                            phase.duration_max = pvalue
                    info.phases.append(phase)
        elif fid == 8:
            info.is_opaque = bool(value)
    return info


def _parse_flags(appearance: Appearance, buf: bytes) -> None:
    """Field numbers come from AppearanceFlags in appearances.proto."""
    for fid, _, value in read_fields(buf):
        if fid == 1:  # bank -> ground tile
            appearance.is_ground = True
        elif fid == 5:
            appearance.is_container = bool(value)
        elif fid == 6:  # cumulative
            appearance.is_stackable = bool(value)
        elif fid == 18:  # take
            appearance.is_takeable = bool(value)
        elif fid == 34:  # clothes
            for cfid, _, cvalue in read_fields(value):
                if cfid == 1:
                    appearance.equip_slot = cvalue
        elif fid == 36:  # market
            for mfid, _, mvalue in read_fields(value):
                if mfid == 1:
                    appearance.market_category = mvalue
        elif fid == 42:
            appearance.is_corpse = bool(value)
        elif fid == 45:
            appearance.is_ammo = bool(value)
        elif fid == 64:
            appearance.weapon_type = value


def _parse_appearance(buf: bytes) -> Appearance:
    appearance = Appearance()
    for fid, _, value in read_fields(buf):
        if fid == 1:
            appearance.id = value
        elif fid == 2:
            group = FrameGroup()
            for gfid, _, gvalue in read_fields(value):
                if gfid == 1:
                    group.kind = gvalue
                elif gfid == 3:
                    group.sprite_info = _parse_sprite_info(gvalue)
            appearance.frame_groups.append(group)
        elif fid == 3:
            _parse_flags(appearance, value)
        elif fid == 4:
            appearance.name = value.decode("utf-8", "replace")
    return appearance


@dataclass(slots=True)
class Appearances:
    objects: dict[int, Appearance]
    outfits: dict[int, Appearance]
    effects: dict[int, Appearance]
    missiles: dict[int, Appearance]

    @classmethod
    def load(cls, path: Path) -> "Appearances":
        data = Path(path).read_bytes()
        buckets: dict[int, dict[int, Appearance]] = {1: {}, 2: {}, 3: {}, 4: {}}
        for fid, _, value in read_fields(data):
            bucket = buckets.get(fid)
            if bucket is None:
                continue
            appearance = _parse_appearance(value)
            bucket[appearance.id] = appearance
        return cls(buckets[1], buckets[2], buckets[3], buckets[4])

    def category(self, name: str) -> dict[int, Appearance]:
        return {
            "object": self.objects,
            "outfit": self.outfits,
            "effect": self.effects,
            "missile": self.missiles,
        }[name]
