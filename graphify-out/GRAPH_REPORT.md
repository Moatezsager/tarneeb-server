# Graph Report - tarneeb-server  (2026-10-31)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 168 nodes · 294 edges · 9 communities
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 19 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d4c5fb30`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- integration.test.js
- service.js
- http.js
- engine.js
- google-login.test.js
- profile.js
- server.js
- services
- app.js

## God Nodes (most connected - your core abstractions)
1. `operate()` - 18 edges
2. `AppError` - 11 edges
3. `services` - 10 edges
4. `createService()` - 9 edges
5. `suit()` - 8 edges
6. `fail()` - 7 edges
7. `createHttpServer()` - 7 edges
8. `ai()` - 7 edges
9. `validateProfileEdit()` - 7 edges
10. `createAdmin()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `adminSession()` --calls--> `AppError`  [EXTRACTED]
  http.js → errors.js
- `validateProfileEdit()` --calls--> `AppError`  [EXTRACTED]
  profile.js → errors.js
- `operate()` --calls--> `completeProfile()`  [EXTRACTED]
  service.js → profile.js
- `operate()` --calls--> `validateProfileEdit()`  [EXTRACTED]
  service.js → profile.js
- `createAdmin()` --calls--> `AppError`  [EXTRACTED]
  admin.js → errors.js

## Import Cycles
- None detected.

## Communities (9 total, 0 thin omitted)

### Community 0 - "integration.test.js"
Cohesion: 0.09
Nodes (17): dependencies, firebase-admin@14.5.0, engines, node, main, name, private, scripts (+9 more)

### Community 1 - "service.js"
Cohesion: 0.19
Nodes (21): advance(), CATALOG, createService(), operate(), roomData(), saveRoom(), fail(), gate() (+13 more)

### Community 2 - "http.js"
Cohesion: 0.13
Nodes (13): createAdmin(), {Timestamp}, validId(), AppError, body(), createHttpServer(), adminSession(), http (+5 more)

### Community 3 - "engine.js"
Cohesion: 0.23
Nodes (20): act(), ai(), beats(), BIDS, cardName(), clone(), collect(), finish() (+12 more)

### Community 4 - "google-login.test.js"
Cohesion: 0.11
Nodes (9): assert, {readFileSync}, {test}, vm, assert, fixture, fs, path (+1 more)

### Community 5 - "profile.js"
Cohesion: 0.18
Nodes (11): completeProfile(), countries, validateProfileEdit(), validAvatar(), validName(), assert, {test}, assert (+3 more)

### Community 6 - "server.js"
Cohesion: 0.15
Nodes (14): parseOrigin(), adminUids, auth, cleanup, db, execute, {getAuth}, {getFirestore,Timestamp} (+6 more)

### Community 7 - "services"
Cohesion: 0.14
Nodes (13): key, sync, value, services, buildCommand, envVars, healthCheckPath, name (+5 more)

### Community 8 - "app.js"
Cohesion: 0.33
Nodes (7): actionButton(), api(), cell(), confirmAction(), load(), notice(), showLogin()

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `firebase-admin` connect `integration.test.js` to `service.js`, `http.js`, `server.js`?**
  _High betweenness centrality (0.108) - this node is a cross-community bridge._
- **Should `integration.test.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._
- **Why does `AppError` connect `http.js` to `service.js`, `profile.js`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Should `http.js` be split into smaller, more focused modules?**
  _Cohesion score 0.13043478260869565 - nodes in this community are weakly interconnected._
- **Why does `createService()` connect `service.js` to `integration.test.js`, `server.js`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Should `google-login.test.js` be split into smaller, more focused modules?**
  _Cohesion score 0.1111111111111111 - nodes in this community are weakly interconnected._
- **Should `services` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._