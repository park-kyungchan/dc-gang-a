"""Archive a reviewed, sanitized SPT checkout for an isolated Linux gate."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath
from typing import BinaryIO


EXTRA = {
    ".github/workflows/spt-synthetic-gate.yml",
    "docs/native-pairing-contract.md",
}
FORBIDDEN = {
    "integrations/academy/students.json",
    "config/session.json",
    "config/service_account.json",
}
CHUNK_SIZE = 1024 * 1024


def _digest_stream(source: BinaryIO) -> str:
    digest = hashlib.sha256()
    while chunk := source.read(CHUNK_SIZE):
        digest.update(chunk)
    return digest.hexdigest()


def _digest_file(path: Path) -> str:
    with path.open("rb") as source:
        return _digest_stream(source)


def _stat_signature(path: Path) -> tuple[int, int, int, int]:
    stat = path.stat()
    return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns


def _git_paths(root: Path, *args: str) -> list[str]:
    raw = subprocess.check_output(["git", *args, "-z"], cwd=root)
    return [entry.decode("utf-8") for entry in raw.split(b"\0") if entry]


def _is_forbidden(name: str) -> bool:
    normalized = name.casefold()
    parts = PurePosixPath(normalized).parts
    basename = PurePosixPath(normalized).name
    return (
        normalized in {path.casefold() for path in FORBIDDEN}
        or bool(parts and parts[0] in {"config", "data"})
        or basename == ".env"
        or basename.startswith(".env.")
    )


def _member_path(root: Path, name: str) -> Path:
    member = PurePosixPath(name)
    if (
        not name
        or "\\" in name
        or member.is_absolute()
        or any(part in {"", ".", ".."} for part in member.parts)
    ):
        raise RuntimeError(f"Invalid source path: {name!r}")

    candidate = root
    for part in member.parts:
        candidate = candidate / part
        if candidate.is_symlink():
            raise RuntimeError(f"Symbolic link is not allowed: {name}")

    resolved = candidate.resolve(strict=True)
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise RuntimeError(f"Invalid source path: {name}")
    if _is_forbidden(name):
        raise RuntimeError(f"Private source path in candidate: {name}")
    return resolved


def _output_paths(source_root: Path, requested: Path) -> tuple[Path, Path]:
    requested = requested.expanduser()
    if not requested.is_absolute():
        requested = Path.cwd() / requested
    lexical_archive = Path(os.path.abspath(requested))
    lexical_manifest = lexical_archive.with_suffix(".json")
    # Check lexical paths first so broken symlinks cannot redirect publication.
    _refuse_existing(lexical_archive, lexical_manifest)

    parent = lexical_archive.parent.resolve(strict=False)
    archive = parent / lexical_archive.name
    manifest = archive.with_suffix(".json")
    if os.path.normcase(str(archive)) == os.path.normcase(str(manifest)):
        raise ValueError("Archive output must not use the .json suffix")
    if archive.is_relative_to(source_root) or manifest.is_relative_to(source_root):
        raise ValueError("Archive and manifest outputs must be outside the source checkout")
    _refuse_existing(archive, manifest)
    return archive, manifest


def _refuse_existing(archive: Path, manifest: Path) -> None:
    existing = [path for path in (archive, manifest) if os.path.lexists(path)]
    if existing:
        paths = ", ".join(str(path) for path in existing)
        raise FileExistsError(f"Refusing to overwrite existing output: {paths}")


def _preflight(source: Path) -> tuple[Path, list[tuple[str, Path, str, tuple[int, int, int, int]]]]:
    root = source.expanduser().resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Source must be a Git worktree directory")

    git_root = Path(
        subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"], cwd=root
        ).decode("utf-8").strip()
    ).resolve(strict=True)
    if git_root != root:
        raise ValueError("Source must be the Git worktree root")

    tracked = _git_paths(root, "ls-files")
    untracked = set(_git_paths(root, "ls-files", "--others", "--exclude-standard"))
    if untracked - EXTRA or not EXTRA <= set(tracked) | untracked:
        raise RuntimeError(f"Unexpected source path set: {sorted(untracked - EXTRA)}")

    names = sorted(set(tracked) | untracked)
    if not names:
        raise RuntimeError("Source worktree is empty")

    prepared = []
    for name in names:
        path = _member_path(root, name)
        signature = _stat_signature(path)
        content_hash = _digest_file(path)
        if _stat_signature(path) != signature:
            raise RuntimeError(f"Source changed during preflight: {name}")
        prepared.append((name, path, content_hash, signature))

    return root, prepared


def _verify_archive(path: Path, prepared: list[tuple[str, Path, str, tuple[int, int, int, int]]]) -> None:
    expected = {name: content_hash for name, _, content_hash, _ in prepared}
    with tarfile.open(path, "r:") as archive:
        members = archive.getmembers()
        if [member.name for member in members] != sorted(expected):
            raise RuntimeError("Archive member list does not match the reviewed source list")
        for member in members:
            if not member.isfile():
                raise RuntimeError(f"Non-regular archive member: {member.name}")
            source = archive.extractfile(member)
            if source is None:
                raise RuntimeError(f"Unreadable archive member: {member.name}")
            with source:
                if _digest_stream(source) != expected[member.name]:
                    raise RuntimeError(f"Archive content hash mismatch: {member.name}")


def _cleanup_paths(paths: list[Path]) -> list[tuple[Path, OSError]]:
    pending = []
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError as error:
            pending.append((path, error))
    return pending


def _report_cleanup_pending(pending: list[tuple[Path, OSError]], context: str) -> None:
    if pending:
        details = "; ".join(f"{path} ({error})" for path, error in pending)
        print(f"cleanup_pending ({context}): {details}", file=sys.stderr)


def _write_temp_manifest(directory: Path, content: bytes) -> Path:
    fd, name = tempfile.mkstemp(prefix=".spt-manifest-", suffix=".tmp", dir=directory)
    path = Path(name)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
    except BaseException:
        _report_cleanup_pending(_cleanup_paths([path]), "manifest staging")
        raise
    return path


def _publish_pair(
    temp_archive: Path, archive: Path, temp_manifest: Path, manifest: Path
) -> None:
    _refuse_existing(archive, manifest)
    published: list[tuple[Path, Path]] = []
    try:
        # Hard-link publication is atomic and refuses an existing destination.
        os.link(temp_archive, archive)
        published.append((archive, temp_archive))
        os.link(temp_manifest, manifest)
        published.append((manifest, temp_manifest))
    except BaseException as original:
        rollback_pending = []
        for destination, staged in reversed(published):
            try:
                if os.path.samefile(destination, staged):
                    destination.unlink()
                else:
                    rollback_pending.append((destination, OSError("target no longer matches staged file")))
            except FileNotFoundError:
                pass
            except OSError as error:
                rollback_pending.append((destination, error))
        if rollback_pending:
            details = "; ".join(f"{path} ({error})" for path, error in rollback_pending)
            original.add_note(
                "Partial publication path requires recovery: " + details + ". "
                "Verify that each exact path is this invocation's staged output before removing it; "
                "do not overwrite it. The original publication error is preserved."
            )
        raise


def create_archive(source: Path, requested_output: Path) -> dict[str, object]:
    # Refuse existing outputs before inspecting or staging source data.
    preliminary_root = source.expanduser().resolve(strict=True)
    if not preliminary_root.is_dir():
        raise ValueError("Source must be a Git worktree directory")
    archive, manifest = _output_paths(preliminary_root, requested_output)

    # Finish the complete path, symlink, exclusion and content-hash preflight
    # before creating even a temporary output file.
    root, prepared = _preflight(source)
    if root != preliminary_root:
        raise RuntimeError("Source root changed during preflight")
    _refuse_existing(archive, manifest)
    archive.parent.mkdir(parents=True, exist_ok=True)

    archive_fd, temp_name = tempfile.mkstemp(
        prefix=f".{archive.name}.", suffix=".tmp", dir=archive.parent
    )
    os.close(archive_fd)
    temp_archive = Path(temp_name)
    temp_manifest: Path | None = None
    try:
        with tarfile.open(temp_archive, "w") as output:
            for name, path, expected_hash, signature in prepared:
                if _stat_signature(path) != signature:
                    raise RuntimeError(f"Source changed before archiving: {name}")
                output.add(path, arcname=name, recursive=False)
                if _stat_signature(path) != signature or _digest_file(path) != expected_hash:
                    raise RuntimeError(f"Source changed while archiving: {name}")

        _verify_archive(temp_archive, prepared)
        archive_hash = _digest_file(temp_archive)
        manifest_data = {
            "source": str(root),
            "files": {name: content_hash for name, _, content_hash, _ in prepared},
            "archive_sha256": archive_hash,
        }
        serialized = (json.dumps(manifest_data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        temp_manifest = _write_temp_manifest(archive.parent, serialized)
        _publish_pair(temp_archive, archive, temp_manifest, manifest)
        return {"file_count": len(prepared), "archive_sha256": archive_hash}
    finally:
        staged = [temp_archive]
        if temp_manifest is not None:
            staged.append(temp_manifest)
        _report_cleanup_pending(_cleanup_paths(staged), "temporary staging")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(create_archive(args.source, args.output)))


if __name__ == "__main__":
    main()


