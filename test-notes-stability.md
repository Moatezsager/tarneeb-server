# Online stability — 2026-11-20

Online requests with the exact same token share an already-running Firebase revocation check. The promise is removed on success or failure; the next request checks revocation again. Different tokens remain isolated. Existing request concurrency limits bound pending checks. Admin authentication is unchanged.

Successful ordinary online responses expose `Server-Timing: auth;dur=..., operation;dur=...` through CORS. These durations contain no identities or game data. They separate identity verification from service/database work; they do not measure pure network RTT or include notification long-poll waiting.

The client retries the first failed room poll after 0.5–0.6 seconds rather than 2 seconds, with exponential backoff and jitter on subsequent failures. Quota failures retain the 60-second cooldown. Poll cadence on success, authoritative moves, request IDs and stale-response protection are unchanged.

Validation: full local Node suite 46 passed / 18 emulator-dependent skipped. Added overlap, token isolation, post-completion revocation and failed-check cleanup tests, plus timing-header assertions. Godot online-client suite passed with new retry-window and quota-cooldown checks. No production load or real mobile connection benchmark was performed; no numerical latency reduction is claimed.
