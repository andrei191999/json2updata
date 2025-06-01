"""mapper.py - deterministic alias-first mapper with stricter fuzzy logic.

Mapping passes (in this order)
------------------------------
1. **Exact tag match**               - `key == tag`
2. **Alias match (case-folded)**     - from spec `Alias` column
3. **Colon-stripped key**            - `cmis:xyz`  →  `cmis_xyz`
4. **Fuzzy match** (`token_set_ratio >= threshold`)
5. Remaining keys go to `<CustomMetadata>`

Missing mandatory tags are filled from `defaults` (YAML or hard-coded).

The mapper is intentionally *pure* - no file-system or XML calls - so it is
unit-test friendly and can be reused by both CLI and GUI.
"""
from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path
from typing import Dict, Tuple, Any, Set

import yaml
from rapidfuzz import process, fuzz  # pip install rapidfuzz

from spec_parser import load_spec, TagSpec

_log = logging.getLogger(__name__)


class Mapper:
    def __init__(
        self,
        spec_path: str | Path,
        defaults_path: str | Path | None = None,
        fuzzy_threshold: int = 90,
        include_cmis: bool = False,
        include_lower: bool = False
    ):
        # Load the flat CSV/XLSX spec (list of TagSpec, required set, alias_map)
        self._tag_specs, self._required, self._cond_required, self._alias_map, _ = load_spec(spec_path)
        self.fuzzy_threshold = fuzzy_threshold

        # Load defaults.yaml (nested dict) or empty if not found
        self.defaults = self._load_defaults(defaults_path)

        # List of all canonical tag names (for fuzzy matching)
        self._canonical_tags = [ts.tag for ts in self._tag_specs]

        self.pass_prefixes = set()
        if include_cmis:
            self.pass_prefixes.update({"cmis:", "cmis_"})
        if include_lower:
            self.pass_prefixes.update({"lower:", "lower_"})

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _load_defaults(path: str | Path | None) -> Dict[str, Any]:
        if not path:
            return {}
        try:
            with Path(path).open(encoding="utf-8") as fh:
                return yaml.safe_load(fh) or {}
        except FileNotFoundError:
            _log.warning("defaults file %s not found – continuing without it", path)
            return {}

    @staticmethod
    def _sanitize(key: str) -> str:
        """Replace colon with underscore, collapse whitespace."""
        return re.sub(r"\s+", "_", key.replace(":", "_")).strip()

    # ------------------------------------------------------------------ public
    def map_json(
        self, data: Dict[str, Any]
    ) -> Tuple[Dict[str, Any], Dict[str, Any], Set[str]]:
        """
        Returns
        -------
        mapped     : canonical_tag -> value
        leftover   : unmapped_key  -> value   (→ <CustomMetadata>)
        missing    : set[str]  mandatory tags still missing *after* defaults
        """
        mapped: Dict[str, Any] = {}
        leftover: Dict[str, Any] = {}

        for raw_key, val in data.items():
            if val in (None, "", []):
                continue

             # ---------------------------------------------------------------- skip cmis/lower unless opted-in
            if raw_key.startswith(("cmis:", "cmis_", "lower:", "lower_")) and not any(raw_key.startswith(p) for p in self.pass_prefixes):
                continue                 # ignore completely


            key = str(raw_key).strip()
            hit = self._resolve_key(key)
            if hit:
                mapped[hit] = val
            else:
                leftover[self._sanitize(key)] = val

        # Find which required tags are still missing before defaults
        missing = self._required - set(mapped.keys())

        # Fill defaults for any missing required tags
        self._apply_defaults(mapped, missing)

        # Now compute missing_after_defaults
        missing_after = self._required - set(mapped.keys())

        # ---------- conditional-required (“Y?”) ----------
        for tag in getattr(self, "_cond_required", set()):
            parent = tag.rsplit(".", 1)[0]
            if parent in mapped and tag not in mapped:
                missing_after.add(tag)
        # --------------------------------------------------

        if missing_after:
            _log.warning(
                "still missing %d required tag(s): %s",
                len(missing_after),
                ", ".join(sorted(list(missing_after))[:10])
                + ("…" if len(missing_after) > 10 else ""),
            )

        # if we also have same key sans prefix → drop duplicate
        for k in list(leftover):
            if k.startswith(("cmis_", "lower_")):
                plain = k.split("_", 1)[1]          # strip prefix once
                if plain in mapped:
                    leftover.pop(k)

        return mapped, leftover, missing_after

    # ------------------------------------------------------------------ internals
    def _resolve_key(self, key: str) -> str | None:
        """Return canonical tag for a given JSON key or None."""
        # 1. exact hit (JSON key exactly equals a tag name)
        if key in self._required or key in self._canonical_tags:
            return key

        # 2. alias lookup (case-insensitive)
        aliased = self._alias_map.get(key.lower())
        if aliased:
            return aliased

        # 3. colon-stripped version
        sanitized = self._sanitize(key)
        if sanitized in self._canonical_tags:
            return sanitized
        aliased2 = self._alias_map.get(sanitized.lower())
        if aliased2:
            return aliased2

        # 4. fuzzy match
        thresh = self.fuzzy_threshold if len(key) > 8 else 85
        match, score, _ = process.extractOne(
            key, self._canonical_tags, scorer=fuzz.token_sort_ratio
        )
        if score >= thresh:
            return match

        return None

    # ------------------------------------------ defaults
    def _apply_defaults(self, mapped: Dict[str, Any], missing: Set[str]) -> None:
        """
        Walk `self.defaults` and inject any values for tags still in `missing`.
        Also auto-generate a UUID if the sentinel "__AUTO_UUID__" is found.
        """
        def walk(prefix: str, node: Any):
            if isinstance(node, dict):
                for k, v in node.items():
                    walk(f"{prefix}.{k}" if prefix else k, v)
            else:
                if prefix in missing and prefix not in mapped:
                    mapped[prefix] = node

        walk("", self.defaults)

        # Special: if Document.UUID was "__AUTO_UUID__", generate a uuid4()
        if mapped.get("Document.UUID") == "__AUTO_UUID__":
            mapped["Document.UUID"] = str(uuid.uuid4())