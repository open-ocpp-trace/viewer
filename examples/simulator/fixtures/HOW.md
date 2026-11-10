# How this capture was made

A genuine two charge point capture from the
[OCPP CP Simulator](https://github.com/shiv3/ocpp-cp-simulator), made on 2026-11-10 for
[#10](https://github.com/open-ocpp-trace/viewer/issues/10). It holds about 18 s of traffic, from
16:12:39.652Z to 16:12:57.798Z.

## Simulator

- Commit `00c45ae625af70a3173c560dcaa5a3cd6955e6c6`, run with no source changes (Bun 1.4.3).
- Server mode, one process, two charge points (`CP001`, `CP002`), OCPP 1.6J:

```sh
bun apps/cli/src/main.ts --http-port 9781 --cp-id CP --cp-count 2 \
  --cp-id-pattern 'CP{n:03}' --ws-url ws://127.0.0.1:9180/ocpp \
  --log-format json --trace-output simulator-trace.jsonl \
  > simulator-output.raw.log 2>&1
```

- Driven through the CLI client mode
  (`bun apps/cli/src/main.ts --http-url http://127.0.0.1:9781 --cp-id <CP> --send '<json>'`):
  `heartbeat`, `start_transaction {connector:1, tagId}`, `send_meter_value` and
  `stop_transaction` on each charge point, `data_transfer` on CP001, then `--stop`.

## CSMS

A minimal Bun WebSocket CSMS for OCPP 1.6J, written for this capture, since the simulator's own
test CSMSs cannot send the traffic below. It answers Boot (Accepted, `interval: 10`), Heartbeat,
Status, Authorize, Start/Stop and MeterValues, and answers DataTransfer with
`[4,id,"NotImplemented",...]`. Once both charge points have booted, it sends:

- `csms-0001`, in the same tick: GetConfiguration to CP001 and TriggerMessage (StatusNotification)
  to CP002;
- `csms-0002`: FooBar (an unknown action) to CP002, answered with a CALLERROR NotImplemented, and
  in the same tick a schema-breaking GetConfiguration (`key` is a string) to CP001, which the charge
  point answers under the default `--inbound-validation warn`, so its record carries
  `meta.validation`.

## Files

- `simulator-trace.jsonl`: the TraceWriter output, unmodified. 60 records, 30 per charge point.
- `simulator-logs.jsonl`: the simulator's merged stdout and stderr with its only non-JSON line
  removed (`[server] Shutting down...`). 160 lines, otherwise byte-identical: 60 wire lines
  (`Sent:` / `Received:`) and 100 others. 10 of them are `type: "Server"` lines without `cpId`.
- `csms-frames.jsonl`: the same 60 frames as the CSMS logged them (`out` is CSMS to charge point),
  in the order the CSMS observed them. The tests use it to replay the records in that order, where
  both colliding CALLs precede both answers.

## Counts (from simulator-trace.jsonl)

| CP    | direction  | messageType | count |
| ----- | ---------- | ----------- | ----- |
| CP001 | cp-to-csms | CALL        | 13    |
| CP001 | csms-to-cp | CALLRESULT  | 12    |
| CP001 | csms-to-cp | CALLERROR   | 1     |
| CP001 | csms-to-cp | CALL        | 2     |
| CP001 | cp-to-csms | CALLRESULT  | 2     |
| CP002 | cp-to-csms | CALL        | 13    |
| CP002 | csms-to-cp | CALLRESULT  | 13    |
| CP002 | csms-to-cp | CALL        | 2     |
| CP002 | cp-to-csms | CALLRESULT  | 1     |
| CP002 | cp-to-csms | CALLERROR   | 1     |

## Checks made on the capture

- The 60 wire log lines and the 60 trace records match one to one on (cpId, raw).
- Running the simulator's `logLinesToTrace(logs, { ocppVersion: "1.6" })` over
  `simulator-logs.jsonl` reproduces `simulator-trace.jsonl` record for record.
- Exactly one record has `meta.validation`: CP001's GetConfiguration `csms-0002`, with
  `{ mode: "warn", errorCode: "TypeConstraintViolation", description: "Invalid GetConfiguration payload: /key must be array" }`.
- The simulator's own message ids are UUID v4 and never collide across charge points; both
  collisions come from the CSMS.
- The periodic Heartbeat never fired during the run; both Heartbeats come from the `heartbeat`
  command.
