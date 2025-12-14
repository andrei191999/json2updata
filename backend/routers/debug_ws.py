from __future__ import annotations
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from backend.logging_config import dbg
import backend.api_state as state
import backend.logging_config as logcfg
from backend.logging_config import dbg, LAST_LOGS

router = APIRouter(tags=["debug"])

# --- WebSocket Endpoints ---
@router.websocket("/debug/stream")
async def stream_debug_logs(websocket: WebSocket):
    await websocket.accept()
    # Guard: lifespan may not have set the lock yet
    if state.DEBUG_LOCK is None:
        dbg("websocket", "DEBUG_LOCK not initialized yet; closing 1011")
        await websocket.close(code=1011)
        return

    q: asyncio.Queue = asyncio.Queue(maxsize=1000)

    # Register subscriber
    async with state.DEBUG_LOCK:
        state.DEBUG_SUBSCRIBERS.add(q)
    dbg("websocket", f"client joined; total={len(state.DEBUG_SUBSCRIBERS)}")

    try:
        # Send a tiny backlog so UI isn't empty after connect
        for item in list(logcfg.LAST_LOGS)[-50:]:
            await websocket.send_json(item)

        # Forward live log items
        while True:
            item = await q.get()
            await websocket.send_json(item)
            q.task_done()
    except WebSocketDisconnect:
        dbg("websocket", "Debug client disconnected.")
    except Exception as e:
        # If anything else blows up, log and close 1011
        dbg("websocket", f"internal error: {e!r}")
        try:
            await websocket.close(code=1011)
        except Exception:
            pass
    finally:
        # Always unregister
        if state.DEBUG_LOCK is not None:
            async with state.DEBUG_LOCK:
                state.DEBUG_SUBSCRIBERS.discard(q)
        dbg("websocket", f"client removed; total={len(state.DEBUG_SUBSCRIBERS)}")