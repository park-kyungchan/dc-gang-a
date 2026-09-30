"""LMS Full Route Engine & Backend Map SSoT Registry (Python 3.12 stdlib).

Safety & Invariants (AGENTS.md & Phase 2 Harness Optimization Compliance):
1. Single Source of Truth (SSoT): Dynamically loads and validates all 54 canonical
   LMS operations from research/backend-map/route-registry.json.
2. Cwd-Independent Path Resolution (RUB-10): Anchored strictly to Path(__file__).resolve().
3. HTTP Method Safety Fallacy Guard (TRAP 1 / RUB-03): NEVER rely on http_method == 'GET' for read safety!
   Mutating GET endpoints (day_record_udtprg, day_record_udthw, day_record_udtmemo,
   day_record_udtattn, similar_paper_create) are strictly blocked by assert_safe_read().
4. Fail-Closed: assert_safe_read() raises UnsafeMutatingOperationError for any endpoint
   where semantic_effect != 'read' or safe_to_probe != True.
5. Dual-Runtime Parity (RUB-07): 1:1 structural and behavioral parity with src/lms/lmsRouteRegistry.ts.
6. Zero External Dependencies: Python 3.12 standard library only.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence
from urllib.parse import parse_qs, urlparse


class UnsafeMutatingOperationError(RuntimeError):
    """Raised when an unsafe or mutating operation is invoked in a read-only context."""
    pass


class RouteLookupError(LookupError):
    """Raised when an unknown route or operation is requested."""
    pass


# Anchor path strictly relative to file location (RUB-10 cwd-independent)
ROUTE_REGISTRY_PATH: Path = (
    Path(__file__).resolve().parent.parent / "research" / "backend-map" / "route-registry.json"
)


@dataclass(frozen=True)
class LmsRouteDefinition:
    """Canonical representation of an LMS reverse-engineered operation."""

    id: str
    route_template: str
    operation: str
    http_method: str | None
    semantic_effect: str
    evidence_grade: str
    evidence_date: str
    join_key_names: tuple[str, ...]
    safe_to_probe: bool
    reason: str
    source_refs: tuple[str, ...]
    category: str
    servlet_path: str
    process_name: str
    effect: str

    # 1:1 Parity aliases (camelCase)
    @property
    def routeId(self) -> str:
        return self.id

    @property
    def routeTemplate(self) -> str:
        return self.route_template

    @property
    def httpMethod(self) -> str | None:
        return self.http_method

    @property
    def semanticEffect(self) -> str:
        return self.semantic_effect

    @property
    def safeToProbe(self) -> bool:
        return self.safe_to_probe

    @property
    def joinKeyNames(self) -> tuple[str, ...]:
        return self.join_key_names

    @property
    def sourceRefs(self) -> tuple[str, ...]:
        return self.source_refs

    @property
    def evidenceGrade(self) -> str:
        return self.evidence_grade

    @property
    def evidenceDate(self) -> str:
        return self.evidence_date

    @property
    def servletPath(self) -> str:
        return self.servlet_path

    @property
    def processName(self) -> str:
        return self.process_name


class _RegistryState:
    """Internal singleton storage for loaded and indexed routes."""

    def __init__(self, registry_path: Path = ROUTE_REGISTRY_PATH) -> None:
        self.registry_path = registry_path
        self.canonical_routes: list[LmsRouteDefinition] = []
        self.routes_by_id: dict[str, LmsRouteDefinition] = {}
        self.routes_by_operation: dict[str, LmsRouteDefinition] = {}
        self._load()

    def _load(self) -> None:
        if not self.registry_path.is_file():
            raise RouteLookupError(f"Route registry file not found at: '{self.registry_path}'")

        try:
            raw_text = self.registry_path.read_text(encoding="utf-8")
            data = json.loads(raw_text)
        except Exception as exc:
            raise RouteLookupError(f"Failed to parse route registry at '{self.registry_path}': {exc}") from exc

        entries = data.get("entries")
        if not isinstance(entries, list):
            raise AssertionError(f"Expected 'entries' list in route registry, got {type(entries)}")

        # RUB-02: Exactly 54 operations loaded and validated against schema
        if len(entries) != 54:
            raise AssertionError(f"Schema violation: Expected exactly 54 entries, found {len(entries)}")

        op_counts = Counter(entry.get("operation") for entry in entries if isinstance(entry, dict))

        for entry in entries:
            # Schema validation
            entry_id = entry.get("id")
            if not isinstance(entry_id, str) or not entry_id:
                raise AssertionError(f"Route entry missing non-empty 'id': {entry}")
            operation = entry.get("operation")
            if not isinstance(operation, str) or not operation:
                raise AssertionError(f"Route entry '{entry_id}' missing non-empty 'operation'")
            template = entry.get("route_template")
            if not isinstance(template, str) or not template:
                raise AssertionError(f"Route entry '{entry_id}' missing non-empty 'route_template'")
            semantic_effect = entry.get("semantic_effect")
            if not isinstance(semantic_effect, str):
                raise AssertionError(f"Route entry '{entry_id}' missing string 'semantic_effect'")
            safe_to_probe = entry.get("safe_to_probe")
            if not isinstance(safe_to_probe, bool):
                raise AssertionError(f"Route entry '{entry_id}' missing boolean 'safe_to_probe'")
            join_key_names = entry.get("join_key_names")
            if not isinstance(join_key_names, list):
                raise AssertionError(f"Route entry '{entry_id}' missing list 'join_key_names'")
            source_refs = entry.get("source_refs")
            if not isinstance(source_refs, list):
                raise AssertionError(f"Route entry '{entry_id}' missing list 'source_refs'")

            evidence_grade = str(entry.get("evidence_grade", ""))
            evidence_date = str(entry.get("evidence_date", ""))
            reason = str(entry.get("reason", ""))
            http_method = entry.get("http_method")
            if http_method is not None and not isinstance(http_method, str):
                raise AssertionError(f"Route entry '{entry_id}' has invalid 'http_method'")

            # Derive servlet path and process name
            servlet_path = template
            process_name = operation
            if template.startswith("native:"):
                servlet_path = template
            elif "?" in template:
                parsed_url = urlparse(template)
                servlet_path = parsed_url.path
                qs = parse_qs(parsed_url.query)
                process_name = (
                    qs.get("p_process", [None])[0]
                    or qs.get("reqCmd", [None])[0]
                    or operation
                )

            # Categorization
            category = "BackendMap"
            if "tutor.fa" in servlet_path or entry_id.startswith("fa_"):
                category = "FAIndex"
            elif "tutor.na" in servlet_path or entry_id.startswith("dtzt_"):
                category = "NAIndex"
            elif "tutor.diag" in servlet_path:
                category = "DAIndex"
            elif "tutor.base" in servlet_path or entry_id.startswith("base_") or entry_id.startswith("attendance_"):
                category = "BaseManageIndex"
            elif "tutor.wb" in servlet_path or entry_id.startswith("smartbook_") or entry_id.startswith("workbook_"):
                category = "SmartBookIndex"
            elif "coursemanage" in servlet_path or entry_id.startswith("study_") or entry_id.startswith("prestudy_"):
                category = "CourseManageIndex"
            elif "DayRecordServlet" in servlet_path or entry_id.startswith("day_record_") or entry_id.startswith("course_"):
                category = "CourseMainIndex"

            is_pure_read = semantic_effect == "read" and safe_to_probe is True
            effect = "READ_ONLY" if is_pure_read else "MUTATING"

            route_def = LmsRouteDefinition(
                id=entry_id,
                route_template=template,
                operation=operation,
                http_method=http_method,
                semantic_effect=semantic_effect,
                evidence_grade=evidence_grade,
                evidence_date=evidence_date,
                join_key_names=tuple(join_key_names),
                safe_to_probe=safe_to_probe,
                reason=reason,
                source_refs=tuple(source_refs),
                category=category,
                servlet_path=servlet_path,
                process_name=process_name,
                effect=effect,
            )

            self.canonical_routes.append(route_def)
            self.routes_by_id[entry_id] = route_def

            # Only index unique operation names to prevent ambiguity
            if op_counts[operation] == 1:
                self.routes_by_operation[operation] = route_def


_STATE: _RegistryState | None = None


def _get_state() -> _RegistryState:
    global _STATE
    if _STATE is None:
        _STATE = _RegistryState()
    return _STATE


def get_route(id_or_operation: str) -> LmsRouteDefinition:
    """Retrieve an LMS route by canonical ID or unique operation name."""
    state = _get_state()
    route = state.routes_by_id.get(id_or_operation) or state.routes_by_operation.get(id_or_operation)
    if route is None:
        raise RouteLookupError(f"[LmsRouteRegistry] Unknown route or operation: {id_or_operation}")
    return route


def has_route(id_or_operation: str) -> bool:
    """Check whether a route is registered by canonical ID or unique operation."""
    state = _get_state()
    return id_or_operation in state.routes_by_id or id_or_operation in state.routes_by_operation


def get_all_routes() -> list[LmsRouteDefinition]:
    """Retrieve all 54 reverse-engineered canonical routes (RUB-02)."""
    state = _get_state()
    return list(state.canonical_routes)


def is_safe_read(id_or_operation: str) -> bool:
    """Fail-closed check for whether an operation is safe for read-only probing.

    NEVER uses http_method == 'GET' for read safety!
    Returns True ONLY if semantic_effect == 'read' and safe_to_probe is True.
    """
    if not has_route(id_or_operation):
        return False
    try:
        route = get_route(id_or_operation)
        return (
            route.semantic_effect == "read"
            and route.safe_to_probe is True
            and route.semantic_effect not in ("write", "send", "open_send_screen")
            and route.effect != "MUTATING"
        )
    except Exception:
        return False


def assert_safe_read(id_or_operation: str) -> None:
    """Fail-closed assertion blocking unsafe or mutating operations (RUB-03).

    TRAP 1: HTTP Method Safety Fallacy!
    Mutating GET endpoints (day_record_udtprg, day_record_udthw, day_record_udtmemo,
    day_record_udtattn, similar_paper_create) strictly raise UnsafeMutatingOperationError.
    """
    route = get_route(id_or_operation)
    if not is_safe_read(id_or_operation):
        raise UnsafeMutatingOperationError(
            f"[LmsRouteRegistry: SAFETY VIOLATION] Attempted to invoke unsafe/mutating route '{id_or_operation}' "
            f"(id: {route.id}, op: {route.operation}, method: {route.http_method}, "
            f"semantic_effect: {route.semantic_effect}, safe_to_probe: {route.safe_to_probe}) in read-only harness."
        )


class LmsRouteRegistry:
    """Class wrapper providing static/class method parity with TypeScript."""

    @classmethod
    def get_route(cls, id_or_operation: str) -> LmsRouteDefinition:
        return get_route(id_or_operation)

    @classmethod
    def get_all_routes(cls) -> list[LmsRouteDefinition]:
        return get_all_routes()

    @classmethod
    def has_route(cls, id_or_operation: str) -> bool:
        return has_route(id_or_operation)

    @classmethod
    def is_safe_read(cls, id_or_operation: str) -> bool:
        return is_safe_read(id_or_operation)

    @classmethod
    def assert_safe_read(cls, id_or_operation: str) -> None:
        assert_safe_read(id_or_operation)

    # TypeScript camelCase parity aliases
    getRoute = get_route
    getAllRoutes = get_all_routes
    hasRoute = has_route
    isSafeRead = is_safe_read
    assertSafeRead = assert_safe_read
