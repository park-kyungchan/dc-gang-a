# Google Cloud bootstrap — Ganga Daechi Main Sheet

Observed 2026-09-27. This records the exact configuration created under the owner's `packr0723@gmail.com` account. It is not evidence that the academy integration or a Sheet cell write has run.

## Exact resources and state

| Resource | Identifier | Verified state |
| --- | --- | --- |
| Cloud project | `ganga-daechi-260927-p0723` (number `948206701032`) | `ACTIVE`; display name `Ganga Daechi Main Sheet`; `packr0723@gmail.com` has `roles/owner`. |
| Billing | Same project | `billingEnabled=false`; no billing account linked. |
| Workspace APIs | `sheets.googleapis.com`, `drive.googleapis.com` | Enabled and read back. |
| Keyless identity APIs | `iam.googleapis.com`, `iamcredentials.googleapis.com` | Enabled and read back. |
| Service account | `main-sheet-bot@ganga-daechi-260927-p0723.iam.gserviceaccount.com` | Exists; zero user-managed keys. |
| Impersonation permission | User `packr0723@gmail.com` on this service account | `roles/iam.serviceAccountTokenCreator` binding on the service account itself, read back. No project-wide impersonation grant. |
| Target Drive file | Spreadsheet `1R8DoOOo5yg3M1hgHPA0Vuqp3Ng-K5bQgxdiy5dEeXOg` | Bot has file-level `writer`, read back through Drive metadata. Existing `anyone: writer` file permission was not changed. |
| Target Main tab protection | `박경찬`, sheet ID `1754681846`, protected range ID `1054892822` | One enforced sheet-wide range remains. The protected-range editors include `packr0723@gmail.com`, the bot, and the file owner; a short-lived bot token returned `requestingUserCanEdit=true`. No cell write was attempted. |

The active Cloud SDK account is `packr0723@gmail.com`. The global default project was deliberately left unset; use an explicit `--project=ganga-daechi-260927-p0723` for administrative commands.

## Authentication path

The owner signed in to the Cloud SDK. For the bot, use IAM Credentials `generateAccessToken` with a short lifetime and the minimum Google Sheets/Drive scope required by the exact operation. The [read-only protection probe](probe_protection.py) demonstrates this path without printing or storing any token, editor list, cell value, or service account key. It first obtains a Cloud SDK user access token in process memory, mints a 600-second bot token with `spreadsheets.readonly`, then reads only sheet protection metadata.

Do not create or import a JSON service-account key as a shortcut. The target project already contains an older `config/service_account.json` path, but its contents, provenance, and active use were not inspected. This new bot is a separate, keyless identity.

## Verification boundary and next work

- **Configured/installed:** project, four enabled APIs, service account, narrow impersonation binding, bot file Writer, and protected-tab editor listing.
- **Callable/verified read:** a short-lived bot token obtained protected-range metadata via Sheets API; the exact target tab and `requestingUserCanEdit=true` were read back.
- **Academy-owned target write unverified:** no protected cell in the shared academy-owned workbook has been edited by the bot. No Apps Script, Cloud Run, Firestore, LMS write, or deployment was created.
- **Synthetic protected-cell write:** the separate owner-owned [Main Sheet v2 prototype](../main-sheet-v2/prototype-readback.md) shared the bot as Writer and protected its visible tab. `probe_bot_write.py` used short-lived keyless impersonation to write, exactly reread, clear, and reread empty one prototype cell. This does **not** establish a protected-cell write on the academy-owned workbook.
- **Cost boundary:** billing remains off. Evaluate whether a later hosting/database service needs billing before enabling or linking it. Standard Workspace API setup alone did not require a billing link in this bootstrap.
- **Freshness:** recheck project/account, enabled APIs, file sharing, protection ID/editors, and `requestingUserCanEdit` before any production Sheet update. The workbook is shared and can change concurrently.

Google references: [Cloud project creation](https://developers.google.com/workspace/guides/create-project), [service account access to a specific Sheet](https://developers.google.com/workspace/guides/create-credentials), [short-lived service account credentials](https://docs.cloud.google.com/iam/docs/create-short-lived-credentials-direct), and [protected-range API](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/sheets).
