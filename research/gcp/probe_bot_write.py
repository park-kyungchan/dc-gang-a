"""Reversible keyless bot write probe in the separate synthetic workbook only.

The academy-owned spreadsheet is not an allowed target for this script.
No access token, credential, student record, or cell content is printed.
"""

from __future__ import annotations

import json
import subprocess
import uuid

import requests


PROJECT = "ganga-daechi-260927-p0723"
BOT = f"main-sheet-bot@{PROJECT}.iam.gserviceaccount.com"
PROTOTYPE = "1Jyy4DkG4YjEU_rRe_sQuak4kcrpBBQsdFGSmPDgz5Jg"
MAIN_SHEET_ID = 16346331
CELL = "'박경찬'!A65"
BASE = f"https://sheets.googleapis.com/v4/spreadsheets/{PROTOTYPE}"


def get_token() -> str:
    user_token = subprocess.run(
        ["gcloud.cmd", "auth", "print-access-token"],
        check=True, capture_output=True, text=True, timeout=20,
    ).stdout.strip()
    response = requests.post(
        f"https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/{BOT}:generateAccessToken",
        headers={"Authorization": f"Bearer {user_token}"},
        json={"scope": ["https://www.googleapis.com/auth/spreadsheets"], "lifetime": "600s"},
        timeout=20,
    )
    response.raise_for_status()
    return response.json()["accessToken"]


def main() -> int:
    stage = "token"
    wrote = False
    cleared = False
    try:
        token = get_token()
        headers = {"Authorization": f"Bearer {token}"}
        stage = "protection"
        metadata = requests.get(
            BASE,
            params={"fields": "sheets(properties(sheetId),protectedRanges(protectedRangeId,range,warningOnly,requestingUserCanEdit))"},
            headers=headers, timeout=20,
        )
        metadata.raise_for_status()
        target = next(s for s in metadata.json()["sheets"] if s["properties"]["sheetId"] == MAIN_SHEET_ID)
        if not any(r.get("range", {}).get("sheetId") == MAIN_SHEET_ID and not r.get("warningOnly") and r.get("requestingUserCanEdit") for r in target.get("protectedRanges", [])):
            raise AssertionError("bot cannot edit enforced main-tab protection")
        url = f"{BASE}/values/{requests.utils.quote(CELL, safe='')}"

        def read() -> list[list[str]]:
            response = requests.get(url, headers=headers, timeout=20)
            response.raise_for_status()
            return response.json().get("values", [])

        stage = "preflight"
        if read():
            raise AssertionError("probe cell is occupied")
        marker = f"BOT_PROBE_{uuid.uuid4().hex}"
        stage = "write"
        response = requests.put(
            url, params={"valueInputOption": "RAW"},
            headers=headers, json={"values": [[marker]]}, timeout=20,
        )
        response.raise_for_status()
        wrote = True
        stage = "readback"
        if read() != [[marker]]:
            raise AssertionError("exact write readback mismatch")
        stage = "clear"
        response = requests.post(f"{url}:clear", headers=headers, json={}, timeout=20)
        response.raise_for_status()
        cleared = True
        stage = "empty_readback"
        if read():
            raise AssertionError("probe cell not empty after clear")
        print(json.dumps({"target": "synthetic_prototype_only", "protected_main_id": MAIN_SHEET_ID, "write_readback": True, "cleared_readback": True}))
        return 0
    except Exception as exc:
        if wrote and not cleared:
            try:
                requests.post(f"{url}:clear", headers=headers, json={}, timeout=20).raise_for_status()
                cleared = True
            except Exception:
                pass
        print(json.dumps({"target": "synthetic_prototype_only", "stage": stage, "error_type": type(exc).__name__, "cleanup_attempted": wrote, "cleanup_succeeded": cleared}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
