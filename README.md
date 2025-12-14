# File Converter Service

A flexible, full-stack file conversion platform with interactive batch processing, visual mapping feedback, and schema-based validation.

## Overview

This is a general-purpose file conversion tool that transforms structured data between formats. It supports:

- **JSON to XML** conversion with custom schema support
- **Interactive mapping editor** - Visually map source fields to target schema
- **Batch processing** - Convert multiple files in parallel with real-time progress
- **Schema validation** - Validate output against XSD, JSON Schema, or custom rules
- **PDF/file pairing** - Automatically pair converted files with supporting documents
- **Live preview** - See converted output in real-time as you adjust mappings
- **Debug console** - Stream processing logs for real-time debugging
- **Custom schemas** - Upload your own schema definitions (CSV, XSD, JSON Schema)

## Quick Start

### Prerequisites

- Python 3.9+
- Node.js 18+
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/andrei191999/json2updata.git
cd json2updata

# Backend setup
pip install -e .[dev]        # Install with dev dependencies

# Frontend setup
cd frontend
npm install
cd ..
```

### Running Locally

**Terminal 1 - Backend (FastAPI + Uvicorn)**
```bash
python -m backend
# API runs at http://localhost:8000
# Docs at http://localhost:8000/docs
```

**Terminal 2 - Frontend (React + Vite)**
```bash
cd frontend
npm run dev
# UI runs at http://localhost:5173
```

Open http://localhost:5173 in your browser. The frontend proxies API calls to `http://localhost:8000/api`.

### CLI Usage (Single File)

```bash
# Convert a single file
json2updata input.json --out /path/to/output --schema /path/to/schema.xsd
```

The CLI will:
1. Load the source file
2. Map fields to target schema
3. Generate output file
4. Validate against schema
5. Write to output directory

## Architecture

### Backend (Python FastAPI)

**Core Processing Pipeline**
- `mapper.py` - Field suggestion engine with fuzzy matching and semantic similarity
- `smart_suggester.py` - Multi-signal ranking (exact match, fuzzy, semantic, type hints, frequency)
- `spec_parser.py` - Loads schema definitions (CSV, XSD, JSON Schema)
- `xml_builder.py` - Converts mapped data to output format with validation
- `sanitizer.py` - Cleans and normalizes input data
- `date_utils.py` - Date format detection and standardization
- `packager.py` - Creates archives for bulk outputs

**API Layer** (`backend/routers/`)
- `mapping.py` - `/map` (field suggestions), `/build` (convert), `/batch_build` (bulk), `/spec` (load schema)
- `files.py` - `/files` (list), `/upload` (upload)
- `pdfs.py` - File storage and retrieval
- `progress_ws.py` - WebSocket for batch progress (`/stream/{pid}`)
- `debug_ws.py` - WebSocket for live logs (`/debug/stream`)

**Infrastructure**
- `app.py` - FastAPI setup with middleware
- `api_state.py` - In-memory state for progress tracking
- `logging_config.py` - Structured logging with WebSocket streaming
- `settings.py` - Configuration (paths, performance tuning)
- `utils/workers.py` - ThreadPoolExecutor for parallel processing

### Frontend (React + TypeScript)

**Components** (`frontend/src/components/`)
- `FilePane.tsx` - File selection and batch controls
- `MappingTable.tsx` - Visual mapping editor (MUI DataGrid)
- `PreviewPane.tsx` - Live output preview
- `DebugConsole.tsx` - Real-time log viewer
- `SummaryTab.tsx` - Batch results

**Utilities** (`frontend/src/utils/`)
- `buildRows.ts` - Merges backend suggestions with user overrides
- `applyMapping.ts` - Converts UI mappings to conversion object
- `batchTransform.ts` - Orchestrates batch processing

**Hooks** (`frontend/src/hooks/`)
- `useMappingCache.ts` - Manages per-file mapping overrides
- `useMandatory.ts` - Loads schema from backend
- `useCategoryFilter.ts` - Filters fields by category
- `useLocalStorageState.ts` - Persists preferences

## Data Flow

### Single File / Preview
```
User loads source file (local read via File System Access API)
    ↓
POST /api/map with file content
    ↓
Backend suggests field mappings based on schema
    ↓
Frontend merges suggestions with user overrides
    ↓
User adjusts mappings (cached in browser)
    ↓
POST /api/build with mapped object
    ↓
Output preview rendered
```

### Batch Processing
```
User selects files and conversion settings
    ↓
Frontend processes files locally (hashing, preprocessing)
    ↓
POST /api/batch_build with file list + mappings
    ↓
Backend processes in parallel (ThreadPoolExecutor)
    ↓
Progress streamed via WebSocket /stream/{pid}
    ↓
Results collected and displayed
```

