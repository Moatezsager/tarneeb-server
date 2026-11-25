# Fair bots and offline tuning

The server shuffles cards with cryptographic Fisher–Yates. Bot decisions receive no host identity, account data or opponents' hands. While choosing a swap, even the bot's own hidden hand is omitted. Every bot uses its own hand and public history independently; there is no exchange of private information between bots.

At the start of a round, the highest score determines the king. Ties are resolved by the first eligible seat after the dealer in play order. Equal-value swap targets also use relative play order. Neither choice prefers a fixed seat. This rule is mirrored in Godot and explained in the in-game rules.

Bots prioritize stopping the actual round king's outstanding contract and also pressure higher-scoring leaders. They retain card-conservation and nil-contract logic. Once a contract is fulfilled or impossible, they stop spending resources merely to deny it. They cannot guarantee defeating a king with a winning hand. All players, including a bot king, follow the same rules.

## Low-resource learning workflow

`bot-policy.json` is copied into each newly created match, retained across rounds, and omitted from client views. Godot ships an identical `data/bot-policy.json`. Existing server matches without a snapshot fall back to the shipped policy. There is no online training, extra database, polling, runtime model or external dependency.

Run manually away from production, using Node 22:

```sh
node tools/train-bots.js 256 /path/to/new-report.json
```

The tool creates synthetic, reproducible rounds, tests all four focal seats against three opponent pressure settings, and varies only two strategic weights. Its seeded generator is confined to the training tool; production dealing still uses cryptographic randomness. It checks legal actions and bounds each evaluation to 30 seconds and each round to 80 steps. Seed count is limited to 32–1000; reports refuse to overwrite an existing file.

Candidates must pass the strategy fixtures. Selection uses training seeds; validation uses separate held-out seeds. Promotion requires a positive lower 95% paired confidence bound on score-plus-king-denial utility, no lower mean score or king-failure rate, and mean decision time below 1 ms. The interval is an approximate diagnostic for these synthetic rounds, not a guarantee against humans or adversarial play. Never repeatedly tune against the same holdout to force a pass; a new experiment needs fresh reserved seeds.

Even an approved report does not change files or deploy. Review it, give the policy a unique version, update both policy files and the server policy fixture, rerun Godot strategic/rules tests, regenerate strategy and rules-parity fixtures, run server tests, export the web client, and deploy the repositories together. Keep the prior policy for rollback. This provides bounded offline improvement without changing bot behavior mid-match.

## First experiment — 2026-11-25

256 training and 256 held-out deals, four focal seats per deal. The training candidate (`kingPressure=140`, `preserveMaster=12`) failed validation: paired improvement −0.01172, approximate 95% interval [−0.04026, 0.01682]. It was rejected; the shipped policy remains `fair-king-v1` with king pressure 180, leader pressure 100 and master preservation 12. Mean decision time was about 0.02 ms locally; this is not a production latency measurement.

Future work should first add reviewed strategic fixtures for real failure cases, then expand reserved evaluation scenarios to complete matches, nil contracts, trump conservation and different opponent styles. Only after measured benefit should more expensive search or anonymized gameplay collection be considered. Continuous live learning and a new database are deliberately deferred.
