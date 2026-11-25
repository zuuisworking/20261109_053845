"""
Archive.py
"""

from datetime import datetime
from pathlib import Path
import zipfile

EXCLUDE_PATTERN = [
    ".git",
	".gitignore",
	".temp",
 	"__pycache__",
    "database",
    "logs",
    "node_modules",
    "storage",
]


def is_excluded(path: Path, root: Path, patterns: list[str], output_path: Path) -> bool:
    if path.resolve() == output_path.resolve():
        return True
    rel_parts = path.relative_to(root).parts
    return any(part in patterns or path.name in patterns for part in rel_parts)


def get_targets(root: Path, output_path: Path) -> list[Path]:
    return sorted(
        p
        for p in root.rglob("*")
        if p.is_file() and not is_excluded(p, root, EXCLUDE_PATTERN, output_path)
    )


def create_archive(root: Path, output_path: Path) -> int:
    targets = get_targets(root, output_path)
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for target in targets:
            arcname = target.relative_to(root).as_posix()
            zf.write(target, arcname=arcname)
    return len(targets)


def main() -> None:
    root = Path.cwd()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = root / 'out' / f"{root.name}_{timestamp}.zip"

    total = create_archive(root, output_path)
    print(f"Successfully Archiving {total} file into: {output_path.name}")


if __name__ == "__main__":
    main()