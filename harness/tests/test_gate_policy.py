"""Synthetic checks for the Desktop gate's failure semantics."""

import unittest

import hashlib

from harness.desktop_gate import (
    REQUIRED_CHECKS_BY_PROFILE, check_transition_pins, failed_required,
)


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

    def test_only_pinned_historical_map_can_be_superseded(self):
        old_map = b"old-map"
        other = b"other-pin"
        files = [
            {"name": "academy_map_manifest", "bytes": len(old_map),
             "sha256": hashlib.sha256(old_map).hexdigest()},
            {"name": "other", "bytes": len(other),
             "sha256": hashlib.sha256(other).hexdigest()},
        ]
        actual = {"academy_map_manifest": b"new-map", "other": other}
        allowed = check_transition_pins(files, actual, old_map, True)
        self.assertEqual(allowed["status"], "pass")
        self.assertEqual(allowed["superseded_historical_map"],
                         ["academy_map_manifest"])
        self.assertEqual(check_transition_pins(files, actual, None, True)["status"],
                         "fail")
        self.assertEqual(check_transition_pins(files, actual, old_map, False)["status"],
                         "fail")
        actual["other"] = b"drift"
        self.assertEqual(check_transition_pins(files, actual, old_map, True)["status"],
                         "fail")


if __name__ == "__main__":
    unittest.main()
