"""Harness test entrypoint for LMS route engine tests."""

from workbench_v2.tests.test_routes import TestLmsRoutes

__all__ = ["TestLmsRoutes"]

if __name__ == "__main__":
    import unittest
    unittest.main()
