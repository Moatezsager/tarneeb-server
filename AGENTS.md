# Authoritative Tarneeb server

- This repository is `Moatezsager/tarneeb-server`; sibling `../carrd-game` is the Godot source and `../tarneeb-web` is the compiled web client. Read `../PROJECT_CONTEXT.md` when available for the workspace runbook.
- Apply Ponytail full, Graphify for structure, and offline user-level Headroom for large outputs. Keep analysis local, exclude secrets, preserve uncommitted work, and never add analysis tools to runtime dependencies.
- Target runtime is Node 22 with Firebase Admin. `server.js` composes `http.js`, `service.js`, `engine.js`, administration, notifications and maintenance. Firestore holds durable data; HTTP `/online` verifies Firebase ID tokens.
- Current protocol is 3 and accepted game mode is FFA. `VERIFICATION.md` is historical and mentions protocol 2. Check current source and tests before changing rules or contracts.
- Local setup: `npm ci`, prepare private `.env` using `.env.example`, then `node --env-file=.env server.js`. `npm start` requires environment variables already supplied. Never commit `.env` or service-account credentials.
- `npm test` runs isolated tests but skips integration tests without emulators. Full suite: `firebase emulators:exec --config firebase.test.json --project demo-tarneeb-secure --only "firestore,auth" "npm test"` (Firebase CLI and Java required). Ports are 18881/18882.
- Keep `engine.js` compatible with Godot `scripts/tarneeb_rules.gd`; update `test/fixtures/rules-parity.json` from the Godot exporter when rules change. Graph locations can be stale: verify against current source.
- Render uses `render.yaml`, `/health`, and environment-provided credentials. `PUBLIC_ORIGIN` is the backend/admin origin; `WEB_ORIGINS` permits the web client. Coordinate incompatible client/server changes and Firestore rules. Preserve the existing Render Free/Firebase Spark approach.
- Save intended server files in their own commit; do not stage unrelated graph cache changes. Report commit, push, and deployment separately.
