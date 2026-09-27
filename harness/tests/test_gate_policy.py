"""Synthetic checks for the Desktop gate's failure semantics."""

import unittest

from harness.desktop_gate import REQUIRED_LOCAL_CHECKS, failed_required


class GatePolicyTests(unittest.TestCase):
    def test_required_checks_pass_only_when_each_passes(self):
        checks = {name: {"status": "pass"} for name in REQUIRED_LOCAL_CHECKS}
        self.assertEqual(failed_required(checks), [])

    def test_drift_and_unavailable_cannot_report_green(self):
        checks = {name: {"status": "pass"} for name in REQUIRED_LOCAL_CHECKS}
        checks["spt_checkout"] = {"status": "drift"}
        checks["transition_pack"] = {"status": "unavailable"}
        self.assertEqual(failed_required(checks), ["transition_pack", "spt_checkout"])

    def test_missing_required_check_fails_closed(self):
        checks = {name: {"status": "pass"} for name in REQUIRED_LOCAL_CHECKS}
        del checks["academy_live_import"]
        self.assertEqual(failed_required(checks), ["academy_live_import"])


if __name__ == "__main__":
    unittest.main()
