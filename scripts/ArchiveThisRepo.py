#!/usr/bin/env python3
"""Create a source archive while excluding secrets, runtime data, and build output.

The archive is assembled from an explicit exclusion policy and is preflighted
for high-confidence secrets and PII before any archive file is created.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Iterable, Sequence


PROJECT_ROOT = Path(__file__).resolve().parents[1]

# Root-level runtime/build directories are excluded. This intentionally keeps
# source directories such as backend/src/database in the archive.
ROOT_EXCLUDED_DIRECTORIES = {
    "database",
    "data",
    "storage",
    "logs",
    "out",
    "coverage",
    "dist",
    "archives",
}
# These directory names are unsafe wherever they occur.
NESTED_EXCLUDED_DIRECTORIES = {
    ".git",
    ".temp",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
}
EXCLUDE_PATTERN = sorted(ROOT_EXCLUDED_DIRECTORIES | NESTED_EXCLUDED_DIRECTORIES)
ENV_FILE_PATTERN = re.compile(r"^\.env(?:\..*)?$", re.IGNORECASE)
SENSITIVE_FILE_NAMES = {
    "credentials",
    "credentials.json",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "id_rsa",
    "secrets",
    "secrets.json",
}
SENSITIVE_FILE_SUFFIXES = {".key", ".p12", ".pem", ".pfx"}
TEXT_SUFFIXIXES = {
    ".bat",
    ".conf",
    ".css",
    ".csv",
    ".env",
    ".html",
    ".ini",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".ps1",
    ".py",
    ".scss",
    ".sh",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
}

SECRET_PATTERNS = (
    (
        "private_key",
        re.compile(r"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----"),
        "high",
    ),
    ("aws_access_key", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"), "high"),
    (
        "github_token",
        re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,255}\b"),
        "high",
    ),
    ("slack_token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"), "high"),
    (
        "jwt",
        re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"),
        "high",
    ),
    (
        "credential_assignment",
        re.compile(
            r"(?im)^\s*(?:export\s+)?[A-Z0-9_.-]*"
            r"(?:PASSWORD|PASSWD|SECRET|TOKEN|API[_-]?KEY|PRIVATE[_-]?KEY)"
            r"[A-Z0-9_.-]*\s*[:=]\s*[\"']?([^\s\"'#]+)"
        ),
        "high",
    ),
)
PII_PATTERNS = (
    ("email_address", re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE), "medium"),
    ("indonesian_national_id", re.compile(r"(?<!\d)\d{16}(?!\d)"), "medium"),
    ("indonesian_phone", re.compile(r"(?<!\d)(?:\+62|62|0)8\d{8,11}(?!\d)"), "medium"),
)


class ArchiveError(RuntimeError):
    """Raised when an archive cannot be created safely."""


class ArchivePreflightError(ArchiveError):
    """Raised when preflight finds potential secrets or PII."""

    def __init__(self, findings: Sequence[dict[str, object]]):
        super().__init__(
            f"Preflight found {len(findings)} potential secret/PII item(s); archive was not created"
        )
        self.findings = list(findings)


def is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def is_excluded(
    path: Path,
    root: Path,
    patterns: list[str],
    output_path: Path,
) -> bool:
    """Return whether a path is excluded by the archive safety policy."""
    resolved = path.resolve()
    if resolved == output_path.resolve():
        return True

    relative = resolved.relative_to(root.resolve())
    parts = relative.parts
    if not parts:
        return False

    requested = {value.casefold() for value in patterns}
    if parts[0].casefold() in requested:
        return True
    if any(part.casefold() in NESTED_EXCLUDED_DIRECTORIES for part in parts):
        return True
    if ENV_FILE_PATTERN.fullmatch(parts[-1]):
        return True
    if parts[-1].casefold() in SENSITIVE_FILE_NAMES:
        return True
    if Path(parts[-1]).suffix.casefold() in SENSITIVE_FILE_SUFFIXES:
        return True
    return False


def get_targets(root: Path, output_path: Path) -> list[Path]:
    """Return sorted archive members while pruning excluded directory trees."""
    root = root.resolve()
    output_path = output_path.resolve()
    targets: list[Path] = []

    for current, directories, files in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        kept_directories = []
        for directory in sorted(directories):
            candidate = current_path / directory
            if not is_excluded(candidate, root, EXCLUDE_PATTERN, output_path):
                kept_directories.append(directory)
        directories[:] = kept_directories

        for filename in sorted(files):
            candidate = current_path / filename
            if candidate.is_symlink():
                continue
            if not candidate.is_file():
                continue
            if is_excluded(candidate, root, EXCLUDE_PATTERN, output_path):
                continue
            targets.append(candidate)

    return sorted(targets, key=lambda item: item.relative_to(root).as_posix())


def redact_secret(value: str) -> str:
    if len(value) <= 8:
        return "***"
    return f"{value[:3]}...{value[-2:]}"


def redact_email(value: str) -> str:
    if "@" not in value:
        return redact_secret(value)
    local, domain = value.rsplit("@", 1)
    visible = local[:2] if len(local) >= 2 else "*"
    return f"{visible}***@{domain}"


def is_placeholder_secret(value: str) -> bool:
    lowered = value.strip().strip('"\'').lower()
    if not lowered:
        return True
    placeholder_fragments = (
        "process.env",
        "your-",
        "your_",
        "replace",
        "changeme",
        "change-me",
        "example",
        "placeholder",
        "dummy",
        "not-a-real",
        "test-only",
        "ci-",
        "<",
        "${",
    )
    return any(fragment in lowered for fragment in placeholder_fragments)


def line_number_for_offset(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def preflight_sensitive_content(root: Path, targets: Iterable[Path]) -> list[dict[str, object]]:
    """Scan included text files for high-confidence secrets and PII."""
    root = root.resolve()
    findings: list[dict[str, object]] = []
    seen: set[tuple[str, str, int]] = set()

    for target in targets:
        if target.suffix.casefold() not in TEXT_SUFFIXIXES and not target.name.casefold().startswith(".env"):
            continue
        try:
            if target.stat().st_size > 2 * 1024 * 1024:
                continue
            text = target.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue

        relative = target.relative_to(root).as_posix()
        for kind, pattern, severity in SECRET_PATTERNS:
            for match in pattern.finditer(text):
                value = match.group(1) if match.groups() else match.group(0)
                if kind == "credential_assignment" and is_placeholder_secret(value):
                    continue
                line = line_number_for_offset(text, match.start())
                key = (kind, relative, line)
                if key in seen:
                    continue
                seen.add(key)
                findings.append(
                    {
                        "kind": kind,
                        "severity": severity,
                        "path": relative,
                        "line": line,
                        "match": redact_secret(value),
                        "action": "Remove or rotate the value before archiving.",
                    }
                )

        for kind, pattern, severity in PII_PATTERNS:
            for match in pattern.finditer(text):
                value = match.group(0)
                line = line_number_for_offset(text, match.start())
                key = (kind, relative, line)
                if key in seen:
                    continue
                seen.add(key)
                findings.append(
                    {
                        "kind": kind,
                        "severity": severity,
                        "path": relative,
                        "line": line,
                        "match": redact_email(value) if kind == "email_address" else redact_secret(value),
                        "action": "Confirm that personal data is intentionally included before archiving.",
                    }
                )

    return sorted(findings, key=lambda item: (str(item["path"]), int(item["line"]), str(item["kind"])))


def archive_root_and_output(root: Path, output_path: Path) -> tuple[Path, Path]:
    resolved_root = root.expanduser().resolve()
    resolved_output = output_path.expanduser().resolve()
    if not resolved_root.is_dir():
        raise ArchiveError(f"Repository root is not a directory: {resolved_root}")
    if resolved_output.suffix.casefold() != ".zip":
        raise ArchiveError(f"Archive output must use the .zip extension: {resolved_output}")
    return resolved_root, resolved_output


def create_archive(
    root: Path,
    output_path: Path,
    *,
    allow_sensitive: bool = False,
    force: bool = False,
) -> int:
    """Create a ZIP archive and return the number of included files."""
    root, output_path = archive_root_and_output(root, output_path)
    targets = get_targets(root, output_path)
    findings = preflight_sensitive_content(root, targets)
    if findings and not allow_sensitive:
        raise ArchivePreflightError(findings)
    if output_path.exists() and not force:
        raise ArchiveError(f"Refusing to overwrite existing archive without --force: {output_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
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
        with zipfile.ZipFile(
            temporary_name,
            "w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=6,
        ) as archive:
            for target in targets:
                archive.write(target, arcname=target.relative_to(root).as_posix())
        os.replace(temporary_name, output_path)
        temporary_name = None
        return len(targets)
    finally:
        if temporary_name:
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Archive this repository safely.")
    parser.add_argument(
        "--root",
        type=Path,
        default=PROJECT_ROOT,
        help="Repository root to archive (default: the directory containing this script).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="ZIP output path (default: ignored out/ directory).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Explicitly allow replacement of an existing archive.",
    )
    parser.add_argument(
        "--allow-sensitive",
        action="store_true",
        help="Archive even when preflight reports potential secrets or PII.",
    )
    parser.add_argument(
        "--preflight-only",
        action="store_true",
        help="Report included files and findings without creating an archive.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    root = args.root.expanduser().resolve()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output = (
        args.output.expanduser().resolve()
        if args.output
        else (root / "out" / f"{root.name}_{timestamp}.zip").resolve()
    )

    try:
        root, output = archive_root_and_output(root, output)
        targets = get_targets(root, output)
        findings = preflight_sensitive_content(root, targets)
        report: dict[str, object] = {
            "root": str(root),
            "output": str(output),
            "includedFiles": len(targets),
            "excluded": {
                "rootDirectories": sorted(ROOT_EXCLUDED_DIRECTORIES),
                "nestedDirectories": sorted(NESTED_EXCLUDED_DIRECTORIES),
                "envFiles": ".env*",
                "sensitiveFileNames": sorted(SENSITIVE_FILE_NAMES),
            },
            "findings": findings,
            "findingCount": len(findings),
            "status": "preflight-complete",
        }

        if findings and not args.allow_sensitive:
            report["status"] = "blocked"
            print(json.dumps(report, indent=2), file=sys.stderr)
            return 2
        if args.preflight_only:
            print(json.dumps(report, indent=2))
            return 0

        total = create_archive(
            root,
            output,
            allow_sensitive=args.allow_sensitive,
            force=args.force,
        )
        report["status"] = "complete"
        report["includedFiles"] = total
        print(json.dumps(report, indent=2))
        return 0
    except ArchiveError as error:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "error": {"type": error.__class__.__name__, "message": str(error)},
                },
                indent=2,
            ),
            file=sys.stderr,
        )
        return 1
    except OSError as error:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "error": {"type": error.__class__.__name__, "message": str(error)},
                },
                indent=2,
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
