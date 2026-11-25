from csv import QUOTE_STRINGS
from pathlib import Path
import re
import pandas as pd

CWD = Path.cwd()
TEMP_DIR = CWD / ".temp"
DATA_DIR = CWD / "data"

COORD_PATTERN = re.compile(r"[-+]?\d+(?:\.\d+)?")
ENCODINGS = ("utf-8-sig", "cp1252", "latin1")


def read_csv_with_fallback(path: Path, delimiter: str = ";") -> pd.DataFrame:
    last_error: Exception | None = None
    for enc in ENCODINGS:
        try:
            return pd.read_csv(path, delimiter=delimiter, encoding=enc)
        except (UnicodeDecodeError, Exception) as exc:
            last_error = exc
    return pd.read_csv(
        path,
        delimiter=delimiter,
        encoding="utf-8",
        encoding_errors="replace",
    ) if last_error else pd.read_csv(path, delimiter=delimiter)


def parse_point(coord: object) -> tuple[str | None, str | None]:
    if pd.isna(coord):
        return None, None
    matches = COORD_PATTERN.findall(str(coord))
    if len(matches) < 2:
        return None, None
    return matches[0], matches[1]


def normalize_trafo_managements() -> None:
    source_path = TEMP_DIR / "sigap" / "Manajemen Trafo (SupaBase).csv"
    df = read_csv_with_fallback(source_path, delimiter=";")

    coords = df["titik_koordinat"].apply(parse_point)
    df["longitude"] = [c[0] for c in coords]
    df["latitude"] = [c[1] for c in coords]
    df = df.drop(columns=["titik_koordinat"])
    df = df.rename(
        columns={
            "nama_trafo": "name",
            "penyulang": "feeder",
            "kapasitas": "capacity",
        }
    )

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    output_path = DATA_DIR / "trafo_managements.csv"
    df.to_csv(output_path, index=False, quoting=QUOTE_STRINGS)


def normalize_customers() -> None:
    source_path = TEMP_DIR / "sigap" / "Data Pelanggan (SupaBase).csv"
    df = read_csv_with_fallback(source_path, delimiter=";")
    print(df.columns)
    df = df.rename(
        columns={
            "id_pelanggan": "customer_id",
            "nama": "name",
            "tarif": "fare",
            "daya": "power",
            "alamat": "address",
        }
    )

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    output_path = DATA_DIR / "customers.csv"
    df.to_csv(output_path, index=False, quoting=QUOTE_STRINGS)


def main() -> None:
    normalize_trafo_managements()
    normalize_customers()


if __name__ == "__main__":
    main()