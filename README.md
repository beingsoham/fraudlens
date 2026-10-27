# FraudLens

A real-time transaction risk monitoring and investigation platform for UPI-style
payments. FraudLens ingests financial transactions, scores them against a
configurable rule engine, explains every score, raises alerts, and gives
investigators the workflow to review them.

**FraudLens is an analytics and investigation system.** It never blocks a
payment, it is not connected to any payment network, and every account and
transaction it handles is synthetic. A risk score is a signal for human review —
it is not a finding of fraud, and the application is built throughout to keep
that distinction visible.

---

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Database schema](#database-schema)
- [Fraud detection methodology](#fraud-detection-methodology)
- [Risk scoring formula](#risk-scoring-formula)
- [Transaction ingestion pipeline](#transaction-ingestion-pipeline)
- [Transaction simulator](#transaction-simulator)
- [API reference](#api-reference)
- [Real-time events](#real-time-events)
- [Security model](#security-model)
- [Analytics: how to read the numbers](#analytics-how-to-read-the-numbers)
- [Testing](#testing)
- [Docker](#docker)
- [CI/CD](#cicd)
- [Repository layout](#repository-layout)
- [Limitations and future work](#limitations-and-future-work)

---

## What it does

### The problem

A payment network processes far more transactions than any team can review. The
job of a monitoring platform is to narrow millions of events down to the handful
a human should actually look at, and — just as importantly — to explain _why_
each one was selected, so the reviewer can agree or disagree with the machine
rather than simply defer to it.

That explanation requirement shapes most of the design decisions here. Every
score carries the evidence that produced it; every assessment is immutable so
the reason an alert fired stays reconstructable; and the conclusion a human
reaches is stored separately from the score that prompted the review.

### Three concepts, kept apart

The application is careful never to conflate these:

| Concept                 | What it means                                                               | Where it lives                                  |
| ----------------------- | --------------------------------------------------------------------------- | ----------------------------------------------- |
| **Suspicious activity** | The engine scored a transaction above a threshold. A statistical signal.    | `risk_assessments.risk_score` / `risk_category` |
| **An alert**            | That score was high enough to warrant a human looking at it. A work item.   | `alerts.status` (OPEN / IN_REVIEW / RESOLVED)   |
| **Confirmed fraud**     | A human investigator reviewed the evidence and concluded it was fraudulent. | `alerts.outcome` (CONFIRMED_FRAUD)              |

The dashboard reports all three, and only the third is ever described as fraud.
Workflow status and investigation outcome are separate columns with a database
CHECK constraint enforcing the valid combinations, because collapsing them makes
"closed" ambiguous between _"we decided it was fine"_ and _"nobody is working on
it"_.

### Features

- Transaction ingestion with idempotency and atomic persistence
- A deterministic, configurable eight-rule detection engine with full evidence
- Explainable risk scoring with correlated-indicator dampening
- Real-time monitoring over authenticated Socket.IO
- Alert queue with assignment, review states, append-only notes and reopening
- Account relationship graph built from stored transactions
- Analytics, detection-performance metrics and CSV export
- Role-based access control, audit logging and operational health checks
- A transaction simulator that uses the production ingestion path

---

## Architecture

A modular monolith: one API process, one React client, one PostgreSQL database.

```
┌──────────────┐        REST + WebSocket        ┌──────────────────────────┐
│  React (Vite)│ ─────────────────────────────▶ │  Express API             │
│  web client  │ ◀───────────────────────────── │                          │
└──────────────┘      httpOnly session cookie   │  ┌────────────────────┐  │
                                                │  │ auth / users       │  │
┌──────────────┐                                │  │ transactions       │  │
│  Simulator   │ ──── same ingestion path ────▶ │  │ fraud engine ◀─────┼──┼── pure, no I/O
│  (in-process)│                                │  │ alerts             │  │
└──────────────┘                                │  │ analytics          │  │
                                                │  │ audit              │  │
                                                │  └────────────────────┘  │
                                                └────────────┬─────────────┘
                                                             │ Prisma
                                                  ┌──────────▼───────────┐
                                                  │     PostgreSQL       │
                                                  │  CHECK constraints   │
                                                  │  append-only triggers│
                                                  └──────────────────────┘
```

### Module boundaries

The fraud engine (`apps/api/src/modules/fraud/`) is deliberately isolated:

- `rules.js` — the eight rules as **pure functions**. No I/O, no clock reads.
- `scoring.js` — the additive scoring policy, dampening and categorisation.
- `engine.js` — orchestration. Takes a transaction, a feature set and a ruleset;
  returns an assessment.
- `features.js` — the only part that touches the database, computing historical
  features from persisted rows.
- `ruleset.service.js` — loads configuration, with a short cache invalidated on
  every settings write.

Because the engine takes features as an argument rather than fetching them, it
is exhaustively unit-testable, and HTTP ingestion, the simulator and any future
batch re-assessment all share one implementation.

### Technology

**Frontend** React 18 · Vite · Tailwind CSS · React Router · Recharts ·
`@xyflow/react` · Socket.IO client · React Hook Form · Zod

**Backend** Node.js · Express 5 · PostgreSQL 16 · Prisma 7 · Socket.IO · Zod ·
JWT · bcrypt · Helmet · express-rate-limit · Pino

**Infrastructure** Docker · Docker Compose · GitHub Actions · ESLint · Prettier ·
Vitest · Supertest · React Testing Library

The entire application is JavaScript ES modules. There are no TypeScript source
files.

---

## Quick start

### Prerequisites

- Node.js 20.11 or newer (22 recommended)
- Docker, for PostgreSQL — or an existing PostgreSQL 14+ server

### 1. Install

```bash
npm install
```

### 2. Start PostgreSQL

```bash
docker run -d --name fraudlens-pg \
  -e POSTGRES_USER=fraudlens \
  -e POSTGRES_PASSWORD=fraudlens \
  -e POSTGRES_DB=fraudlens \
  -p 5433:5432 postgres:16-alpine
```

### 3. Configure

```bash
cp .env.example .env
```

Then replace the two placeholder secrets:

```bash
# Generate a value for each of JWT_SECRET and COOKIE_SECRET
openssl rand -base64 48
```

The API refuses to start in production with the example placeholders still in
place.

### 4. Migrate and seed

```bash
npm run prisma:generate   # generate the Prisma client
npm run prisma:deploy     # apply migrations
npm run seed              # ruleset, users and a synthetic dataset
```

### 5. Run

```bash
npm run dev               # API on :4000, web client on :5173
```

Open <http://localhost:5173>.

> The Vite dev server proxies `/api` and `/socket.io` to the API, so the browser
> sees a single origin and the session cookie stays first-party. Set `WEB_PORT`
> to run the client on a different port — for example `WEB_PORT=5174 npm run dev`
> — and add that origin to `WEB_ORIGIN` in `.env`.

### Development accounts

`npm run seed` creates one account per role. The passwords come from `.env`;
these are the defaults from `.env.example`:

| Email                          | Password                   | Role         | Can do                                                      |
| ------------------------------ | -------------------------- | ------------ | ----------------------------------------------------------- |
| `admin@fraudlens.local`        | `ChangeMe!Admin123`        | ADMIN        | Everything, including users, detection rules and audit logs |
| `analyst@fraudlens.local`      | `ChangeMe!Analyst123`      | ANALYST      | Monitor, manage alerts, run the simulator, export           |
| `investigator@fraudlens.local` | `ChangeMe!Investigator123` | INVESTIGATOR | Review alerts, write notes, record outcomes                 |
| `viewer@fraudlens.local`       | `ChangeMe!Viewer123`       | VIEWER       | Read-only                                                   |

These are local development credentials. Change them before exposing the
application anywhere.

### Resetting local data

```bash
./scripts/reset-dev-data.sh    # truncate every table and re-seed
```

This leaves the schema and migration history intact. It refuses to run with
`NODE_ENV=production`.

---

## Environment variables

Every variable is validated at startup by `apps/api/src/config/env.js`, which
exits with a readable report rather than failing later at the first request.
`.env.example` documents all of them; the ones that matter most:

| Variable                | Default                 | Purpose                                                                       |
| ----------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `DATABASE_URL`          | —                       | PostgreSQL connection string. Required.                                       |
| `TEST_DATABASE_URL`     | —                       | Separate database for the integration suite. Must differ from `DATABASE_URL`. |
| `JWT_SECRET`            | —                       | Signs session tokens. Minimum 32 characters.                                  |
| `COOKIE_SECRET`         | —                       | Signs the CSRF token. Must differ from `JWT_SECRET` in production.            |
| `WEB_ORIGIN`            | `http://localhost:5173` | Comma-separated CORS and Socket.IO allow-list.                                |
| `PORT`                  | `4000`                  | API port.                                                                     |
| `RISK_MEDIUM_THRESHOLD` | `30`                    | Score at which a transaction becomes MEDIUM risk.                             |
| `RISK_HIGH_THRESHOLD`   | `70`                    | Score at which it becomes HIGH risk.                                          |
| `ALERT_THRESHOLD`       | `70`                    | Score at which an alert is created.                                           |
| `RULESET_VERSION`       | `2026.10.1`             | Recorded on every assessment.                                                 |
| `SIMULATOR_MAX_RATE`    | `25`                    | Hard cap on the simulator's requested rate.                                   |
| `SEED_DEMO_DATA`        | `true`                  | Whether the seed generates synthetic transactions.                            |

Validation enforces the relationships between them, not just their types:
`RISK_MEDIUM_THRESHOLD < RISK_HIGH_THRESHOLD`, `ALERT_THRESHOLD >=
RISK_MEDIUM_THRESHOLD`, and so on. An inconsistent configuration fails at boot.

**Never commit a real `.env`.** It is in `.gitignore`.

---

## Database schema

PostgreSQL only. Every timestamp is `timestamptz` written in UTC; every monetary
amount is `NUMERIC(14,2)`, so no value is ever subject to binary floating-point
rounding.

### Tables

| Table                 | Holds                        | Notable constraints                                                             |
| --------------------- | ---------------------------- | ------------------------------------------------------------------------------- |
| `users`               | Operators and their roles    | Unique email, plus a unique index on `LOWER(email)`                             |
| `accounts`            | Synthetic payment accounts   | Unique `account_ref`; `is_merchant` flag                                        |
| `transactions`        | Ingested transactions        | Unique `external_id` and `idempotency_key`; `amount > 0`; sender ≠ receiver     |
| `transaction_labels`  | Ground-truth scenario labels | Separate table, so a label can never be mistaken for a prediction               |
| `risk_assessments`    | Immutable scoring records    | `risk_score BETWEEN 0 AND 100`; UPDATE blocked by trigger                       |
| `alerts`              | Work items                   | Unique `(transaction_id, risk_assessment_id)`; status/outcome consistency CHECK |
| `investigation_notes` | Case notes                   | Append-only: UPDATE and DELETE blocked by trigger                               |
| `fraud_rules`         | Rule configuration           | `weight BETWEEN 0 AND 100`                                                      |
| `risk_settings`       | Category boundaries          | Single row; ordering of thresholds enforced by CHECK                            |
| `audit_logs`          | Audit trail                  | Append-only: UPDATE and DELETE blocked by trigger                               |

### Integrity is enforced in the database, not only in code

Migration `20261027060000_constraints_and_immutability` adds what the Prisma
schema language cannot express:

- **CHECK constraints** on amounts, risk scores, rule weights, threshold
  orderings and alert status/outcome consistency.
- **Append-only triggers** on `audit_logs`, `investigation_notes` and (for
  UPDATE) `risk_assessments`. An application bug — or a compromised application
  account — cannot quietly rewrite history.
- **Supporting indexes** for the rolling-window feature queries, the receiver
  fan-in count, the latest-assessment lookup and the open-alert queue.

The integration suite asserts each of these by attempting the forbidden
operation in raw SQL and requiring it to fail.

### Why assessments are immutable

Re-assessing a transaction inserts a new `risk_assessments` row rather than
updating the existing one, and an alert references the specific assessment that
raised it. An investigator opening a six-month-old alert sees the score, the
rules and the evidence as they were at the time — not as they would be under
today's configuration. Changing a threshold is therefore never retroactive, and
the settings page says so.

---

## Fraud detection methodology

### Features are computed server-side, from persisted data

A client may not supply a risk score, a risk category, a triggered-rule list,
the `isNewDevice` flag, or any historical statistic. All of it is derived from
rows already in the database. The request schema is `.strict()`, so sending such
a field is a 400 rather than a silently-ignored value — otherwise a caller could
lower its own risk score simply by claiming a benign history.

### Window convention

Every rolling window is half-open — `(start, end]` — where `end` is the
evaluated transaction's own `occurredAt`. **The transaction being assessed is
always excluded from its own features.** At ingestion it is not yet persisted;
on re-assessment it is excluded explicitly by id. One convention across all
rules is what makes two assessments of the same transaction comparable.

### Insufficient history: abstain, do not guess

A rule returns one of three statuses:

- `TRIGGERED` — the pattern was found.
- `NOT_TRIGGERED` — the rule looked and this is normal.
- `ABSTAINED` — there is not enough history to judge.

Abstention is deliberately distinct from not triggering. _"This account has no
history, so I cannot tell"_ is different information from _"I looked and this is
fine"_, and conflating them would quietly make every new account look safe. The
explanation shown to investigators lists abstentions explicitly.

### The eight rules

| #   | Rule                           | Weight | Triggers when                                       | Abstains when                      |
| --- | ------------------------------ | ------ | --------------------------------------------------- | ---------------------------------- |
| 1   | High transaction amount        | 20     | Amount ≥ ₹50,000, scaling to ₹200,000               | —                                  |
| 2   | Unusual amount for this sender | 20     | Robust z-score ≥ 3 against the sender's own median  | Fewer than 5 prior transactions    |
| 3   | Excessive velocity             | 25     | ≥ 5 transactions in the preceding 10 minutes        | —                                  |
| 4   | Previously unseen device       | 15     | Device never used by this sender                    | Sender has no history at all       |
| 5   | Repeated rapid transfers       | 20     | ≥ 3 prior transfers on the same pair in 30 minutes  | —                                  |
| 6   | Suspicious receiver fan-in     | 25     | ≥ 8 distinct senders paid this receiver in 24 hours | Receiver is a merchant             |
| 7   | Unusual transaction time       | 10     | Hour accounts for < 5% of the sender's activity     | Fewer than 10 prior transactions   |
| 8   | Sudden activity increase       | 20     | 24-hour rate ≥ 3× the 14-day baseline               | Fewer than 7 baseline transactions |

**Rule 2 uses robust statistics** — median and median absolute deviation rather
than mean and standard deviation. Payment amounts are heavily skewed, and a
single large historical payment would inflate a standard deviation enough to
mask every subsequent anomaly.

**Rule 4 is dampened for new accounts** and abstains entirely for accounts with
no history, because every device is necessarily unseen for a brand-new account.

**Rule 6 abstains for merchants**, for which collecting from many distinct
senders is expected rather than suspicious.

**Rule 8 normalises both windows to a per-day rate** before comparing, so the
comparison is meaningful despite the windows differing in length.

> These weights and thresholds are **initial engineering parameters chosen for a
> demonstration dataset**. They are not validated financial risk thresholds and
> would need tuning against real labelled data before any operational use. The
> settings page repeats this warning.

---

## Risk scoring formula

### Additive, shaped, dampened, capped

**1. Each triggered rule earns a fraction of its weight.**

For threshold-shaped rules, the fraction starts at `0.5` the moment the
threshold is crossed and ramps linearly to `1.0` at the configured saturation
point:

```
fraction = 0.5 + 0.5 × clamp((value − threshold) / (saturation − threshold), 0, 1)
```

Crossing an operator-chosen threshold is itself the signal, so it earns half the
weight; the remainder reflects how far past it the value sits. A plain linear
ramp from zero would award almost nothing for just crossing the line, which
would make the configured threshold nearly meaningless.

**2. Correlated rules are dampened.**

Rules that measure the same underlying phenomenon are grouped. Within a group
the strongest contribution counts in full, the second at 50%, and any further
one at 25%:

| Group             | Rules                                   | Why                                                    |
| ----------------- | --------------------------------------- | ------------------------------------------------------ |
| `amount`          | High amount, Historical amount anomaly  | Both fire on the same scalar — this payment's amount   |
| `accountActivity` | High velocity, Sudden activity increase | Both say "this account is transacting more than usual" |

`RAPID_REPEATED_TRANSFERS` is deliberately **not** grouped. It measures
concentration on a single sender→receiver edge, which is different information:
a sender can have high velocity spread across ten counterparties with no
repetition, or repeat to one counterparty without crossing the velocity
threshold. Discounting it as redundant would systematically under-score
structuring, the one pattern it exists to catch.

**3. The total is capped at 100.**

```
score = min(100, round(Σ (fraction_i × weight_i × dampening_i)))
```

### Categories and alerting

| Score    | Category |                     |
| -------- | -------- | ------------------- |
| 0 – 29   | LOW      |                     |
| 30 – 69  | MEDIUM   |                     |
| 70 – 100 | HIGH     | An alert is created |

Boundaries are inclusive lower bounds and are configurable at
`PATCH /settings/risk`, validated as a complete set so they can never be stored
crossed.

Alert **severity** is assigned once at creation from the score that triggered
it, and never recomputed — so the urgency an investigator saw in their queue
stays reconstructable even if thresholds are later retuned.

### Determinism

Identical transaction inputs, historical features and ruleset version always
produce an identical score, category, rule list and explanation. The engine
reads no clock and performs no I/O.

---

## Transaction ingestion pipeline

`POST /api/v1/transactions/ingest`, and the simulator, both run this path.

1. Authenticate and authorise (`transactions:ingest`).
2. Validate the payload against the Zod schema (strict; unknown fields rejected).
3. Check for an existing `externalId` or `idempotencyKey` — a repeat returns the
   stored result with `200` rather than failing.
4. Resolve or create the sender and receiver accounts.
5. **Open a PostgreSQL transaction.**
6. Take a per-sender advisory lock (`pg_advisory_xact_lock`).
7. Re-check idempotency inside the lock.
8. Compute historical features from persisted rows.
9. Run the fraud engine.
10. Persist the transaction, the assessment, any alert, the ground-truth label
    and the audit events.
11. **Commit.**
12. Only then, emit the real-time events.
13. Return the transaction id, risk score, category and assessment summary.

### Why features are computed inside the transaction

Two concurrent payments from one account would otherwise each see a pre-burst
history and each under-count the other, so a rapid pair could both score as a
first transaction. The advisory lock serialises ingestion per sender while
leaving different senders fully concurrent.

### Why events are emitted after commit

Announcing from inside the transaction would let clients observe a transaction
that a rollback then erased. The pipeline never reports success before the
database has committed.

### Concurrency

The integration suite submits the same transaction ten times simultaneously and
asserts that exactly one row, one assessment and one alert exist afterwards —
one `201` and nine `200`s.

---

## Transaction simulator

A single in-process worker that generates synthetic transactions and feeds them
through the **same** ingestion pipeline as the HTTP endpoint: same validation,
same features, same engine, same atomic persistence, same events. There is no
separate "simulated" code path, which is the only way the simulator is useful as
a test of the real system.

### Controls

`POST /simulator/start` accepts a rate, an RNG seed, a scenario distribution and
an optional transaction limit. `GET /simulator/status` reports live counters.
Start is guarded synchronously before any `await`, so two concurrent requests
cannot both pass; stop is cooperative and waits for an in-flight tick, so the
process never exits mid-write.

### Reproducibility

The generator uses a seeded PRNG (mulberry32). The same seed, account roster and
scenario distribution emit exactly the same stream — which is what makes a
scenario re-runnable when investigating a defect.

### Scenarios and ground truth

`NORMAL`, `HIGH_VALUE`, `RAPID_TRANSFER`, `NEW_DEVICE`, `SUSPICIOUS_RECEIVER`
and `VOLUME_SPIKE`. The scenario that produced each transaction is written to
`transaction_labels` — a separate table from `risk_assessments`, so ground truth
can never contaminate a prediction.

Scenario weights are per **scenario instance**, not per transaction. That
distinction matters because the scenarios differ enormously in size: a `NORMAL`
instance is one payment, while a `SUSPICIOUS_RECEIVER` instance is a whole
mule-collection event of thirty to fifty. The defaults are chosen for the
transaction mix they produce.

### About the seeded dataset

`npm run seed` generates background activity plus **two pronounced
mule-collection incidents**. The ordinary scenario mix produces mostly
single-indicator anomalies, which correctly score LOW or MEDIUM against a
deliberately conservative alert threshold — and would leave a fresh database
with an almost empty alert queue. A real investigation tool is demonstrated
against its worst day, not its median one.

The incidents change **no rule weight and no threshold**. They emit the compound
behaviour a high score is supposed to describe — many victims, each drained over
several large transfers from a fresh device during quiet hours — and let the
unmodified engine score it on its merits.

The resulting mix is far more fraudulent than any real payment network. See
[Analytics](#analytics-how-to-read-the-numbers).

---

## API reference

All routes are prefixed `/api/v1`. Successful responses are `{ "data": ... }`,
paginated ones add `{ "meta": { page, pageSize, total, totalPages, ... } }`, and
errors are `{ "error": { code, message, requestId, details? } }`.

`/health` is the one exception: it returns a flat document, because a container
orchestrator probing it expects to read `.status` directly.

### Authentication

| Method | Path           | Permission    |
| ------ | -------------- | ------------- |
| `POST` | `/auth/login`  | —             |
| `POST` | `/auth/logout` | —             |
| `GET`  | `/auth/me`     | authenticated |

### Dashboard

| Method | Path                             | Permission       |
| ------ | -------------------------------- | ---------------- |
| `GET`  | `/dashboard/summary`             | `dashboard:read` |
| `GET`  | `/dashboard/transaction-series`  | `dashboard:read` |
| `GET`  | `/dashboard/risk-distribution`   | `dashboard:read` |
| `GET`  | `/dashboard/top-rules`           | `dashboard:read` |
| `GET`  | `/dashboard/alert-trend`         | `dashboard:read` |
| `GET`  | `/dashboard/recent-alerts`       | `dashboard:read` |
| `GET`  | `/dashboard/recent-transactions` | `dashboard:read` |

### Transactions and accounts

| Method | Path                                 | Permission            |
| ------ | ------------------------------------ | --------------------- |
| `GET`  | `/transactions`                      | `transactions:read`   |
| `GET`  | `/transactions/:id`                  | `transactions:read`   |
| `GET`  | `/transactions/:id/related`          | `transactions:read`   |
| `POST` | `/transactions/ingest`               | `transactions:ingest` |
| `GET`  | `/transactions/accounts/graph`       | `accounts:read`       |
| `GET`  | `/transactions/accounts/search`      | `accounts:read`       |
| `GET`  | `/transactions/accounts/:accountRef` | `accounts:read`       |

`GET /transactions` supports pagination, sorting by `occurredAt`, `amount`,
`riskScore`, `createdAt` or `status`, full-text search over the transaction id
and account references, and filters for risk category, status, channel, amount
range, score range, account and date range.

### Alerts and investigations

| Method  | Path                     | Permission             |
| ------- | ------------------------ | ---------------------- |
| `GET`   | `/alerts`                | `alerts:read`          |
| `GET`   | `/alerts/:id`            | `alerts:read`          |
| `GET`   | `/alerts/investigators`  | `alerts:read`          |
| `PATCH` | `/alerts/:id/assignment` | `alerts:assign`        |
| `PATCH` | `/alerts/:id/status`     | `alerts:update-status` |
| `POST`  | `/alerts/:id/notes`      | `alerts:note-create`   |
| `GET`   | `/alerts/:id/notes`      | `alerts:read`          |

### Analytics

| Method | Path                               | Permission         |
| ------ | ---------------------------------- | ------------------ |
| `GET`  | `/analytics/overview`              | `analytics:read`   |
| `GET`  | `/analytics/detection-performance` | `analytics:read`   |
| `GET`  | `/analytics/rule-performance`      | `analytics:read`   |
| `GET`  | `/analytics/score-histogram`       | `analytics:read`   |
| `GET`  | `/analytics/export/datasets`       | `analytics:export` |
| `GET`  | `/analytics/export`                | `analytics:export` |

### Simulator, settings, users, audit, health

| Method  | Path                      | Permission                          |
| ------- | ------------------------- | ----------------------------------- |
| `GET`   | `/simulator/status`       | `simulator:read`                    |
| `POST`  | `/simulator/start`        | `simulator:manage`                  |
| `POST`  | `/simulator/stop`         | `simulator:manage`                  |
| `GET`   | `/settings/rules`         | `settings:read`                     |
| `PATCH` | `/settings/rules/:ruleId` | `settings:write`                    |
| `PATCH` | `/settings/risk`          | `settings:write`                    |
| `GET`   | `/users`                  | `users:read`                        |
| `GET`   | `/users/:id`              | `users:read`                        |
| `POST`  | `/users`                  | `users:write`                       |
| `PATCH` | `/users/:id`              | `users:write`                       |
| `GET`   | `/audit-logs`             | `audit:read`                        |
| `GET`   | `/audit-logs/facets`      | `audit:read`                        |
| `GET`   | `/health`                 | — (detail requires `settings:read`) |
| `GET`   | `/health/live`            | —                                   |
| `GET`   | `/health/ready`           | —                                   |

### Example: ingesting a transaction

```bash
curl -X POST http://localhost:4000/api/v1/transactions/ingest \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "externalId": "TXN-2026-000001",
    "senderRef": "priya.9@fraudlens",
    "receiverRef": "aarav.8@fraudlens",
    "amount": 175000,
    "occurredAt": "2026-10-27T06:25:00Z",
    "deviceFingerprint": "dev-a1b2c3d4"
  }'
```

```jsonc
{
  "data": {
    "duplicate": false,
    "transaction": { "id": "…", "externalId": "TXN-2026-000001", "amount": 175000 },
    "assessment": {
      "riskScore": 55,
      "riskCategory": "MEDIUM",
      "rulesetVersion": "2026.10.1",
      "triggeredRuleIds": ["HIGH_AMOUNT", "NEW_DEVICE", "HISTORICAL_AMOUNT_ANOMALY"],
      "explanations": [
        "Risk score 55 of 100 (MEDIUM), from 3 triggered rules under ruleset 2026.10.1. A risk score indicates characteristics warranting review; it is not a finding of fraud.",
        "High transaction amount: Amount INR 175,000.00 is at or above the INR 50,000.00 high-amount threshold. (+17.5)",
      ],
    },
    "alert": null,
  },
}
```

A repeat of the same `externalId` returns `200` with `"duplicate": true` and the
originally stored result.

---

## Real-time events

Socket.IO at `/socket.io`, authenticated by the same session cookie or bearer
token as the REST API.

| Event                  | Room                                 | Payload                                               |
| ---------------------- | ------------------------------------ | ----------------------------------------------------- |
| `transaction:created`  | `room:transactions`                  | Transaction summary, no device fingerprint            |
| `transaction:assessed` | `room:transactions`                  | Score, category, triggered rule ids                   |
| `alert:created`        | `room:alerts`                        | Alert summary                                         |
| `alert:updated`        | `room:alerts` / `room:investigators` | Status and outcome; assignment only for investigators |
| `simulator:status`     | `room:simulator`                     | Worker state and counters                             |

### Subscription is server-decided

A client cannot request a room. On connect, the server reads the user's
permissions and joins the rooms they allow, which makes the room model an actual
authorization boundary rather than a convention the client is trusted to honour.
A VIEWER never receives assignment or resolution detail.

An investigator belongs to both the alerts and investigator rooms, so
`alert:updated` is emitted to the alerts room **excluding** investigators, and
separately to investigators with the richer payload — each client receives
exactly one event at the detail level their role allows.

### Reconnection

Events are treated as hints, never as the source of truth. On reconnect the
client refetches authoritative state over REST, because anything that happened
while the socket was down was never delivered. Lists show a "new transactions
have arrived" banner rather than splicing rows in under the reader's cursor.

---

## Security model

### Authentication

- bcrypt at cost factor 12.
- JWT in an `httpOnly`, `sameSite=lax` cookie, `secure` in production. The token
  is also returned in the body for non-browser clients to use as a bearer token.
- **The user record is re-read from the database on every request.** Deactivating
  an account or changing a role therefore takes effect immediately, rather than
  whenever the token happens to expire.
- Login failures return an identical message and do comparable work for an
  unknown address and a wrong password, so the response does not disclose which
  addresses are registered.

### CSRF

A signed double-submit token: an HMAC of the session's JWT id under a secret
distinct from the JWT secret. It is bound to the session, so a token minted for
one session cannot be replayed against another.

**The token is read from the `X-CSRF-Token` header only, never from the cookie.**
A cookie fallback would defeat the entire mechanism, because browsers attach
cookies to cross-site requests automatically. Bearer-authenticated clients are
exempt, since a cross-site request cannot carry a bearer token.

### Authorization

Four roles mapping to explicit permissions, enforced server-side on every route.
The frontend hides controls the user cannot use, but that is presentation only.

Record-level checks beyond the route permission:

- An alert cannot be assigned to a VIEWER or to a deactivated account.
- An administrator cannot change their own role or deactivate themselves.
- The last active administrator cannot be demoted or deactivated.
- The audit-log export dataset additionally requires `audit:read`.

### Other protections

- **Rate limiting** — global, plus a tighter limiter on authentication keyed by
  IP _and_ submitted email, so password guessing against one account cannot be
  spread across many source addresses.
- **Helmet** with a restrictive CSP; the API serves JSON, so nothing should ever
  be loaded from a response.
- **CORS** against an explicit allow-list, never a reflected origin — reflecting
  with `credentials: true` would let any site call the API with the user's
  cookies.
- **Request size limits** (256 KB by default).
- **Parameterised queries throughout.** The raw SQL used for the LATERAL joins
  passes every client value as a bind parameter via `Prisma.sql`, and sort
  columns and directions go through an allow-list.
- **CSV formula-injection protection** — any cell beginning `=`, `+`, `-`, `@`,
  tab or carriage return is prefixed with an apostrophe. Exports carry text an
  attacker can influence, and a `=HYPERLINK(...)` in a cell someone opens in
  Excel is a real exfiltration path.
- **Audit metadata allow-list** — only named keys are persisted, so a password,
  token or whole request body cannot be written into the audit trail by a
  careless call site.
- **Log redaction** — secrets are stripped in the logger itself rather than at
  each call site where it could be forgotten.
- **Safe errors** — stack traces, Prisma internals and raw SQL never cross the
  HTTP boundary. Every error carries a request id that correlates to the log and
  the audit row.

### Data handling

FraudLens stores no banking credentials, UPI PINs or payment secrets. Account
references are synthetic (`handle@fraudlens`) and deliberately not valid VPA
format. Device fingerprints are synthetic strings.

---

## Analytics: how to read the numbers

The analytics page separates two kinds of figure, and the distinction is the
point of the page's layout:

### Observed application statistics

Counts and sums measured from rows in this database. Always available, always
factual about _this deployment_. Every figure carries its definition, served
from the API alongside the number.

### Detection-performance metrics

Precision, recall, F1 and false-positive rate. These are **model evaluation**
figures and are reported only where reliable ground truth exists:

- They are **withheld entirely** when fewer than 50 labelled transactions are in
  range, rather than published at a sample size that would invite
  over-interpretation.
- The size and source of the labelled sample are always reported.
- A metric whose denominator is zero returns `null`, not `0`. Reporting zero
  precision for _"nothing was flagged"_ would be a false statement about the
  model rather than an honest absence of evidence.

Two ground-truth sources are available, and they answer different questions:

| Source          | What it is                                       | Caveat                                                                                                                                                        |
| --------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SIMULATOR`     | The scenario label the generator recorded        | Describes synthetic behaviour only; the simulated fraud rate is far higher than any real network                                                              |
| `INVESTIGATION` | The outcome a human recorded on a resolved alert | **Biased by construction** — only alerted transactions are ever investigated, so the sample contains almost no true negatives and recall is not interpretable |

The API returns these caveats with the data, and the UI displays them.

**No performance number in this application is invented, assumed, or carried
over from anywhere else.** The seeded dataset is a demonstration dataset, not a
sample of production traffic, and figures measured on it are a demonstration of
the metric rather than an estimate of production performance.

---

## Testing

```bash
npm test                    # everything
npm run test:api            # API unit + integration
npm run test:api:unit       # fraud engine, scoring, utilities (no database)
npm run test:api:integration # against PostgreSQL
npm run test:web            # React components
npm run verify              # lint + format + tests + build
```

### Setting up the test database

The integration suite needs its own database and **refuses to run** unless
`TEST_DATABASE_URL` is set and differs from `DATABASE_URL` — it truncates every
table it uses.

```bash
docker exec fraudlens-pg psql -U fraudlens -d postgres -c 'CREATE DATABASE fraudlens_test'
DATABASE_URL="postgresql://fraudlens:fraudlens@localhost:5433/fraudlens_test?schema=public" \
  npx prisma migrate deploy
```

### Coverage

**274 tests.**

Unit (91) — every rule's trigger, non-trigger and abstention paths; the scoring
policy including correlation dampening and category boundaries; robust
statistics; CSV escaping; deterministic RNG; UTC window arithmetic; audit
metadata sanitisation.

Integration (145), against real PostgreSQL — authentication and session
revocation; CSRF including cross-session replay; the full role matrix; ingestion
atomicity, idempotency and ten-way concurrency; historical feature correctness;
the complete alert workflow including reopening; append-only enforcement at the
database level; settings validation and cache invalidation; user administration
guards; simulator lifecycle; dashboard aggregation; detection-metric derivation;
CSV export and formula neutralisation; Socket.IO authentication and room
authorization.

Web (38) — formatting and status presentation; metric definitions reachable by
assistive technology; pagination; error and empty states; chart empty states.

Tests use an isolated database and deterministic fixtures. None is skipped or
weakened to obtain a passing run.

---

## Docker

```bash
# Secrets must be supplied; Compose refuses to start without them.
export JWT_SECRET=$(openssl rand -base64 48)
export COOKIE_SECRET=$(openssl rand -base64 48)
export SEED_ADMIN_PASSWORD='ChangeMe!Admin123'

docker compose up --build        # start
docker compose up -d --wait      # start detached, waiting for health
docker compose logs -f api       # follow the API log
docker compose down              # stop
docker compose down -v           # stop and delete the database volume
```

The web client is then at <http://localhost:8080> and the API at
<http://localhost:4000>. Override `WEB_PORT`, `API_PORT` and `POSTGRES_PORT` to
move them.

### Services

| Service    | Role                                                             |
| ---------- | ---------------------------------------------------------------- |
| `postgres` | PostgreSQL 16 with a persistent named volume                     |
| `migrate`  | Runs migrations and seeds, then exits                            |
| `api`      | The Express API                                                  |
| `web`      | nginx serving the built SPA and proxying `/api` and `/socket.io` |

Startup order is enforced by **health checks**, not `depends_on` alone: the API
waits for PostgreSQL to accept connections _and_ for the migration job to
complete successfully, so it never serves an unmigrated database. The web
container waits for the API to report ready.

Because nginx proxies the API, the browser talks to a single origin — the
session cookie stays first-party and production needs no CORS exception.

---

## CI/CD

`.github/workflows/ci.yml` runs on every push and pull request:

1. **quality** — `npm ci` from the lockfile, Prisma generate, ESLint, Prettier
   check, unit tests, web component tests.
2. **integration** — PostgreSQL service container, migrations applied to a test
   database, a **schema-drift check** (`prisma migrate diff --exit-code`, which
   fails if someone changed the schema without writing a migration), then the
   integration suite.
3. **build** — production web build, API module-load verification, bundle
   uploaded as an artifact.
4. **docker** — both images built (never pushed) and the Compose file validated.
5. **stack** — the whole stack brought up with `docker compose up --wait`, then
   smoke-tested: the API reports healthy, the web client is served, and sign-in
   works end to end through the nginx proxy.

Images are built to verify the Dockerfiles but **never published**, and nothing
is deployed. Publishing would require a configured registry and credentials,
which this repository deliberately does not assume.

---

## Repository layout

```
fraudlens/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── config/          env validation, logger, Prisma client
│   │   │   ├── middleware/      auth, CSRF, validation, rate limits, errors
│   │   │   ├── modules/
│   │   │   │   ├── alerts/      investigation workflow
│   │   │   │   ├── analytics/   aggregation, model evaluation, CSV export
│   │   │   │   ├── audit/       append-only audit trail
│   │   │   │   ├── auth/        tokens, sign-in
│   │   │   │   ├── dashboard/   overview aggregation
│   │   │   │   ├── fraud/       engine, rules, scoring, features, ruleset
│   │   │   │   ├── health/      liveness, readiness, component checks
│   │   │   │   ├── settings/    rule and threshold configuration
│   │   │   │   ├── simulator/   worker and scenario generator
│   │   │   │   ├── transactions/ingestion pipeline, read model, graph
│   │   │   │   └── users/       administration
│   │   │   ├── realtime/        Socket.IO server and emitters
│   │   │   ├── utils/           errors, money, time, stats, CSV, RNG
│   │   │   ├── app.js           Express application factory
│   │   │   └── server.js        process entry point
│   │   ├── tests/{unit,integration,helpers}/
│   │   └── Dockerfile
│   └── web/
│       ├── src/
│       │   ├── components/      ui, charts, layout, graph
│       │   ├── context/         auth and socket providers
│       │   ├── hooks/           data fetching
│       │   ├── layouts/         application shell
│       │   ├── pages/           one per route
│       │   ├── services/        API client and endpoint wrappers
│       │   ├── styles/          design tokens and glass treatment
│       │   └── utils/           formatting, status colour, date ranges
│       ├── tests/
│       ├── Dockerfile
│       └── nginx.conf
├── packages/shared/src/
│   ├── constants/               roles, enums, rule catalogue, metric definitions
│   └── schemas/                 Zod schemas shared by client and server
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.js
├── scripts/                     local data reset helpers
├── .github/workflows/ci.yml
├── docker-compose.yml
└── .env.example
```

The `@fraudlens/shared` package holds the Zod schemas and constants used by both
sides, so the client and server cannot disagree about what a valid payload is,
what a role may do, or what a metric means.

---

## Limitations and future work

Stated plainly, because a monitoring tool that overstates itself is worse than
one that does less.

### Known limitations

- **The simulator is single-process.** Its state lives in memory, so two API
  replicas would each run their own. A multi-replica deployment would need a
  database-backed lock or a dedicated worker process.
- **Logout does not invalidate the token.** The JWT remains cryptographically
  valid until it expires; the mitigations are a short lifetime and the
  per-request `isActive` check, which revokes a disabled account immediately. A
  token denylist would close this properly.
- **The rule parameters are not validated against real data.** They are
  engineering defaults chosen for a demonstration dataset.
- **The seeded dataset is far more fraudulent than reality.** It exists to
  populate every page on a fresh install. Detection metrics measured on it are a
  demonstration of the metric, not an estimate of production performance.
- **Investigation-sourced metrics are biased by construction**, since only
  alerted transactions are ever investigated. The API returns this caveat.
- **The relationship graph caps what it draws.** A fully-connected neighbourhood
  of more than a few dozen accounts cannot be read on one canvas, so the view is
  bounded and says when it has truncated.
- **No tenant isolation.** The application assumes a single organisation.
- **Analytics are computed per request.** At substantially larger volumes the
  aggregation queries would want materialised views or a rollup table.

### Natural next steps

- A token denylist, and refresh tokens with rotation.
- Rule back-testing: re-score a historical window under a candidate ruleset and
  compare outcomes before promoting it.
- Per-rule threshold tuning driven by investigator feedback.
- A separately justified ML scoring service alongside the rule engine, with the
  rule engine retained for explainability.
- Case management spanning multiple alerts — real investigations are rarely
  about a single transaction.
- Alert deduplication, so one incident does not produce fifty near-identical
  work items.

---

## Licence

Provided as-is for demonstration and educational purposes.
