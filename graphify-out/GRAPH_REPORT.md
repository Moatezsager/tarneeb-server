# Graph Report - tarneeb-server  (2026-10-31)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 171 nodes · 294 edges · 10 communities
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 19 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0f19d97b`
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
- google-login.test.js

## God Nodes (most connected - your core abstractions)
1. `operate()` - 18 edges
2. `AppError` - 10 edges
3. `services` - 10 edges
4. `createService()` - 9 edges
5. `suit()` - 8 edges
6. `fail()` - 7 edges
7. `ai()` - 7 edges
8. `createHttpServer()` - 7 edges
9. `createAdmin()` - 6 edges
10. `act()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `createAdmin()` --calls--> `AppError`  [EXTRACTED]
  admin.js → errors.js
- `adminSession()` --calls--> `AppError`  [EXTRACTED]
  http.js → errors.js
- `validateProfileEdit()` --calls--> `AppError`  [EXTRACTED]
  profile.js → errors.js
- `operate()` --calls--> `completeProfile()`  [EXTRACTED]
  service.js → profile.js
- `operate()` --calls--> `validateProfileEdit()`  [EXTRACTED]
  service.js → profile.js

## Import Cycles
- None detected.

## Communities (10 total, 0 thin omitted)

### Community 0 - "integration.test.js"
Cohesion: 0.16
Nodes (21): advance(), CATALOG, createService(), operate(), roomData(), saveRoom(), fail(), gate() (+13 more)

### Community 1 - "service.js"
Cohesion: 0.10
Nodes (11): createAdmin(), {Timestamp}, validId(), assert, {test}, assert, {getFirestore,Timestamp}, {initializeApp,deleteApp} (+3 more)

### Community 2 - "http.js"
Cohesion: 0.23
Nodes (20): act(), ai(), beats(), BIDS, cardName(), clone(), collect(), finish() (+12 more)

### Community 3 - "engine.js"
Cohesion: 0.13
Nodes (13): AppError, body(), createHttpServer(), adminSession(), http, path, {readFileSync}, statusCodes (+5 more)

### Community 4 - "google-login.test.js"
Cohesion: 0.18
Nodes (11): completeProfile(), countries, validateProfileEdit(), validAvatar(), validName(), assert, {test}, assert (+3 more)

### Community 5 - "profile.js"
Cohesion: 0.15
Nodes (14): parseOrigin(), adminUids, auth, cleanup, db, execute, {getAuth}, {getFirestore,Timestamp} (+6 more)

### Community 6 - "server.js"
Cohesion: 0.14
Nodes (13): key, sync, value, services, buildCommand, envVars, healthCheckPath, name (+5 more)

### Community 7 - "services"
Cohesion: 0.18
Nodes (11): dependencies, firebase-admin@14.5.0, engines, node, main, name, private, scripts (+3 more)

### Community 8 - "app.js"
Cohesion: 0.33
Nodes (7): actionButton(), api(), cell(), confirmAction(), load(), notice(), showLogin()

### Community 9 - "google-login.test.js"
Cohesion: 0.20
Nodes (4): assert, {readFileSync}, {test}, vm

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `firebase-admin` connect `services` to `integration.test.js`, `service.js`, `profile.js`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Should `service.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09881422924901186 - nodes in this community are weakly interconnected._
- **Why does `AppError` connect `engine.js` to `service.js`, `google-login.test.js`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Should `engine.js` be split into smaller, more focused modules?**
  _Cohesion score 0.12631578947368421 - nodes in this community are weakly interconnected._
- **Why does `createService()` connect `integration.test.js` to `service.js`, `profile.js`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Should `server.js` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._