# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**json2updata** is a JSON-to-XML converter that transforms CMIS-exported JSON files into Updata 2.6.14 XML packages. It provides both a CLI for single files and an interactive web UI for batch processing with visual mapping feedback.

Key features:
- JSON → Updata XML conversion with fuzzy-matching tag suggestions
- Interactive mapping editor with override support
- Batch processing with parallel workers
- PDF pairing and packaging
- Real-time progress tracking and debug logging

## Quick Commands

### Frontend (React/TypeScript + Vite)
```bash
cd frontend
npm install                    # Install dependencies
npm run dev                    # Start dev server (localhost:5173)
npm run build                  # Build production bundle
npm run lint                   # Run ESLint
```

### Backend (Python FastAPI)
```bash
pip install -e .[dev]          # Install with dev dependencies
python -m backend              # Run API server (localhost:8000)
python -m pytest               # Run tests with coverage
python -m pytest -k test_name  # Run specific test
python -m black .              # Format code
python -m ruff check .         # Lint code
```

### Typical Development Workflow
1. Start backend: `python -m backend` (API at http://localhost:8000)
2. In another terminal, start frontend: `cd frontend && npm run dev` (UI at http://localhost:5173)
3. Frontend proxies API calls to `http://localhost:8000/api`

## Architecture Overview

### Frontend (React + TypeScript, in `frontend/src/`)
A single-page app for interactive batch processing with these key layers:

**Top-level state** (`App.tsx`):
- Currently loaded JSON object
- Mapping overrides cache (per-file)
- Selected files for batch processing
- Current view (mapping table / summary)

**UI components** (`components/`):
- `FilePane.tsx` - File list with checkboxes, batch controls
- `MappingTable.tsx` - Editable data grid of tag mappings (uses MUI DataGrid)
- `PreviewPane.tsx` - Live XML preview
- `DebugConsole.tsx` - Real-time backend log viewer
- `SummaryTab.tsx` - Batch results summary

**Data flow** (`utils/`):
1. `buildRows.ts` - Merges backend suggestions + user overrides → `MappingRow[]`
2. `applyMapping.ts` - Converts `MappingRow[]` to final `{ [tag]: value }` object
3. `batchTransform.ts` - Orchestrates batch: reads files locally, applies mappings, manages progress

**Key hooks** (`hooks/`):
- `useMappingCache.ts` - Manages override cache per file
- `useMandatory.ts` - Loads spec and tag requirements from backend
- `useCategoryFilter.ts` - Filters table by category (M/C/O)
- `useLocalStorageState.ts` - Persists user preferences

**Communication**:
- REST API via Axios: `/api/map`, `/api/build`, `/api/batch_build`, `/api/spec`
- WebSocket: `/api/stream/{pid}` for progress, `/api/debug/stream` for logs

### Backend (FastAPI, in `backend/`)
A worker-based async API for mapping and XML generation.

**Core pipeline modules**:
- `mapper.py` - Fuzzy matching + semantic similarity for tag suggestion
- `smart_suggester.py` - Combines 7 ranking signals (exact, fuzzy, semantic, types, frequency, etc.)
- `spec_parser.py` - Loads Updata tag spec (500+ tags) from CSV
- `xml_builder.py` - Validates and builds XML, enforces element ordering
- `sanitizer.py` - Cleans CMIS JSON keys
- `date_utils.py` - Detects and converts date formats
- `packager.py` - Packages XML + PDF into zips

**API layer** (`routers/`):
- `mapping.py` - `/map`, `/build`, `/batch_build`, `/spec` endpoints
- `files.py` - `/files`, `/upload` for file I/O
- `pdfs.py` - PDF storage/retrieval
- `progress_ws.py` - WebSocket at `/stream/{pid}` for batch progress
- `debug_ws.py` - WebSocket at `/debug/stream` for live logs

**Infrastructure**:
- `app.py` - FastAPI app setup, CORS, router registration
- `api_state.py` - In-memory state for progress tracking (keyed by process ID)
- `logging_config.py` - Structured logging with WebSocket subscriber pattern
- `settings.py` - Configuration (spec paths, XSD path, defaults)
- `utils/workers.py` - ThreadPoolExecutor workers for parallel file processing
- `uvicorn_log.json` - Uvicorn log configuration

**Processing flow** (from `utils/workers.py`):
```
build_one(json_content, overrides):
  1. mapper.map_json(json) → suggestions
  2. Apply template overrides + file-specific overrides
  3. build_updata_xml() → bytes
  4. validate_xml() → valid/invalid folder
  5. Link/copy PDF if present
  6. Package to zip if requested
  7. Return result
```

### Data Flow: Single File to Batch
1. **User loads JSON file** → Frontend reads via File System Access API (local)
2. **Maps displayed** → `POST /api/map` → Backend suggests Updata tags
3. **User edits overrides** → Cached in `useMappingCache`
4. **Live preview** → `POST /api/build` with mapped object → XML rendered
5. **Batch process** → `POST /api/batch_build` with:
   - File list + file paths (read locally by frontend)
   - Overrides (template + per-file)
   - Pre-calculated mappings (from frontend to save backend time)
6. **Progress tracked** → WebSocket `/stream/{pid}` updates progress bar
7. **Results collected** → Summary tab shows success/failure per file

### Key Architectural Decisions

**Client-heavy design**:
- Frontend reads JSON files locally (no upload initially)
- Frontend pre-calculates mappings before batch (reduces server load)
- Web Workers hash PDFs in parallel

**Backend as bulk processor**:
- Focused on `/batch_build` with ThreadPoolExecutor (8 workers)
- Chunks processing, streams progress via WebSocket
- In-memory state for progress (no persistent DB)

**Logging as a feature**:
- `logging_config.py` implements subscriber pattern
- All logs streamed to frontend via WebSocket for real-time visibility
- Helps users debug mapping issues on their files

## Important Implementation Details

### Mapping System
- **Smart Suggester**: Combines exact match + fuzzy (Levenshtein) + semantic (sentence-transformers) + type hints + frequency memory
- **Suggestion Levels**: `fast` (fuzzy only), `normal` (fuzzy + semantic), `deep` (+ frequency)
- **Overrides**: User can pick any tag or hardcode values; cached per file
- **Categories**: M (mandatory), C (conditional), O (optional), guessed, parent-*

### XML Validation
- Spec CSV defines: tag name, order, mandatory/conditional status, parent relationships, aliases
- XSD file (`backend/resources/*.xsd`) validates final XML structure
- Invalid XMLs written to `output/invalid/` for manual review

### Batch Processing
- **Chunking**: Files processed in chunks (configurable, default 10)
- **Parallelism**: ThreadPoolExecutor with 8 workers (see `settings.py`)
- **Progress**: Stored in `api_state.py` keyed by process ID, updated per chunk
- **Cancellation**: User can cancel via `/api/cancel/{pid}`

### Type System (Frontend)
Key types in `frontend/src/types/mapping.ts`:
- `MappingRow` - UI representation (tag, jsonKey, value, include, category, suggestions)
- `Override` - What user changed (jsonKey, value, include, transform chain)
- `Category` - Row classification (required, conditional, optional, etc.)

### Performance Notes
- **Frontend**: MUI DataGrid with virtual scrolling for large file lists
- **Backend**: ThreadPoolExecutor + chunking for parallel processing
- **PDF hashing**: Web Worker to avoid blocking main thread
- **Caching**: User mappings cached in localStorage; spec cached in React state

## Common Development Tasks

### Adding a New API Endpoint
1. Create handler in appropriate router file (`routers/*.py`)
2. Use dependency injection for state (e.g., `Depends(get_settings)`)
3. Register in `app.py` via `app.include_router()`
4. Update frontend Axios client if needed

### Modifying the Mapping Algorithm
1. Edit `backend/smart_suggester.py` (logic) or `backend/mapper.py` (entry point)
2. Test with `pytest tests/` (if tests exist)
3. Adjust weights in `smart_suggester.py` to balance signal importance
4. Frontend suggestion levels (`fast/normal/deep`) are controlled by `level` query param to `/map`

### Adding UI Components
1. Create in `frontend/src/components/`
2. Use MUI components from `@mui/material`
3. Import and include in `App.tsx` or another parent
4. Export types in `frontend/src/types/` if needed

### Debugging Backend Processing
1. Enable debug console in UI (toggle in FilePane)
2. Monitor `/api/debug/stream` WebSocket in browser DevTools
3. All logs appear in real-time in DebugConsole
4. For batch issues, check `output/invalid/` for failed XMLs

## File Structure (Partial, High-Level)
```
.
├── backend/                         # Python FastAPI backend
│   ├── __main__.py                  # CLI entry point
│   ├── app.py                       # FastAPI app setup
│   ├── mapper.py                    # Tag suggestion engine
│   ├── smart_suggester.py           # Multi-signal ranking
│   ├── spec_parser.py               # Loads Updata spec
│   ├── xml_builder.py               # XML generation + validation
│   ├── sanitizer.py, date_utils.py  # Data cleaning
│   ├── packager.py                  # ZIP creation
│   ├── routers/
│   │   ├── mapping.py               # /map, /build, /batch_build
│   │   ├── files.py                 # /files, /upload
│   │   ├── progress_ws.py           # /stream/{pid}
│   │   └── debug_ws.py              # /debug/stream
│   ├── utils/
│   │   └── workers.py               # ThreadPoolExecutor workers
│   ├── resources/                   # CSV spec, XSD schema
│   ├── logging_config.py            # Structured logging
│   ├── settings.py                  # Configuration
│   └── requirements.txt
│
├── frontend/                        # React + TypeScript + Vite
│   ├── src/
│   │   ├── App.tsx                  # Main container
│   │   ├── components/              # UI components
│   │   ├── utils/                   # buildRows, applyMapping, batchTransform
│   │   ├── hooks/                   # useMappingCache, useMandatory, etc.
│   │   ├── types/                   # TypeScript definitions
│   │   ├── workers/                 # hashGzipWorker.ts
│   │   ├── main.tsx, index.css      # Entry point
│   │   └── api.ts                   # Axios instance
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── eslint.config.js
│
├── input/, output/, pdf_storage/    # Working directories (created at runtime)
├── pyproject.toml                   # Python project metadata
├── CLAUDE.md                        # This file
└── README.md
```

## Dependency Notes
- **Backend**: FastAPI, Uvicorn, lxml (XML), rapidfuzz (fuzzy matching), sentence-transformers (semantic similarity), pydantic (validation)
- **Frontend**: React 19, MUI 7, Vite, TypeScript, Axios

## Git Workflow
Current branch: `debug_rework` (likely working on batch processing improvements)
Main branch for PRs: (check origin/main)

## Troubleshooting

**Backend won't start**: Check `settings.py` paths for spec CSV and XSD. Ensure `backend/resources/` exists and contains required files.

**Frontend can't reach backend**: Verify backend is running on `localhost:8000` and frontend is accessing `/api` (proxied in Vite config).

**Batch processing hangs**: Check `/debug/stream` WebSocket for stuck workers. May need to adjust `max_workers` or chunk size in `settings.py`.

**Mapping suggestions are poor**: Adjust weights in `smart_suggester.py` or try `level=deep` for semantic similarity. Consider adding frequency data if available.
