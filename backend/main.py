import uvicorn
from backend.api import app     # noqa: F401  (re-export)
import backend.main as main_mod

def main():
    """
    Entrypoint for both CLI use (python -m backend.main)
    and testhooks.
    """
    uvicorn.run(
        "backend.api:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )


if __name__ == "__main__":
    main()