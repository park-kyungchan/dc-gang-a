"""Read protected-range metadata with a short-lived, keyless bot token.

No access token, editor list, cell value, or credential is printed or saved.
"""

from __future__ import annotations

import json
import subprocess

import requests


PROJECT = "ganga-daechi-260927-p0723"
BOT = f"main-sheet-bot@{PROJECT}.iam.gserviceaccount.com"
SPREADSHEET = "1R8DoOOo5yg3M1hgHPA0Vuqp3Ng-K5bQgxdiy5dEeXOg"
TARGET_SHEET_ID = 1754681846


def main() -> int:
    try:
        user_token = subprocess.run(
            ["gcloud.cmd", "auth", "print-access-token"],
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        ).stdout.strip()
        if not user_token:
            raise RuntimeError("missing_user_token")

        token_response = requests.post(
            f"https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/{BOT}:generateAccessToken",
            json={
                "scope": ["https://www.googleapis.com/auth/spreadsheets.readonly"],
                "lifetime": "600s",
            },
            headers={"Authorization": f"Bearer {user_token}"},
            timeout=20,
        )
        if token_response.status_code != 200:
            error = token_response.json().get("error", {})
            print(json.dumps({"stage": "impersonate", "http": token_response.status_code, "error_status": error.get("status")}))
            return 2

        bot_token = token_response.json()["accessToken"]
        sheet_response = requests.get(
            f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET}",
            params={
                "fields": "sheets(properties(sheetId,title),protectedRanges(protectedRangeId,range,warningOnly,editors,requestingUserCanEdit))"
            },
            headers={"Authorization": f"Bearer {bot_token}"},
            timeout=20,
        )
        data = sheet_response.json()
        if sheet_response.status_code != 200:
            error = data.get("error", {})
            print(json.dumps({"stage": "sheet_metadata", "http": sheet_response.status_code, "error_status": error.get("status")}))
            return 3

        target = next(
            (item for item in data.get("sheets", []) if item.get("properties", {}).get("sheetId") == TARGET_SHEET_ID),
            None,
        )
        if target is None:
            print(json.dumps({"stage": "sheet_metadata", "error": "target_sheet_absent"}))
            return 4
        ranges = target.get("protectedRanges", [])
        print(
            json.dumps(
                {
                    "stage": "sheet_metadata",
                    "http": sheet_response.status_code,
                    "target_sheet_id": TARGET_SHEET_ID,
                    "protected_ranges": len(ranges),
                    "protected_range_ids": [item.get("protectedRangeId") for item in ranges],
                    "sheet_wide_range_count": sum(
                        item.get("range", {}).get("sheetId") == TARGET_SHEET_ID
                        and not any(
                            key in item.get("range", {})
                            for key in ("startRowIndex", "endRowIndex", "startColumnIndex", "endColumnIndex")
                        )
                        for item in ranges
                    ),
                    "warning_only_count": sum(bool(item.get("warningOnly")) for item in ranges),
                    "bot_can_edit_all_protections": all(
                        bool(item.get("requestingUserCanEdit")) for item in ranges
                    ),
                    "editor_user_count": sum(
                        len(item.get("editors", {}).get("users", [])) for item in ranges
                    ),
                    "bot_listed_as_editor": any(
                        BOT in item.get("editors", {}).get("users", []) for item in ranges
                    ),
                    "packr_listed_as_editor": any(
                        "packr0723@gmail.com" in item.get("editors", {}).get("users", [])
                        for item in ranges
                    ),
                }
            )
        )
        return 0
    except Exception as exc:
        print(json.dumps({"stage": "local", "error_type": type(exc).__name__}))
        return 5


if __name__ == "__main__":
    raise SystemExit(main())
