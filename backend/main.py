import asyncio
import uvicorn
from backend.app import app, DEBUG_SUBSCRIBERS    # noqa: F401  (re-export)
import backend.main as main_mod
from backend.logging_config import set_event_loop, dbg
from backend.settings       import get_settings

settings = get_settings()
loop = asyncio.get_running_loop()
set_event_loop(loop)
setattr(loop, "_debug_subscribers", DEBUG_SUBSCRIBERS)

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