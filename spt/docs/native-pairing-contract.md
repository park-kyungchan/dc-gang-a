# Local native pairing contract (draft, 2026-09-27)

This is a source-level contract for a future bundled iOS client. The current
`spt_native_runner.py` still binds the gateway and Worker to `127.0.0.1`. No
tailnet HTTPS API route, durable service, installed iOS app, or TestFlight build
is established by this change. The hosted Sites custom-access identity remains
separate.

## Client sequence

The bundle uses the exact `capacitor://localhost` Origin. Its API base URL must
be a separately verified private HTTPS gateway address; it must never point at
the Worker port or a public Sites URL. WKWebView must emit that exact Origin
for cross-origin fetches; browser JavaScript cannot set the Origin header.
The gateway returns `Access-Control-Allow-Origin: capacitor://localhost` and
supports only GET/POST with `Authorization`, `Content-Type`, and `Accept` in
preflight. It does not allow CORS credentials or a wildcard origin.

1. `POST /native/pair/request` with `Content-Type: application/json` and the
   exact body `{}` returns a pending code, a random `deviceSecret`, and the
   pending expiry. It returns no cookie or student data. The teacher confirms
   the displayed code through the existing operator approval command. The
   code alone is never a credential.
2. `GET /native/pair/status` with `Authorization: Bearer <deviceSecret>`
   returns pending, approved, expired, or missing. Only an explicitly approved
   native device can proceed.
3. `POST /native/session` with the same Authorization header and an empty body
   returns a 15-minute `accessToken`, absolute expiry, and the gateway's exact
   owner key. The server stores only token hashes. The client verifies the
   owner key against its local outbox partition before any queued upload.
4. `/api/*` calls use `Authorization: Bearer <accessToken>` and the exact native
   Origin. They never send cookies. Before every upstream call, the gateway
   checks the session and its parent device; it checks again before returning
   the upstream response. It strips caller Authorization, Cookie, Site identity,
   forwarded-host, and backend-token headers and supplies only its own
   internal Worker proof and loopback Origin.
5. On expiry, obtain a new short session with the approved device secret.
   `POST /native/session/revoke` with the access token revokes that session.
   The existing operator device revoke command rejects new requests for all
   sessions of that code immediately. A request already forwarded to the
   Worker can still commit while revocation is racing; the gateway may return
   403 after that commit. Treat such a result as an **unknown effect**: retain
   the original request ID and local job, then reauthenticate and read back
   the exact server record before any retry. Neither refresh nor read extends
   the device grant. Strictly preventing in-flight post-revoke effects would
   require serialized revocation or a Worker-side authorization check.

The future iOS implementation must keep `deviceSecret` in app-private secure
storage such as Keychain, with the access token in memory, never in a URL,
WKWebView cookie, log, or bundled source. On relaunch, it must verify the
server owner before reconciling local records. Pending requests and rejected
sessions must not fetch student data. The browser `/auth/request`,
`/auth/status`, SameSite HttpOnly cookie, and same-origin write rule continue
to operate independently.

## Voice Memos original transfer

The bundled client may call `POST /api/audio-transfer/grant` and
`POST /api/audio-transfer/revoke` with the native Origin, a valid native
session bearer, and the existing `{ "id": "<importId>" }` body. The gateway
checks the exact audio-import row before issuing a scoped transfer token.
`GET /api/audio-transfer/status` and `POST /api/audio-transfer/upload` also
require the native Origin, current session bearer, and `X-SPT-Transfer` token
bound to the same approved device. Upload additionally sends the existing
`X-SPT-Filename` header. Preflight admits these two transfer headers only on
the audio-transfer path. The browser cookie and no-Origin delegated shortcut
flows retain their existing contracts.

The transfer token alone does not authorize native upload after session expiry
or device revocation. Renew the session, retain the original import ID and
local recording, then check status before retrying the same bytes. A lost
response or a revoke race leaves the result unknown until exact server
readback. The receipt's `returnURL` points to the browser interface; the
native client uses the receipt's `importId`, `sessionId`, `studentId`, and
`classDate` to reconcile its own draft without opening that URL. Do not delete
the Voice Memos original based only on a client-side upload completion.

## Gates still required

Confirm the signed app's actual Origin and private HTTPS URL on a physical
iPhone. Verify Tailscale identity and route, TLS, service lifecycle, device
approval and revoke, expiry, app relaunch, offline queue, exact D1/R2 readback,
and cookie/browser regression on that target before any deployment claim.
