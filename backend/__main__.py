import json
import argparse, pathlib
from backend.mapper import Mapper
from backend.xml_builder import build_updata_xml, validate_xml
from backend.settings import get_settings

settings = get_settings()

def _safe_print(*parts, **kwargs):
    """
    Print but fall back to ASCII if the console can't encode Unicode symbols.
    """
    try:
        print(*parts, **kwargs)
    except UnicodeEncodeError:
        cleaned = [str(p).encode("ascii", "replace").decode("ascii")
                   for p in parts]
        print(*cleaned, **kwargs)

def main(argv=None):
    parser = argparse.ArgumentParser(prog="json2updata")
    parser.add_argument("json", type=pathlib.Path)
    parser.add_argument("--out", type=pathlib.Path, default=pathlib.Path.cwd())
    args = parser.parse_args(argv)

    mapper = Mapper(settings.SPEC_CSV, settings.DEFAULTS_YAML)
    data   = args.json.read_text(encoding="utf-8")
    mapped, *_ = mapper.map_json(json.loads(data))
    xml_bytes  = build_updata_xml(mapped)
    validate_xml(xml_bytes)              # raises if invalid
    out_path = args.out / (args.json.stem + ".xml")
    out_path.write_bytes(xml_bytes)
    _safe_print("OK wrote", out_path)

if __name__ == "__main__":
    main()
