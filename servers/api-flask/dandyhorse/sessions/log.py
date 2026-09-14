"""Append-only JSONL session logs, gzip on finalize, and reading them back."""
from __future__ import annotations

import gzip
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import IO, Any, Iterator

from ..util import dumps


def relpath(session_id: str, created_at: float) -> str:
    d = datetime.fromtimestamp(created_at, tz=timezone.utc)
    return f"{d:%Y}/{d:%m}/{session_id}.jsonl"


class LogWriter:
    def __init__(self, base: Path, rel: str) -> None:
        self.path = base / rel
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._fh: IO[str] | None = open(self.path, "a", encoding="utf-8")

    def write(self, rec: dict[str, Any]) -> None:
        if self._fh is None:
            return
        self._fh.write(dumps(rec))
        self._fh.write("\n")
        self._fh.flush()

    def close(self) -> None:
        if self._fh is not None:
            self._fh.close()
            self._fh = None


def finalize(base: Path, rel: str) -> str:
    """gzip <rel> in place; returns the new relative path."""
    src = base / rel
    dst = base / (rel + ".gz")
    if src.is_file():
        with open(src, "rb") as fin, gzip.open(dst, "wb") as fout:
            while chunk := fin.read(1 << 16):
                fout.write(chunk)
        os.remove(src)
    return rel + ".gz"


def read_records(base: Path, rel: str | None) -> list[dict[str, Any]]:
    if not rel:
        return []
    for cand in (rel, rel + ".gz", rel[:-3] if rel.endswith(".gz") else rel):
        p = base / cand
        if p.is_file():
            return list(_iter(p))
    return []


def _iter(p: Path) -> Iterator[dict[str, Any]]:
    opener = gzip.open if p.suffix == ".gz" else open
    with opener(p, "rt", encoding="utf-8") as fh:  # type: ignore[operator]
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except ValueError:
                continue  # torn final line after a crash


def timeline_path(base: Path, rel: str) -> Path:
    stem = rel[:-3] if rel.endswith(".gz") else rel
    stem = stem[:-6] if stem.endswith(".jsonl") else stem
    return base / (stem + ".timeline.json.gz")


def write_timeline(base: Path, rel: str, rows: list[dict[str, Any]]) -> None:
    p = timeline_path(base, rel)
    with gzip.open(p, "wt", encoding="utf-8") as fh:
        fh.write(dumps(rows))


def read_timeline(base: Path, rel: str) -> list[dict[str, Any]] | None:
    p = timeline_path(base, rel)
    if not p.is_file():
        return None
    with gzip.open(p, "rt", encoding="utf-8") as fh:
        return json.load(fh)
