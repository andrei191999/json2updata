import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from backend.logging_config import dbg
from backend.api_state import PROGRESS, PROGRESS_TOTAL, check_if_cancelled

router = APIRouter(tags=["progress"])

@router.websocket("/stream/{pid}")
async def stream_progress(ws: WebSocket, pid: str):
    await ws.accept()
    dbg("progress", f"client connected pid={pid}")
    cancel_key = f"cancel:{pid}" # ✅ Define the Redis key

    try:
        last = -1
        while True:
            await asyncio.sleep(0.25)

            # ✅ FIX: Check for the cancellation key in Redis
            # This ensures the progress stream stops immediately on cancel.
            if check_if_cancelled(pid):
                dbg("progress", f"cancel detected for pid={pid}, closing websocket")
                await ws.close()
                break

            done, total = PROGRESS.get(pid, 0), PROGRESS_TOTAL.get(pid, 1)
            if done != last:
                await ws.send_json({"done": done, "total": total})
                last = done

            # The job is finished, so we can close the connection.
            if done >= total:
                await ws.close()
                break
    except WebSocketDisconnect:
        dbg("progress", f"client disconnected pid={pid}")