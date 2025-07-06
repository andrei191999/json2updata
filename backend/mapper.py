from __future__ import annotations

import logging, re, yaml
import uuid
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

from rapidfuzz import fuzz, process

from backend.smart_suggester import SmartSuggester
from backend.spec_parser import TagSpec, load_spec
from backend.date_utils import looks_like_date as _is_date

_log = logging.getLogger(__name__)


# ────────────────────────────── helpers ──────────────────────────────────
def _is_empty(v: Any) -> bool:
    return v in ("", None, []) or (isinstance(v, str) and v.strip() == "")


def _is_parent(tag: str, spec_by_tag: dict[str, TagSpec]) -> bool:
    ts = spec_by_tag.get(tag)
    return bool(ts and ts.is_parent)


# ────────────────────────────────── Mapper ───────────────────────────────────
class Mapper:
    def __init__(
        self,
        spec_path: str | Path,
        defaults_path: str | Path | None = None,
        fuzzy_threshold: int = 60,
        *,
        enable_semantic: bool = True,
    ) -> None:
        (
            self._specs,
            self._required,
            self._cond_required,
            self._parent_req,
            self._parent_opt,
            self._alias_map,
            self._alias_rev_map,
            self._order_map,
        ) = load_spec(Path(spec_path))

        # DEBUG: dump what the mapper thinks are parents vs required
        _log.debug(
            "Mapper.init → required(%d)=%s ; cond(%d)=%s ; "
            "parents_req(%d)=%s ; parents_opt(%d)=%s",
            len(self._required), sorted(self._required),
            len(self._cond_required), sorted(self._cond_required),
            len(self._parent_req), sorted(self._parent_req),
            len(self._parent_opt), sorted(self._parent_opt),
        )

        self._spec_by_tag: dict[str, TagSpec] = {s.tag: s for s in self._specs}

        self.fuzzy_threshold = fuzzy_threshold
        self._defaults: Dict[str, Any] = self._load_defaults(defaults_path)  # kept for later use

        # ── suggestion engine
        self._suggester = SmartSuggester(
            canonical=[s.tag for s in self._specs],
            alias_map={k: list(v) for k, v in self._alias_map.items()},
            alias_rev=self._alias_rev_map,
            fuzzy_threshold=fuzzy_threshold,
            enable_semantic=enable_semantic,
        )

    # ---------------------------------------------------------------- utils
    @staticmethod
    def _load_defaults(path: str | Path | None) -> Dict[str, Any]:
        if not path or not Path(path).exists():
            return {}
        return yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}

    @staticmethod
    def _sanitize(k: str) -> str:
        """cmis:foo → cmis_foo ; spaces → _ ; strip"""
        return re.sub(r"\s+", "_", k.replace(":", "_")).strip()

    # ---------------------------------------------------------------- key-→tag
    def _resolve_key(self, key: str, val: Any) -> str | None:
        """
        Map a raw JSON key to a canonical Updata tag using, in order:

        ① exact         ② alias         ③ sanitised
        ④ type-hints    ⑤ fuzzy ≥ threshold
        """
        canon = self._suggester.canonical

        # ① exact
        if key in canon:
            return key

        # ② alias
        if key.lower() in self._alias_rev_map:
            return self._alias_rev_map[key.lower()]

        # ③ sanitised
        s = self._sanitize(key)
        if s in canon:
            return s
        if s.lower() in self._alias_rev_map:
            return self._alias_rev_map[s.lower()]

        # ④ type hints
        if _is_date(val):
            for t in canon:
                if t.lower().endswith("date"):
                    return t
        if isinstance(val, (int, float)):
            for t in canon:
                if any(x in t.lower() for x in ("amount", "total", "due")):
                    return t

        # ⑤ fuzzy
        match, score, _ = process.extractOne(
            key, canon, scorer=fuzz.token_sort_ratio
        )
        return match if score >= self.fuzzy_threshold else None

    # ─────────────────── classify
    def _classify(
        self, mapped: Dict[str, Any]
    ) -> Tuple[Set[str], Set[str]]:
        """
        Return (errors, warnings) according to the rules:

        • errors   = required leafs  (missing ∪ empty)
        • warnings = mapped-but-empty non-required leafs
        """
        errors: Set[str] = set()
        warnings: Set[str] = set()

        for tag in self._required:
            if _is_parent(tag, self._spec_by_tag):
                continue
            if tag not in mapped:
                errors.add(tag)
            elif _is_empty(mapped[tag]):
                errors.add(tag)

        for tag, val in mapped.items():
            if tag in self._required or _is_parent(tag, self._spec_by_tag):
                continue
            if _is_empty(val):
                warnings.add(tag)

        return errors, warnings

    # ─────────────────── map_json
    def map_json(
        self, data: Dict[str, Any]
    ) -> Tuple[Dict[str, Any], Dict[str, Any], Tuple[Set[str], Set[str]]]:
        mapped: Dict[str, Any] = {}
        leftover: Dict[str, Any] = {}

        # pass 1 – direct & alias mapping
        for raw_key, val in data.items():
            if _is_empty(val):
                continue
            tag = self._resolve_key(str(raw_key), val)
            if tag:
                mapped[tag] = val
                self._suggester.register_mapping({tag: raw_key})
            else:
                leftover[self._sanitize(raw_key)] = val

        # pass 2 — REQUIRED tags only: fall-back to alias list
        for req in self._required:
            if req in mapped:
                continue
            for alias in self._alias_map.get(req, ()):
                if (val := data.get(alias)) not in ("", None, []):
                    mapped[req] = val
                    break

        # inject YAML defaults ── only for *missing mandatory* tags
        self._apply_defaults(mapped, self._required - mapped.keys())
        # final classification

        errors, warnings = self._classify(mapped)
        return mapped, leftover, (errors, warnings)

    def _apply_defaults(self, mapped: Dict[str, Any], missing: Set[str]) -> None:
        def walk(pref: str, node: Any):
            if isinstance(node, dict):
                for k, v in node.items():
                    walk(f"{pref}.{k}" if pref else k, v)
            elif pref in missing and pref not in mapped:
                mapped[pref] = (
                    str(uuid.uuid4()) if node == "__AUTO_UUID__" else node
                )

        walk("", self._defaults)

    # -------------------- suggestion list  (for dropdown)
    def suggest(self, json_data: Dict[str, Any], *, level: str = "normal", top_n: int = 5) -> Dict[str, List[Tuple[str, int]]]:
        # delegate to SmartSuggester – now does alias, sane fuzzy,
        # type hints, frequency & MiniLM similarity
        return self._suggester.suggest(json_data, level=level, top_n=top_n)
