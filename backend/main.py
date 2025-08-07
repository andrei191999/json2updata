import uvicorn
from backend.api import app     # noqa: F401  (re-export)
import backend.main as main_mod
from backend.logging_config import dbg
from backend.settings       import get_settings
import asyncio

settings = get_settings()


def main():
    """
    Entrypoint for both CLI use (python -m backend.main)
    and testhooks.
    """
    dbg("main", "Starting server", host="0.0.0.0", port=8000, reload=True)
    uvicorn.run(
        "backend.api:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )


if __name__ == "__main__":
    dbg("main", "Server shutdown")
    main()