"""smart_suggester.py  – Modular, pluggable suggestion engine
────────────────────────────────────────────────────────────────────────
A *single* entry‑point, `SmartSuggester.suggest(json, level="normal")`,
rank‑orders JSON keys for every Updata tag by combining up to seven
signals:

①  Exact & alias matches                     (+120 / +110)
②  Sanitised key (`cmis:foo → cmis_foo`)      (+105)
③  Fuzzy token‑sort ratio (RapidFuzz)         (0‑100)
④  Camel/snake/dot normalisation before fuzz  (InvoiceDate ≈ invoice_date)
⑤  Lightweight type hints (date/number)       (+15 / 10)
⑥  Cross‑file frequency memory               (+5 ⋅ min(freq,5))
⑦  MiniLM semantic similarity *(deep mode only)* (+30 ≥ 0.60 cos)

`level` keyword chooses how many signals are active:
    • "fast"   → ①‑③              – blazingly quick
    • "normal" → ①‑⑥              – sensible default
    • "deep"   → ①‑⑦ *(loads MiniLM lazily on first call)*

Public API (unchanged for the rest of the codebase) ───────────────
>>> sugg = SmartSuggester(canonical, alias_map, alias_rev)
>>> sugg.suggest(json_obj)                     # default "normal"
>>> sugg.suggest(json_obj, level="fast")      # skip heavy bits
>>> sugg.register_mapping({tag: key})          # train frequency boost

The class has **no** FastAPI / Pydantic ties – unit‑test standalone.
"""
from __future__ import annotations

import re
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Sequence, Tuple

from rapidfuzz import fuzz

from backend.date_utils import looks_like_date as _is_date
from backend.logging_config import dbg, thread_local
from backend.settings import get_settings

# MiniLM is optional – import guarded
try:
    from sentence_transformers import SentenceTransformer, util  # type: ignore
except ImportError:
    SentenceTransformer = None  # type: ignore
    util = None  # type: ignore

settings = get_settings()

