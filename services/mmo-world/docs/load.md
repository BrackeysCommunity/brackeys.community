# The load run

`harness load` presses a live world's buttons over HTTP at a fixed rate
and reads what every tick cost. It measures `load-tick-inside` (GDD 18.3):
at ten times the closed test's peak presses a minute, every tick finishes
inside one tick.

## Running it

Against a fresh local world at 3-second ticks, never a world players
keep:

```sh
MMO_KEPT=1 MMO_LOCAL_OUT=out/load PORT=18080 PGPORT=15439 REDISPORT=16389 MMO_TICK_SECONDS=3 \
  services/mmo-bot/scripts/local-world.sh
cd services/mmo-world
LOAD_URL=http://localhost:18080 MMO_API_TOKEN="$(cat ../../out/load/api-token)" MMO_OPERATOR_TOKEN=local-operator \
  LOAD_MINUTES=2 go run ./cmd/harness load -out <dir>
```

`harness all -live <url> -only load -out <dir>` runs the same as a suite
label (30 minutes).

| Setting                               | Default   | What                                                                                                                          |
| ------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `LOAD_URL`                            | `MMO_URL` | The world; the run refuses to start with neither                                                                              |
| `-n`                                  | 200       | Characters, made for the run (Discord ids `load-<run>-<i>`)                                                                   |
| `LOAD_SERVERS`                        | 2         | Servers the characters are split across (`load-a`, `load-b`, ...)                                                             |
| `LOAD_PPM`                            | 6000      | Presses a minute, released round-robin by a token bucket                                                                      |
| `LOAD_MINUTES`                        | 30        | The measured window; decimals allowed                                                                                         |
| `LOAD_RAMP`                           | off       | `1`: after the window, double the rate in 2-minute stages until a tick overruns or the client cannot keep up, for information |
| `MMO_API_TOKEN`, `MMO_OPERATOR_TOKEN` |           | The world's tokens (the first of a `new,old` pair is sent)                                                                    |

A press is one options read, then the action the character's agent
policy chooses, or nothing while its policy waits (a long action runs).
Each character has at most one press in flight; at most 32 workers. A
character takes at most about one action a tick, so many presses are reads
alone: the report counts presses, acted, refused and failed, by policy.

## The pass line

`load.md` in the out dir, the reading in `readings.json`, and a `load:`
line on stderr. It holds when:

- every tick in the window has `stepMs` under the world's tick (3,000 ms
  at 3-second ticks);
- the world is never more than 1 tick behind (`behind` at most 1);
- the client delivered at least 95% of the asked rate, else the reading
  is "not measured: the client reached only N a minute".

The value names the rate asked and delivered, the minutes, characters
and servers, the ticks read, the longest step against the tick and as a
share of production's 600-second tick, the most behind, and press p95.

## Reading the tick ring

`GET /v1/operator/ticks?after=N` (operator token) returns the world's
tick length in ms (`tickMs`) and its last 4,096 steps after tick `N`, each
with `advanceMs` (the sim's Advance alone), `stepMs` (the whole step:
waiting for the world's lock, Advance, the save and the map pass) and
`behind` (the due tick less the world's after the step). Without `after`
it returns all it holds. `mmo.tick.ms` and PostHog's `mmo_tick` keep
Advance's time; the event also carries `stepMs` and `behind`.

A step near the tick with a small `advanceMs` is time in the lock or the
save, which is the service's to fix, not a rule's.

## The peak

The default rate is provisional: 20 closed-test players at 30 presses a
minute each is 600 a minute, and the run asks ten times that. Once the
closed test has run, read its real peak from the export
([export.md](export.md)): `world.jsonl`'s highest `peakPerMinute` over the
second week. It counts commands; a press that only reads is not one, so
it is a floor on presses. Set `LOAD_PPM` to ten times it, and change the
`loadPPM` default in `harness/load.go` with its comment when the owner
takes the new peak.
