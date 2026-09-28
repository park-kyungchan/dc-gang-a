"""Actual SPT dispatch builder, but native config/Popen are explicit fakes."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('spt_action_model',ROOT/'scripts/spt_native_runner.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class DraftModelSelection(unittest.TestCase):
    def test_only_draft_dispatch_selects_luna_xhigh_and_preserves_native_limits(self):
        config=types.ModuleType('hermes_cli.config');config.load_config_readonly=lambda:{'plugins':{'enabled':['ocp-readonly-review']}}
        parent=types.ModuleType('hermes_cli');parent.config=config
        base=ROOT/'.sites-runtime/rehearsal-contract-tests';base.mkdir(parents=True,exist_ok=True)
        payload={'requestId':'11111111-1111-4111-8111-111111111111','studentId':'S001','date':'2026-09-14','sessions':[{'sessionId':'22222222-2222-4222-8222-222222222222','entries':[{'id':'33333333-3333-4333-8333-333333333333','kind':'transcript','text':'SYNTHETIC teacher rehearsal statement'}]}]}
        with tempfile.TemporaryDirectory(dir=base) as d,patch.dict(sys.modules,{'hermes_cli':parent,'hermes_cli.config':config}),patch.object(m.subprocess,'Popen',side_effect=OSError('SYNTHETIC_NO_DISPATCH')) as popen:
            runner=m.NativeAnalysis(Path(d),3,resume_usage=True,rehearsal_id='SYNTHETIC')
            with self.assertRaisesRegex(ValueError,'NATIVE_RESULT_UNKNOWN'):runner.run(payload)
            command=popen.call_args.args[0]
            self.assertEqual(command[command.index('--model')+1],'gpt-5.6-luna')
            self.assertEqual(command[command.index('--reasoning')+1],'xhigh')
            self.assertEqual(command[command.index('--provider')+1],'openai-codex')
            self.assertEqual(command[command.index('--toolsets')+1],'ocp_review_readonly')
            self.assertEqual(command[command.index('--max-turns')+1],'10')
            self.assertEqual(command[command.index('--run-budget')+1],'180')
            metadata=json.loads((Path(d)/'analysis'/payload['requestId']/'result.json').read_text())['native']
            self.assertEqual(metadata['requestedModel'],'gpt-5.6-luna');self.assertEqual(metadata['reasoningEffort'],'xhigh')
            self.assertFalse(metadata['automaticRetry'])
            reopened=m.NativeAnalysis(Path(d),3,resume_usage=True)
            self.assertEqual(reopened.started,1)
            with self.assertRaisesRegex(ValueError,'EXISTING_ATTEMPT_NO_AUTOMATIC_RETRY'):reopened.run(payload)
            self.assertEqual(popen.call_count,1)

if __name__=='__main__':unittest.main()