# ────────────────────────────────────────────────────────────────────
class SmartSuggester:
    """Score JSON keys against Updata tags with pluggable heuristics."""

    __slots__ = (
        "canonical",
        "alias_map",
        "alias_rev",
        "fuzzy_threshold",
        "freq",
        "_semantic_on",
        "_model",
        "_tag_vecs",
        "_model_name",
    )

    def __init__(
        self,
        canonical: Sequence[str],
        alias_map: Dict[str, Sequence[str]],
        alias_rev: Dict[str, str],
        *,
        fuzzy_threshold: int | None = None,
        enable_semantic: bool = True,
        model_name: str | None = None,
    ) -> None:
        # ── resolve defaults FIRST ───────────────────────────────────
        if fuzzy_threshold is None:
            fuzzy_threshold = settings.FUZZY_THRESHOLD
        if model_name is None:
            model_name = settings.SEMANTIC_MODEL_NAME

        # ── core fields ──────────────────────────────────────────────
        self.canonical      = list(canonical)
        self.alias_map      = {k: list(v) for k, v in alias_map.items()}
        self.alias_rev      = alias_rev
        self.fuzzy_threshold = fuzzy_threshold

        # cross-file key frequency
        self.freq: defaultdict[str, int] = defaultdict(int)

        # semantic bits (lazy)
        self._semantic_on = enable_semantic and SentenceTransformer is not None
        self._model_name  = model_name
        self._model       = None
        self._tag_vecs: Dict[str, Any] = {}

        # ── contextual log once everything exists ───────────────────
        thread_local.log_context_filename = "__suggester__"
        dbg(
            "smart_suggester",
            "INIT",
            fuzzy=self.fuzzy_threshold,
            semantic_on=self._semantic_on,
            model=self._model_name,
        )

    # ─── public helpers ────────────────────────────────────────────
    def suggest(
        self,
        data: Dict[str, Any],
        *,
        level: str = "normal",   # fast | normal | deep
        top_n: int = 5,
    ) -> Dict[str, List[Tuple[str, int]]]:
        """Return {tag: [(json_key, score)…]} ranked desc by *score*."""

        level = level.lower()
        if level not in {"fast", "normal", "deep"}:
            dbg("smart_suggester", "unknown level → falling back to 'normal'", level)
            level = "normal"

        use_fuzzy     = level in {"normal", "deep"}
        use_type_hint = use_fuzzy                      # same tiers
        use_freq      = level in {"normal", "deep"}
        use_semantic  = level == "deep" and self._semantic_on

        # ── lazy‑load MiniLM only if really needed ─────────────────
        if use_semantic and self._model is None:
            try:
                dbg("smart_suggester", "Downloading MiniLM", model=self._model_name)
                from sentence_transformers import SentenceTransformer  # type: ignore  # pylint: disable=import-error

                self._model = SentenceTransformer(self._model_name)
                self._tag_vecs = {
                    t: self._model.encode(t, convert_to_tensor=True)
                    for t in self.canonical
                }
                dbg("smart_suggester", "MiniLM ready – deep suggestions enabled")
            except Exception as exc:  # noqa: BLE001
                dbg("smart_suggester", "MiniLM load failed", error=str(exc))
                use_semantic = False
        else:
            # ── semantic disabled – log *why* ──────────────────────
            if not use_semantic:
                reason = (
                    f"level={level} (!= deep)" if level != "deep" else
                    "semantic_on False (disabled or sentence-transformers missing)"
                )
                dbg("smart_suggester", "Semantic skipped", reason=reason)

        flat_keys = list(self._flatten_json(data))
        dbg("smart_suggester", "Flattened keys", keys=flat_keys)
        san_map   = {k: self._sanitize(k) for k in flat_keys}
        norm_map  = {k: self._normalize(k) for k in flat_keys}

        # Optional per‑call key vectors (only deep & semantic ready)
        key_vecs: Dict[str, Any] = {}
        if use_semantic and self._model:
            key_vecs = {
                k: self._model.encode(k, convert_to_tensor=True) for k in flat_keys
            }

        dbg("smart_suggester", "START suggest", level=level, keys=len(flat_keys), fuzzy=use_fuzzy, semantic=use_semantic)

        out: Dict[str, List[Tuple[str, int]]] = {}
        for tag in self.canonical:
            tag_aliases  = {a.lower() for a in self.alias_map.get(tag, ())}
            norm_tag     = self._normalize(tag)
            tag_vec      = self._tag_vecs.get(tag)
            ranked: List[Tuple[str, int]] = []

            for k in flat_keys:
                # ---------- matching pipeline ------------
                score = 0
                reason = "—"  # filled for debug

                # ① exact canonical
                if k == tag:
                    score = 120
                    reason = "exact"

                # ② alias exact
                elif k.lower() in tag_aliases:
                    score = 110
                    reason = "alias"
                # ③ sanitised == tag
                elif san_map[k] == tag:
                    score = 105
                    reason = "sanitised"
                else:
                    if not use_fuzzy:
                        continue  # fast tier skips rest
                    # ④ fuzzy token‑sort
                    score = fuzz.token_sort_ratio(norm_map[k], norm_tag)
                    if score < self.fuzzy_threshold:
                        continue
                    reason = f"fuzzy {score}"
                    # ⑤ type hints
                    if use_type_hint:
                        score += self._type_bonus(data, k, tag)
                    # ⑥ frequency memory
                    if use_freq:
                        score += min(self.freq[k], 5) * 5
                    # ⑦ semantic
                    if use_semantic and tag_vec is not None:
                        sim = util.cos_sim(key_vecs[k], tag_vec).item()  # type: ignore
                        if sim >= 0.50:
                            score += 30
                            reason += " +semantic"

                ranked.append((k, int(score)))

            out[tag] = sorted(ranked, key=lambda kv: -kv[1])[:top_n]
        return out

    def register_mapping(self, mapping: Dict[str, Any]) -> None:
        """Feed *accepted* mappings – improves future frequency bonus."""
        for key in mapping.values():
            if isinstance(key, str):
                self.freq[key] += 1

    # ─── helpers ────────────────────────────────────────────────────
    @staticmethod
    def _flatten_json(obj: Any, pref: str = "") -> Iterable[str]:
        if isinstance(obj, dict):
            for k, v in obj.items():
                path = f"{pref}.{k}" if pref else k
                yield from SmartSuggester._flatten_json(v, path)
        else:
            yield pref

    @staticmethod
    def _sanitize(k: str) -> str:
        return re.sub(r"\s+", "_", k.replace(":", "_")).strip()

    _CAMEL_RE = re.compile(r"(?<!^)(?=[A-Z])")

    @classmethod
    def _normalize(cls, s: str) -> str:
        s = cls._CAMEL_RE.sub("_", s).lower()
        return "".join(re.split(r"[_\W]+", s))


    @classmethod
    def _type_bonus(cls, data: Dict[str, Any], key: str, tag: str) -> int:
        cur: Any = data
        for seg in key.split('.'):
            if not isinstance(cur, dict):
                cur = None
                break
            cur = cur.get(seg)
        if cur is None:
            return 0
        if _is_date(cur) and tag.lower().endswith("date"):
            dbg("smart_suggester", "fallback DocumentDate", key)
            return 15
        if isinstance(cur, (int, float)) and any(w in tag.lower() for w in ("amount", "total", "sum")):
            dbg("smart_suggester", "fallback Amount/Total", key)
            return 10
        return 0
