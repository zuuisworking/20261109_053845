#!/usr/bin/env python3
"""Convert the preserved SIGAP image to PNG without relying on the current cwd."""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Sequence

from PIL import Image


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = PROJECT_ROOT / ".temp" / "sigap" / "Tema_Utama.jfif"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "frontend" / "assets"
DEFAULT_OUTPUT_FILENAME = "bg_landing_page"


class ImageConversionError(RuntimeError):
    """Raised when an image cannot be converted safely."""


def convert_to_png(
    filepath: Path,
    output_filename: str,
    output_dir: Path = DEFAULT_OUTPUT_DIR,
    *,
    overwrite: bool = False,
) -> Path:
    """Convert *filepath* to PNG using a context-managed image handle.

    The destination directory is created when needed. Existing output is
    rejected unless ``overwrite=True`` is explicitly supplied.
    """
    source = Path(filepath).expanduser().resolve()
    destination_dir = Path(output_dir).expanduser().resolve()
    if not source.is_file():
        raise ImageConversionError(f"Input image not found: {source}")

    safe_name = Path(output_filename).name
    if not safe_name or safe_name in {".", ".."}:
        raise ImageConversionError(f"Invalid output filename: {output_filename!r}")
    if safe_name.lower().endswith(".png"):
        safe_name = safe_name[:-4]
    if not safe_name:
        raise ImageConversionError(f"Invalid output filename: {output_filename!r}")

    destination_dir.mkdir(parents=True, exist_ok=True)
    destination = destination_dir / f"{safe_name}.png"
    if destination.exists() and not overwrite:
        raise ImageConversionError(
            f"Refusing to overwrite existing output without --overwrite: {destination}"
        )

    temporary_name: str | None = None
    try:
        with Image.open(source) as image:
            image.load()
            with tempfile.NamedTemporaryFile(
                mode="wb",
                dir=destination_dir,
                prefix=f".{destination.name}.",
                suffix=".tmp",
                delete=False,
            ) as temporary:
                temporary_name = temporary.name
                image.save(temporary, format="PNG")
                temporary.flush()
                os.fsync(temporary.fileno())

        if destination.exists() and not overwrite:
            raise ImageConversionError(
                f"Refusing to overwrite existing output without --overwrite: {destination}"
            )
        os.replace(temporary_name, destination)
        temporary_name = None
        return destination
    finally:
        if temporary_name:
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Convert a preserved image to PNG.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="Source image path.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Destination directory (created when missing).",
    )
    parser.add_argument(
        "--output-filename",
        default=DEFAULT_OUTPUT_FILENAME,
        help="Destination filename without the .png extension.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Explicitly allow replacement of an existing PNG.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        output = convert_to_png(
            args.input,
            args.output_filename,
            args.output_dir,
            overwrite=args.overwrite,
        )
        print(json.dumps({"status": "complete", "output": str(output)}, indent=2))
        return 0
    except (ImageConversionError, OSError, ValueError) as error:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "error": {
                        "type": error.__class__.__name__,
                        "message": str(error),
                    },
                },
                indent=2,
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
