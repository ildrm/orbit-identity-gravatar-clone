"""Extract the pinned official WordPress fixture into its bounded test directory."""
import stat
import zipfile
from pathlib import Path

root = Path("reports/wordpress/runtime").resolve()
root.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile("reports/wordpress/core.zip") as archive:
    entries = archive.infolist()
    if len(entries) > 20_000 or sum(entry.file_size for entry in entries) > 500_000_000:
        raise ValueError("WordPress fixture archive exceeds its limits")
    for entry in entries:
        target = (root / entry.filename).resolve()
        if not target.is_relative_to(root) or not entry.filename.startswith("wordpress/"):
            raise ValueError("Unexpected WordPress archive path")
        if stat.S_ISLNK(entry.external_attr >> 16):
            raise ValueError("WordPress fixture cannot contain symbolic links")
    archive.extractall(root)
print("Official WordPress fixture extracted with path and size validation.")
