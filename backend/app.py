# backend/app.py
from __future__ import annotations
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.logging_config import setup_logging, set_event_loop, dbg
from backend.api_state import DEBUG_SUBSCRIBERS

# 1) logging first
setup_logging()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 2) capture event loop for logging + expose subscriber set
    loop = asyncio.get_running_loop()
    set_event_loop(loop)
    setattr(loop, "_debug_subscribers", DEBUG_SUBSCRIBERS)

    # 3) create the debug lock ONCE
    import backend.api_state as state
    state.DEBUG_LOCK = asyncio.Lock()

    dbg("boot", "startup")
    yield
    dbg("boot", "shutdown")

app = FastAPI(title="json2updata", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 4) include routers
from backend.routers.files import router as files_router
from backend.routers.pdfs import router as pdfs_router
from backend.routers.mapping import router as mapping_router
from backend.routers.progress_ws import router as progress_router
from backend.routers.debug_ws import router as debug_router

# mount routers under /api
app.include_router(files_router,    prefix="/api")
app.include_router(pdfs_router,     prefix="/api")
app.include_router(mapping_router,  prefix="/api")
app.include_router(progress_router, prefix="/api")
app.include_router(debug_router,    prefix="/api")
