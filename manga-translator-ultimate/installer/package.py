"""Package the reviewed ZIPs from the source directory and compiled extension."""
from argparse import ArgumentParser
import hashlib
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
parser = ArgumentParser()
parser.add_argument("output", type=Path)
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=True)
dist = root / "extension" / "dist"
if not (dist / "manifest.json").is_file():
    raise SystemExit("Run npm ci and npm run build in extension first.")

def included(file):
    relative = file.relative_to(root)
    if any(part in {"node_modules", "__pycache__", ".pytest_cache", ".git"} for part in relative.parts):
        return False
    if relative.parts[0] == "models" and (file.suffix == ".onnx" or file.name in {"vocab.txt"} or file.suffix == ".part"):
        return False
    return file.is_file()

def archive(path, files, base, prefix=""):
    with ZipFile(path,"w",compression=ZIP_DEFLATED,compresslevel=6) as bundle:
        for file in files:
            bundle.write(file,prefix+file.relative_to(base).as_posix())
    with ZipFile(path) as bundle:
        assert bundle.testzip() is None
        print(path.name, len(bundle.namelist()), "entries", path.stat().st_size, "bytes")

full = output / "manga-translator-ultimate-windows.zip"
ext = output / "manga-translator-ultimate-extension.zip"
archive(full, sorted(file for file in root.rglob("*") if included(file)),root,"manga-translator-ultimate/")
archive(ext, sorted(file for file in dist.rglob("*") if file.is_file()),dist)
(output/"SHA256SUMS.txt").write_text("".join(f"{hashlib.sha256(f.read_bytes()).hexdigest()}  {f.name}\n" for f in (full,ext)),encoding="ascii")
