#!/usr/bin/env python3
"""Normalize the preserved SIGAP CSV data without mutating the source files.

The module intentionally uses only the Python standard library. In particular,
CSV values are never passed through pandas/numpy inference, so 12-digit
customer IDs and power text remain strings.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Iterable, Sequence


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_DIR = PROJECT_ROOT / ".temp" / "sigap"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "data"
PROTECTED_TEMP_DIR = PROJECT_ROOT / ".temp"

TRAFO_SOURCE_NAME = "Manajemen Trafo (SupaBase).csv"
CUSTOMER_SOURCE_NAME = "Data Pelanggan (SupaBase).csv"
TRAFO_SCHEMA = ("nama_trafo", "penyulang", "kapasitas", "titik_koordinat")
CUSTOMER_SCHEMA = ("id_pelanggan", "nama", "tarif", "daya", "alamat")
EXPECTED_TRAFO_ROWS = 1238
EXPECTED_CUSTOMER_ROWS = 68742

CUSTOMER_ID_PATTERN = re.compile(r"^\d{12}$")
POWER_PATTERN = re.compile(r"^\d+(?:\.\d{3})*$")
POINT_PATTERN = re.compile(
    r"^POINT\s*\(\s*([-+]?\d+(?:\.\d+)?)\s+([-+]?\d+(?:\.\d+)?)\s*\)$",
    re.IGNORECASE,
)

# Coordinates copied from the preserved transformer source. These are local
# fixture checks only; they neither read nor write production data.
REAL_POINT_FIXTURES = (
    ("POINT (98.666586 3.666219)", ("98.666586", "3.666219")),
    ("POINT (98.675804 3.65562)", ("98.675804", "3.65562")),
    ("POINT (98.707312 3.656766)", ("98.707312", "3.656766")),
)


class NormalizationError(RuntimeError):
    """Raised for a source or output validation failure."""


def is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_text_with_fallback(path: Path) -> tuple[str, str]:
    """Decode UTF-8 (including BOM) when valid, otherwise CP1252."""
    raw = path.read_bytes()
    try:
        return raw.decode("utf-8-sig"), "utf-8"
    except UnicodeDecodeError as utf8_error:
        try:
            return raw.decode("cp1252"), "cp1252"
        except UnicodeDecodeError as cp1252_error:
            raise NormalizationError(
                f"{path} is neither valid UTF-8 nor decodable as CP1252: {cp1252_error}"
            ) from utf8_error


def read_semicolon_csv(
    path: Path,
    expected_schema: Sequence[str],
    expected_rows: int | None = None,
) -> tuple[list[tuple[int, list[str]]], str]:
    """Read and strictly validate a semicolon-delimited CSV file."""
    if not path.exists() or not path.is_file():
        raise NormalizationError(f"Source file not found: {path}")

    text, encoding = read_text_with_fallback(path)
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=";", strict=True)
    try:
        header = next(reader)
    except StopIteration as exc:
        raise NormalizationError(f"Source CSV is empty: {path}") from exc

    if tuple(header) != tuple(expected_schema):
        raise NormalizationError(
            f"Schema mismatch for {path}: expected {';'.join(expected_schema)}, "
            f"received {';'.join(header)}"
        )

    rows: list[tuple[int, list[str]]] = []
    try:
        for row in reader:
            line_number = reader.line_num
            if not row or all(value == "" for value in row):
                continue
            if len(row) != len(expected_schema):
                raise NormalizationError(
                    f"Column count mismatch in {path} at line {line_number}: "
                    f"expected {len(expected_schema)}, received {len(row)}"
                )
            rows.append((line_number, row))
    except csv.Error as error:
        raise NormalizationError(f"CSV parse failed for {path}: {error}") from error

    if expected_rows is not None and len(rows) != expected_rows:
        raise NormalizationError(
            f"Row count mismatch for {path}: expected {expected_rows}, received {len(rows)}"
        )
    return rows, encoding


def parse_point(coord: object) -> tuple[str | None, str | None]:
    """Parse strict WKT POINT(longitude latitude), without swapping axes."""
    if coord is None:
        return None, None
    match = POINT_PATTERN.fullmatch(str(coord).strip())
    if not match:
        return None, None

    longitude_text, latitude_text = match.groups()
    longitude = float(longitude_text)
    latitude = float(latitude_text)
    if not (-180.0 <= longitude <= 180.0) or not (-90.0 <= latitude <= 90.0):
        return None, None
    return longitude_text, latitude_text


def parse_power_va(power_text: str) -> str:
    """Remove Indonesian thousands separators and keep the result as a string."""
    if not POWER_PATTERN.fullmatch(power_text):
        raise NormalizationError(
            f"Invalid power value {power_text!r}; expected digits with optional "
            "three-digit Indonesian thousands groups"
        )
    value = power_text.replace(".", "")
    if not value.isdigit():
        raise NormalizationError(f"Invalid power value {power_text!r}")
    return value


def run_coordinate_fixture_checks() -> None:
    for coordinate, expected in REAL_POINT_FIXTURES:
        actual = parse_point(coordinate)
        if actual != expected:
            raise NormalizationError(
                f"Coordinate fixture failed: {coordinate!r} expected {expected!r}, got {actual!r}"
            )

    invalid_fixtures = (
        "POINT (98.675804, 3.65562)",
        "POINT (3.65562 98.675804)",
        "POINT (98.675804)",
        "98.675804 3.65562",
    )
    for coordinate in invalid_fixtures:
        if parse_point(coordinate) != (None, None):
            raise NormalizationError(f"Invalid coordinate fixture was accepted: {coordinate!r}")


def normalize_trafo_rows(source_path: Path, canonical: bool) -> tuple[list[dict[str, str]], str]:
    rows, encoding = read_semicolon_csv(
        source_path,
        TRAFO_SCHEMA,
        EXPECTED_TRAFO_ROWS if canonical else None,
    )
    names: set[str] = set()
    normalized: list[dict[str, str]] = []

    for line_number, row in rows:
        name, feeder, capacity, raw_coordinate = row
        name = name.strip()
        feeder = feeder.strip()
        capacity = capacity.strip()
        if not name:
            raise NormalizationError(f"Empty transformer name at {source_path}:{line_number}")
        name_key = name.casefold()
        if name_key in names:
            raise NormalizationError(
                f"Duplicate transformer name {name!r} at {source_path}:{line_number}"
            )
        names.add(name_key)

        longitude, latitude = parse_point(raw_coordinate)
        if longitude is None or latitude is None:
            raise NormalizationError(
                f"Invalid strict lon-lat WKT at {source_path}:{line_number}: {raw_coordinate!r}"
            )
        normalized.append(
            {
                "name": name,
                "feeder": feeder,
                "capacity": capacity,
                "longitude": longitude,
                "latitude": latitude,
            }
        )

    return normalized, encoding


def normalize_customer_rows(source_path: Path, canonical: bool) -> tuple[list[dict[str, str]], str]:
    rows, encoding = read_semicolon_csv(
        source_path,
        CUSTOMER_SCHEMA,
        EXPECTED_CUSTOMER_ROWS if canonical else None,
    )
    customer_ids: set[str] = set()
    normalized: list[dict[str, str]] = []

    for line_number, row in rows:
        customer_id, name, fare, power_text, address = row
        if not CUSTOMER_ID_PATTERN.fullmatch(customer_id):
            raise NormalizationError(
                f"Customer ID must be exactly 12 digits at {source_path}:{line_number}: "
                f"{customer_id!r}"
            )
        if customer_id in customer_ids:
            raise NormalizationError(
                f"Duplicate customer ID {customer_id!r} at {source_path}:{line_number}"
            )
        customer_ids.add(customer_id)

        power_va = parse_power_va(power_text)
        normalized.append(
            {
                "customer_id": customer_id,
                "name": name.strip(),
                "fare": fare.strip(),
                # Keep the source text and provide the normalized VA value as a
                # separate string. No numeric coercion or float conversion is used.
                "power": power_text,
                "power_va": power_va,
                "address": address,
            }
        )

    return normalized, encoding


def render_csv(rows: Iterable[dict[str, str]], fieldnames: Sequence[str]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(
        output,
        fieldnames=fieldnames,
        delimiter=";",
        lineterminator="\n",
        quoting=csv.QUOTE_MINIMAL,
        extrasaction="raise",
    )
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def write_output_atomically(output_path: Path, content: bytes, force: bool) -> str:
    """Write output atomically; never silently replace different content."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        if output_path.read_bytes() == content:
            return "unchanged"
        if not force:
            raise NormalizationError(
                f"Refusing to overwrite existing output without --force: {output_path}"
            )

    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=output_path.parent,
            prefix=f".{output_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_name = temporary.name
            temporary.write(content)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_name, output_path)
        temporary_name = None
        return "written"
    finally:
        if temporary_name:
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass


