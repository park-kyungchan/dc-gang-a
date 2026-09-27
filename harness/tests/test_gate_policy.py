"""Synthetic checks for the Desktop gate's failure semantics."""

import unittest

from harness.desktop_gate import REQUIRED_CHECKS_BY_PROFILE, failed_required


class GatePolicyTests(unittest.TestCase):
    def test_required_checks_pass_only_when_each_passes(self):
        checks = {name: {"status": "pass"} for name in REQUIRED_CHECKS_BY_PROFILE["core"]}
        self.assertEqual(failed_required(checks), [])

    def test_drift_and_unavailable_cannot_report_green(self):
        checks = {name: {"status": "pass"} for name in REQUIRED_CHECKS_BY_PROFILE["core"]}
        checks["spt_checkout"] = {"status": "drift"}
        checks["transition_pack"] = {"status": "unavailable"}
        self.assertEqual(failed_required(checks), ["transition_pack", "spt_checkout"])

    def test_missing_required_check_fails_closed(self):
        checks = {name: {"status": "pass"} for name in REQUIRED_CHECKS_BY_PROFILE["live"]}
        del checks["academy_live_import"]
        self.assertEqual(failed_required(checks, "live"), ["academy_live_import"])

    def test_core_worktree_does_not_require_optional_live_environment(self):
        checks = {name: {"status": "pass"} for name in REQUIRED_CHECKS_BY_PROFILE["core"]}
        checks["academy_live_import"] = {"status": "unavailable"}
        checks["live_dependency_lock"] = {"status": "unavailable"}
        self.assertEqual(failed_required(checks, "core"), [])
        self.assertEqual(failed_required(checks, "live"),
                         ["academy_live_import", "live_dependency_lock"])


if __name__ == "__main__":
    unittest.main()
