# Integration verification — 2026-10-26

- Godot SERVER_URL points to https://tarneeb-server-kxqf.onrender.com; online operations use Firebase bearer tokens and protocol 2.
- Verified the deployed admin UI can restore its secure session and read live rooms, Firebase Authentication users and the audit collection. No accounts or gameplay records were changed during these production checks.
- Found legacy permissive Firestore rules still deployed and no composite indexes. Backed up the old rules locally in the Godot audit folder before deploying the tested rules and indexes for the named database.
- Read back the published rules and confirmed they match this repository. Rules now prevent client writes and private-hand reads; legacy direct-Firestore clients must migrate to the new Godot/server protocol.
- All 13 Node test groups passed with Firestore Emulator: profile/search IDs, bilateral friendships, invites, room concurrency, retries, turn ownership, private hands, host migration, cleanup races, admin actions, Google session handling and engine parity.
- Four Godot suites passed: online_client_test, auth_profile_test, cloud_test, firebase_test. These use mocks/isolated mode, not production player credentials.
- Use `firebase deploy --only firestore` from this repository. The installed Firebase CLI failed to prepare named-database targets when both firestore:rules and firestore:indexes were selected separately.

Limits: no live two-device match or production load test was run. Free-tier quotas still apply. Earlier requested expanded registration fields/avatar assets are not implemented by this integration verification; the current profile contract supports name, country, gender and avatar, but no age field.
