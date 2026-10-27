-- Integrity guarantees that the Prisma schema language cannot express:
-- CHECK constraints on financial and scoring columns, and database-level
-- enforcement of the append-only tables.

-- ---------------------------------------------------------------------------
-- Monetary and scoring invariants
-- ---------------------------------------------------------------------------

-- A transaction amount is always strictly positive. Enforced in the database
-- so that no code path -- including raw SQL or a future service -- can persist
-- a zero or negative payment.
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_amount_positive" CHECK ("amount" > 0);

-- Sender and receiver must differ. A self-transfer is not a meaningful payment
-- and would distort every per-account historical feature.
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_sender_receiver_differ" CHECK ("sender_id" <> "receiver_id");

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_currency_supported" CHECK ("currency" = 'INR');

-- Risk scores are integers on a closed 0..100 scale.
ALTER TABLE "risk_assessments"
  ADD CONSTRAINT "risk_assessments_score_range" CHECK ("risk_score" BETWEEN 0 AND 100);

-- A rule's weight is its maximum contribution to a 0..100 score.
ALTER TABLE "fraud_rules"
  ADD CONSTRAINT "fraud_rules_weight_range" CHECK ("weight" >= 0 AND "weight" <= 100);

-- ---------------------------------------------------------------------------
-- Risk settings: exactly one row, with consistent boundaries
-- ---------------------------------------------------------------------------

ALTER TABLE "risk_settings"
  ADD CONSTRAINT "risk_settings_singleton_true" CHECK ("singleton" = true);

ALTER TABLE "risk_settings"
  ADD CONSTRAINT "risk_settings_bounds" CHECK (
    "medium_threshold" BETWEEN 1 AND 100
    AND "high_threshold" BETWEEN 2 AND 100
    AND "alert_threshold" BETWEEN 1 AND 100
    AND "medium_threshold" < "high_threshold"
    AND "alert_threshold" >= "medium_threshold"
  );

-- ---------------------------------------------------------------------------
-- Alert workflow / outcome consistency
-- ---------------------------------------------------------------------------

-- Workflow status and investigation outcome are stored independently, but only
-- a resolved alert may carry a conclusive outcome, and a resolved alert must
-- record when and by whom it was resolved.
ALTER TABLE "alerts"
  ADD CONSTRAINT "alerts_resolution_consistent" CHECK (
    (
      "status" = 'RESOLVED'
      AND "outcome" <> 'PENDING'
      AND "resolved_at" IS NOT NULL
      AND "resolution_summary" IS NOT NULL
    )
    OR (
      "status" <> 'RESOLVED'
      AND "outcome" = 'PENDING'
    )
  );

ALTER TABLE "alerts"
  ADD CONSTRAINT "alerts_reopen_count_non_negative" CHECK ("reopen_count" >= 0);

-- ---------------------------------------------------------------------------
-- Append-only tables
-- ---------------------------------------------------------------------------

-- Audit events, investigation notes and risk assessments are historical
-- records. Blocking UPDATE and DELETE in the database means an application bug
-- -- or a compromised application account -- cannot quietly rewrite history.
CREATE OR REPLACE FUNCTION "fraudlens_block_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'Table % is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "fraudlens_block_mutation"();

CREATE TRIGGER "investigation_notes_append_only"
  BEFORE UPDATE OR DELETE ON "investigation_notes"
  FOR EACH ROW EXECUTE FUNCTION "fraudlens_block_mutation"();

-- Risk assessments are immutable: a re-assessment inserts a new row so the
-- score an alert was raised on stays reconstructable. DELETE is still allowed
-- so that cascading deletes from `transactions` continue to work.
CREATE TRIGGER "risk_assessments_immutable"
  BEFORE UPDATE ON "risk_assessments"
  FOR EACH ROW EXECUTE FUNCTION "fraudlens_block_mutation"();

-- ---------------------------------------------------------------------------
-- Supporting indexes for queries the ORM cannot express as model indexes
-- ---------------------------------------------------------------------------

-- Case-insensitive email lookup for login, so a differently-cased address
-- cannot be used to register a duplicate account.
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" (LOWER("email"));

-- Receiver fan-in over a rolling window: counts distinct senders per receiver.
CREATE INDEX "transactions_receiver_occurred_sender_idx"
  ON "transactions" ("receiver_id", "occurred_at" DESC, "sender_id");

-- Covers the "latest assessment per transaction" lookup used by every list view.
CREATE INDEX "risk_assessments_txn_assessed_score_idx"
  ON "risk_assessments" ("transaction_id", "assessed_at" DESC, "risk_score");

-- Open-alert queues filtered by assignee, which is the investigator's main view.
CREATE INDEX "alerts_open_queue_idx"
  ON "alerts" ("status", "severity", "created_at" DESC)
  WHERE "status" <> 'RESOLVED';
