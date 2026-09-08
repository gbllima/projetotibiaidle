"""Minimal protobuf wire-format reader.

We deliberately avoid the `protobuf` runtime and codegen. The appearances schema
is stable and we only read a handful of fields, so a 60-line reader removes a
build step and a dependency.
"""

from __future__ import annotations

import struct
from typing import Iterator

WIRE_VARINT = 0
WIRE_I64 = 1
WIRE_LEN = 2
WIRE_I32 = 5


def read_varint(buf: bytes, pos: int) -> tuple[int, int]:
    result = 0
    shift = 0
    while True:
        byte = buf[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, pos
        shift += 7


def read_fields(buf: bytes, start: int = 0, end: int | None = None) -> Iterator[tuple[int, int, int | bytes]]:
    """Yield (field_number, wire_type, value) for every field in the buffer."""
    pos = start
    end = len(buf) if end is None else end
    while pos < end:
        key, pos = read_varint(buf, pos)
        field, wire = key >> 3, key & 7
        if wire == WIRE_VARINT:
            value, pos = read_varint(buf, pos)
        elif wire == WIRE_LEN:
            length, pos = read_varint(buf, pos)
            value = buf[pos : pos + length]
            pos += length
        elif wire == WIRE_I32:
            value = struct.unpack_from("<I", buf, pos)[0]
            pos += 4
        elif wire == WIRE_I64:
            value = struct.unpack_from("<Q", buf, pos)[0]
            pos += 8
        else:
            raise ValueError(f"unsupported wire type {wire} at offset {pos}")
        yield field, wire, value


def read_packed_varints(buf: bytes) -> list[int]:
    pos = 0
    out: list[int] = []
    while pos < len(buf):
        value, pos = read_varint(buf, pos)
        out.append(value)
    return out