## Configuration

Backend settings in `backend/settings.py`:

```python
SPEC_PATH = Path("resources/schema.csv")          # Schema definition
XSD_PATH = Path("resources/output-schema.xsd")    # Output validation
MAX_WORKERS = 8                                    # Parallel workers
CHUNK_SIZE = 10                                    # Files per chunk
```

Frontend proxy configuration in `frontend/vite.config.ts`:

```typescript
proxy: {
  "/api": {
    target: "http://localhost:8000",
    changeOrigin: true,
    rewrite: path => path.replace(/^\/api/, "")
  }
}
```

## Development

### Testing

```bash
python -m pytest                    # Run all tests
python -m pytest -k test_name       # Run specific test
python -m pytest --cov              # With coverage
```

### Code Quality

```bash
python -m black .                   # Format Python code
python -m ruff check .              # Lint Python
cd frontend && npm run lint         # Lint TypeScript
```

### Building for Production

**Frontend**
```bash
cd frontend
npm run build  # Creates optimized dist/ bundle
```

**Backend**
```bash
pip install .  # Install as package
```

## Project Structure

```
.
├── backend/                    # Python FastAPI service
│   ├── __main__.py            # CLI entry point
│   ├── app.py                 # FastAPI setup
│   ├── mapper.py              # Field suggestion
│   ├── smart_suggester.py     # Ranking algorithm
│   ├── spec_parser.py         # Schema parser
│   ├── xml_builder.py         # Output generation
│   ├── sanitizer.py           # Input cleaning
│   ├── packager.py            # Archive creation
│   ├── routers/               # API endpoints
│   │   ├── mapping.py         # /map, /build
│   │   ├── files.py           # /files, /upload
│   │   ├── progress_ws.py     # /stream/{pid}
│   │   └── debug_ws.py        # /debug/stream
│   ├── utils/
│   │   └── workers.py         # Worker pool
│   ├── resources/             # Default schemas
│   ├── logging_config.py
│   └── settings.py
│
├── frontend/                  # React + TypeScript UI
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── utils/
│   │   ├── types/
│   │   └── workers/
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
│
├── input/                     # Working directory
├── output/                    # Working directory
├── resources/                 # Schema files
├── pyproject.toml
├── CLAUDE.md                  # Developer guide
└── README.md
```

## API Endpoints

### Conversion
- `POST /api/map` - Get field mapping suggestions for source file
- `POST /api/build` - Convert with provided mappings, return output
- `POST /api/batch_build` - Batch convert multiple files
- `GET /api/spec` - Load schema definition

### File Operations
- `GET /api/files?dir=input` - List files
- `GET /api/files/{fname}?dir=input` - Read file
- `POST /api/upload` - Upload file
- `POST /api/import_init` - Initialize directory

### Progress & Logging
- `WS /api/stream/{pid}` - Progress updates (done/total)
- `WS /api/debug/stream` - Real-time processing logs
- `POST /api/cancel/{pid}` - Cancel batch job

## Using Your Own Schema

1. **CSV Schema Format**
   ```csv
   field_name,order,required,type
   field_one,1,yes,string
   field_two,2,no,date
   ```

2. **XSD Schema Format**
   - Place `.xsd` file in `resources/`
   - Update `XSD_PATH` in `settings.py`

3. **Upload Schemas**
   - Use the API to upload custom schemas
   - Backend validates output against provided schema

## Troubleshooting

**Backend won't start**
- Check that schema files exist in `resources/`
- Verify Python 3.9+ is installed
- Check port 8000 is available

**Frontend can't reach backend**
- Ensure backend is running on `http://localhost:8000`
- Verify Vite proxy config in `vite.config.ts`

**Batch processing issues**
- Check debug console for detailed logs
- Verify input file format matches expectations
- Try reducing `MAX_WORKERS` if running out of memory

**Mapping suggestions are poor**
- Try different suggestion levels (`fast`, `normal`, `deep`)
- Ensure schema definition is correct
- Add custom mappings to improve accuracy

## Security Note

This tool processes files locally and on the server. When publishing:
- Ensure no sensitive schemas or proprietary format definitions are committed
- Use `.gitignore` to exclude working directories, logs, and sample data
- Review schema files for company-specific information before sharing
- Consider keeping internal schemas in a separate, private repository

## Dependencies

### Backend
- FastAPI - Web framework
- Uvicorn - ASGI server
- lxml - XML processing
- rapidfuzz - Fuzzy string matching
- sentence-transformers - Semantic similarity
- pydantic - Data validation
- python-dateutil - Date parsing

### Frontend
- React 19
- MUI 7 - Component library
- Vite - Build tool
- TypeScript
- Axios - HTTP client
