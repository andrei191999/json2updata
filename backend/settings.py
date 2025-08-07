from functools import lru_cache
from pathlib import Path
from typing import ClassVar
import os

from pydantic_settings import BaseSettings

# 1) define PROJECT_ROOT before using it
PROJECT_ROOT = Path(__file__).resolve().parent.parent

class Settings(BaseSettings):
    PROJECT_ROOT: ClassVar[Path] = PROJECT_ROOT
    # ── Logging toggles ────────────────────────────────────────────
    LOG_LEVEL: str       = "DEBUG"         # root threshold
    LOG_VERBOSE: bool    = False          # enable backend.debug.log?
    LOG_INCLUDE: str     = ""             # comma-list of logger globs to keep
    LOG_EXCLUDE: str     = ""             # comma-list of logger globs to drop
    LOG_JSON: bool       = True           # write logs in JSON format?
    LOG_DIR: Path        = PROJECT_ROOT / "logs"

    # ── File / path constants ──────────────────────────────────────
    SPEC_CSV: Path       = PROJECT_ROOT / "resources" / "updata-2.6.14.csv"
    DEFAULTS_YAML: Path  = PROJECT_ROOT / "resources" / "defaults.yaml"
    INPUT_DIR: Path      = PROJECT_ROOT / "input"
    OUTPUT_DIR: Path     = PROJECT_ROOT / "output"
    PDF_STORAGE_DIR: Path = PROJECT_ROOT / "pdf_storage"
    PDF_CACHE_DIR: Path   = PDF_STORAGE_DIR / "pdf_cache"
    PDF_WORK_DIR: Path    = PDF_STORAGE_DIR / "pdf_hard_links"

    # ── Performance / batching ────────────────────────────────────
    CPU_CORES: int       = os.cpu_count() or 4
    MAX_PARALLEL: int    = min(8, (os.cpu_count() or 4) * 2)
    CHUNK_SIZE: int      = 250

    # ── Runtime progress state ────────────────────────────────────
    # These are mutated at runtime; they cannot be BaseSettings fields.
    # Instead, we’ll store them on the module level if needed.

    class Config:
        env_file = ".env"  # load overrides automatically

@lru_cache
def get_settings() -> Settings:
    s = Settings()
    # ensure the log directory exists
    s.LOG_DIR.mkdir(parents=True, exist_ok=True)
    # also ensure our input/output/pdf dirs exist
    for d in (
        s.INPUT_DIR,
        s.OUTPUT_DIR,
        s.PDF_STORAGE_DIR,
        s.PDF_CACHE_DIR,
        s.PDF_WORK_DIR,
    ):
        d.mkdir(parents=True, exist_ok=True)
    return s