def ensure_output_location(output_dir: Path, source_dir: Path) -> Path:
    resolved = output_dir.expanduser().resolve()
    if is_relative_to(resolved, PROTECTED_TEMP_DIR):
        raise NormalizationError(f"Output directory may not be inside .temp: {resolved}")
    if is_relative_to(resolved, source_dir.resolve()):
        raise NormalizationError(f"Output directory may not be inside the source directory: {resolved}")
    return resolved


def normalize_trafo_managements(
    source_path: Path = DEFAULT_SOURCE_DIR / TRAFO_SOURCE_NAME,
    output_path: Path = DEFAULT_OUTPUT_DIR / "trafo_managements.csv",
    *,
    force: bool = False,
) -> Path:
    source_path = source_path.expanduser().resolve()
    output_path = output_path.expanduser().resolve()
    canonical = source_path == (DEFAULT_SOURCE_DIR / TRAFO_SOURCE_NAME).resolve()
    rows, _encoding = normalize_trafo_rows(source_path, canonical)
    content = render_csv(
        rows,
        ("name", "feeder", "capacity", "longitude", "latitude"),
    )
    write_output_atomically(output_path, content, force)
    return output_path


def normalize_customers(
    source_path: Path = DEFAULT_SOURCE_DIR / CUSTOMER_SOURCE_NAME,
    output_path: Path = DEFAULT_OUTPUT_DIR / "customers.csv",
    *,
    force: bool = False,
) -> Path:
    source_path = source_path.expanduser().resolve()
    output_path = output_path.expanduser().resolve()
    canonical = source_path == (DEFAULT_SOURCE_DIR / CUSTOMER_SOURCE_NAME).resolve()
    rows, _encoding = normalize_customer_rows(source_path, canonical)
    content = render_csv(
        rows,
        ("customer_id", "name", "fare", "power", "power_va", "address"),
    )
    write_output_atomically(output_path, content, force)
    return output_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate and normalize preserved transformer/customer CSV data."
    )
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=DEFAULT_SOURCE_DIR,
        help="Directory containing the preserved source files (read-only).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Output directory. The default is the ignored repository data/ directory.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Atomically replace an existing output when its content differs.",
    )
    parser.add_argument(
        "--only",
        choices=("all", "trafo", "customers"),
        default="all",
        help="Select which normalized output to produce.",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Run non-destructive coordinate fixture checks and exit.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        run_coordinate_fixture_checks()
        if args.self_test:
            print(json.dumps({"status": "ok", "fixtures": len(REAL_POINT_FIXTURES)}))
            return 0

        source_dir = args.source_dir.expanduser().resolve()
        output_dir = ensure_output_location(args.output_dir, source_dir)
        outputs: list[dict[str, object]] = []

        if args.only in ("all", "trafo"):
            source_path = source_dir / TRAFO_SOURCE_NAME
            output_path = output_dir / "trafo_managements.csv"
            normalize_trafo_managements(source_path, output_path, force=args.force)
            outputs.append(
                {
                    "kind": "transformers",
                    "source": str(source_path),
                    "sourceHash": file_sha256(source_path),
                    "output": str(output_path),
                    "rows": EXPECTED_TRAFO_ROWS
                    if source_path == (DEFAULT_SOURCE_DIR / TRAFO_SOURCE_NAME).resolve()
                    else sum(1 for _ in read_semicolon_csv(source_path, TRAFO_SCHEMA)[0]),
                }
            )

        if args.only in ("all", "customers"):
            source_path = source_dir / CUSTOMER_SOURCE_NAME
            output_path = output_dir / "customers.csv"
            normalize_customers(source_path, output_path, force=args.force)
            outputs.append(
                {
                    "kind": "customers",
                    "source": str(source_path),
                    "sourceHash": file_sha256(source_path),
                    "output": str(output_path),
                    "rows": EXPECTED_CUSTOMER_ROWS
                    if source_path == (DEFAULT_SOURCE_DIR / CUSTOMER_SOURCE_NAME).resolve()
                    else sum(1 for _ in read_semicolon_csv(source_path, CUSTOMER_SCHEMA)[0]),
                }
            )

        print(json.dumps({"status": "complete", "outputs": outputs}, indent=2))
        return 0
    except (NormalizationError, OSError, ValueError) as error:
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
