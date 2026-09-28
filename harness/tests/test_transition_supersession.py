import hashlib
import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock
import harness.desktop_gate as gate

from harness.desktop_gate import (
    ROOT, SPT, SPT_CANDIDATE_PIN, SPT_HANDOFF_RELATIVE,
    TRANSITION_HISTORY_SPT_HANDOFF, _read_historical_spt_handoff,
    _reviewed_transition_item, check_transition_pins,
    validated_current_spt_handoff_sha256,
)


class TransitionSupersessionTests(unittest.TestCase):
    def setUp(self):
        self.old_map = b"historical map manifest exact bytes"
        self.new_map = b"current map manifest bytes"
        self.old_spt = TRANSITION_HISTORY_SPT_HANDOFF.read_bytes()
        self.new_spt = self.old_spt + b"new reviewed handoff note\n"
        self.current_spt_digest = hashlib.sha256(self.new_spt).hexdigest()
        self.other = b"unchanged pinned file"
        self.files = [
            {"name": "academy_map_manifest", "bytes": len(self.old_map),
             "sha256": hashlib.sha256(self.old_map).hexdigest()},
            {"name": "spt_handoff", "bytes": len(self.old_spt),
             "sha256": hashlib.sha256(self.old_spt).hexdigest()},
            {"name": "other", "bytes": len(self.other),
             "sha256": hashlib.sha256(self.other).hexdigest()},
        ]
        self.actual = {
            "academy_map_manifest": self.new_map,
            "spt_handoff": self.new_spt,
            "other": self.other,
        }

    def check(self, historical_spt=None, current_digest=None, route_valid=True,
              current_map_valid=True, actual=None, files=None):
        return check_transition_pins(
            files if files is not None else self.files,
            actual if actual is not None else self.actual,
            self.old_map,
            current_map_valid,
            historical_spt,
            current_digest,
            route_valid,
        )

    def test_reviewed_map_and_spt_supersession_need_both_exact_histories_and_current_validation(self):
        result = self.check(historical_spt=self.old_spt,
                            current_digest=self.current_spt_digest)
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["superseded_historical_map"], ["academy_map_manifest"])
        self.assertEqual(result["superseded_historical_spt_handoff"], ["spt_handoff"])
        self.assertTrue(result["historical_spt_handoff_bytes_match_pin"])
        self.assertTrue(result["current_spt_handoff_matches_manifest"])

    def test_missing_historic_spt_bytes_fails(self):
        result = self.check(current_digest=self.current_spt_digest)
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["mismatched_files"], ["spt_handoff"])
        self.assertFalse(result["historical_spt_handoff_bytes_match_pin"])

    def test_wrong_historic_spt_bytes_fails_even_when_same_length(self):
        wrong = bytes([self.old_spt[0] ^ 1]) + self.old_spt[1:]
        self.assertEqual(len(wrong), len(self.old_spt))
        result = self.check(historical_spt=wrong,
                            current_digest=self.current_spt_digest)
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["mismatched_files"], ["spt_handoff"])

    def test_omitted_current_spt_handoff_manifest_entry_fails_closed(self):
        result = self.check(historical_spt=self.old_spt, current_digest=None)
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["mismatched_files"], ["spt_handoff"])

    def test_handoff_changed_after_source_validation_fails_digest_binding(self):
        changed_after_pin = self.new_spt + b"concurrent drift\n"
        actual = dict(self.actual)
        actual["spt_handoff"] = changed_after_pin
        result = self.check(historical_spt=self.old_spt,
                            current_digest=self.current_spt_digest,
                            actual=actual)
        self.assertEqual(result["status"], "fail")
        self.assertFalse(result["current_spt_handoff_matches_manifest"])
        self.assertEqual(result["mismatched_files"], ["spt_handoff"])

    def test_wrong_manifest_route_cannot_use_spt_history_exception(self):
        expected = SPT / SPT_HANDOFF_RELATIVE
        item = {"name": "spt_handoff", "path": str(SPT / "unreviewed.md")}
        self.assertIsNone(_reviewed_transition_item([item], "spt_handoff", expected))
        result = self.check(historical_spt=self.old_spt,
                            current_digest=self.current_spt_digest,
                            route_valid=False)
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["mismatched_files"], ["spt_handoff"])

    def test_duplicate_spt_route_cannot_use_history_exception(self):
        expected = SPT / SPT_HANDOFF_RELATIVE
        item = {"name": "spt_handoff", "path": str(expected)}
        self.assertIsNone(_reviewed_transition_item([item, dict(item)], "spt_handoff", expected))
        result = self.check(historical_spt=self.old_spt,
                            current_digest=self.current_spt_digest,
                            route_valid=False)
        self.assertEqual(result["status"], "fail")

    def test_arbitrary_pinned_file_cannot_use_spt_history_exception(self):
        item = {"name": "unreviewed", "bytes": len(self.old_spt),
                "sha256": hashlib.sha256(self.old_spt).hexdigest()}
        result = check_transition_pins(
            [item], {"unreviewed": b"changed"}, None, False,
            self.old_spt, self.current_spt_digest, True,
        )
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["mismatched_files"], ["unreviewed"])

    def test_other_pinned_drift_still_fails_when_reviewed_pins_are_valid(self):
        actual = dict(self.actual)
        actual["other"] = b"drift"
        result = self.check(historical_spt=self.old_spt,
                            current_digest=self.current_spt_digest,
                            actual=actual)
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["mismatched_files"], ["other"])

    def test_legacy_clean_worktree_fallback_keeps_exact_historic_files(self):
        actual = {
            "academy_map_manifest": self.old_map,
            "spt_handoff": self.old_spt,
            "other": self.other,
        }
        exact = self.check(current_digest=None, route_valid=False, actual=actual)
        self.assertEqual(exact["status"], "pass")
        self.assertEqual(exact["superseded_historical_spt_handoff"], [])
        changed = dict(actual)
        changed["spt_handoff"] = self.new_spt
        drift = self.check(current_digest=None, route_valid=False, actual=changed)
        self.assertEqual(drift["status"], "fail")
        self.assertEqual(drift["mismatched_files"], ["spt_handoff"])

    def test_different_managed_root_keeps_exact_historic_manifest_fallback(self):
        manifest_root = ROOT
        managed_root = ROOT / "synthetic-managed-worktree"
        manifest_map_path = manifest_root / "research" / "backend-map" / "map-manifest.json"
        managed_map_path = managed_root / "research" / "backend-map" / "map-manifest.json"
        map_item = {"name": "academy_map_manifest", "path": str(manifest_map_path)}
        self.assertIsNone(_reviewed_transition_item([map_item], "academy_map_manifest", managed_map_path))
        exact = self.check(current_map_valid=False, historical_spt=None,
                           current_digest=None, route_valid=False,
                           actual={"academy_map_manifest": self.old_map,
                                   "spt_handoff": self.old_spt,
                                   "other": self.other})
        self.assertEqual(exact["status"], "pass")
        changed = check_transition_pins(
            self.files,
            {"academy_map_manifest": self.new_map, "spt_handoff": self.old_spt, "other": self.other},
            None,
            False,
            None,
            None,
            False,
        )
        self.assertEqual(changed["status"], "fail")
        self.assertEqual(changed["mismatched_files"], ["academy_map_manifest"])

    def test_candidate_source_validation_binds_digest_to_pin_path_and_status(self):
        valid = {
            "status": "pass", "pin_source": str(SPT_CANDIDATE_PIN),
            "source_content_matches_pin": True,
            "spt_handoff_sha256": self.current_spt_digest,
        }
        self.assertEqual(validated_current_spt_handoff_sha256(valid), self.current_spt_digest)
        self.assertIsNone(validated_current_spt_handoff_sha256({**valid, "spt_handoff_sha256": None}))
        self.assertIsNone(validated_current_spt_handoff_sha256({**valid, "source_content_matches_pin": False}))
        self.assertIsNone(validated_current_spt_handoff_sha256({**valid, "status": "drift"}))
        self.assertIsNone(validated_current_spt_handoff_sha256({
            **valid, "pin_source": str(ROOT / "other-pin.json"),
        }))

    def test_core_main_path_wires_validated_spt_digest_into_real_transition_check(self):
        project_root = Path(r"C:\Users\packr\Desktop\강의하는아이들_대치점")
        candidate_history = TRANSITION_HISTORY_SPT_HANDOFF
        stdout = io.StringIO()
        with (
            mock.patch.object(gate, "ROOT", project_root),
            mock.patch.object(gate, "SPT_CANDIDATE_PIN", project_root / "harness" / "spt-candidate-pin.json"),
            mock.patch.object(gate, "TRANSITION_HISTORY_SPT_HANDOFF", candidate_history),
            mock.patch.object(gate, "run", return_value={"status": "pass", "exit_code": 0, "output": "synthetic stub"}),
            mock.patch.object(gate.sys, "argv", ["desktop_gate.py", "--profile", "core"]),
            redirect_stdout(stdout),
        ):
            exit_code = gate.main()
        report = json.loads(stdout.getvalue())
        checks = report["checks"]
        self.assertEqual(exit_code, 0)
        self.assertEqual(checks["spt_checkout"]["status"], "pass")
        self.assertTrue(checks["spt_checkout"]["source_content_matches_pin"])
        self.assertEqual(checks["transition_pack"]["status"], "pass")
        self.assertEqual(checks["transition_pack"]["superseded_historical_map"], ["academy_map_manifest"])
        self.assertEqual(checks["transition_pack"]["superseded_historical_spt_handoff"], ["spt_handoff"])
        self.assertTrue(checks["transition_pack"]["current_spt_handoff_matches_manifest"])
    def test_historic_copy_is_exact_and_only_loaded_after_current_digest_validation(self):
        self.assertEqual(len(self.old_spt), 16375)
        self.assertEqual(hashlib.sha256(self.old_spt).hexdigest(),
                         "31081bf6b253a2699293b3cb63c796d40cbe1972a3029013e9187af0f61642db")
        self.assertIsNone(_read_historical_spt_handoff(None))
        self.assertEqual(_read_historical_spt_handoff(self.current_spt_digest), self.old_spt)
        with mock.patch("harness.desktop_gate.TRANSITION_HISTORY_SPT_HANDOFF", Path("missing-history-copy.md")):
            self.assertIsNone(_read_historical_spt_handoff(self.current_spt_digest))


if __name__ == "__main__":
    unittest.main()
