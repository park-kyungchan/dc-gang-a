"""Workbench V2 re-export of canonical LMS route registry (SSoT: research/backend-map/route-registry.json)."""

from harness.routes import (
    ROUTE_REGISTRY_PATH,
    LmsRouteDefinition,
    LmsRouteRegistry,
    RouteLookupError,
    UnsafeMutatingOperationError,
    assert_safe_read,
    get_all_routes,
    get_route,
    has_route,
    is_safe_read,
)

__all__ = [
    "ROUTE_REGISTRY_PATH",
    "LmsRouteDefinition",
    "LmsRouteRegistry",
    "RouteLookupError",
    "UnsafeMutatingOperationError",
    "assert_safe_read",
    "get_all_routes",
    "get_route",
    "has_route",
    "is_safe_read",
]
