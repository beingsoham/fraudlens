-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'ANALYST', 'INVESTIGATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DORMANT', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TransactionChannel" AS ENUM ('UPI_P2P', 'UPI_P2M', 'QR_CODE', 'COLLECT_REQUEST', 'AUTOPAY_MANDATE');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "RiskCategory" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED');

-- CreateEnum
CREATE TYPE "InvestigationOutcome" AS ENUM ('PENDING', 'CONFIRMED_FRAUD', 'LEGITIMATE', 'INCONCLUSIVE');

-- CreateEnum
CREATE TYPE "ScenarioLabel" AS ENUM ('NORMAL', 'HIGH_VALUE', 'RAPID_TRANSFER', 'NEW_DEVICE', 'SUSPICIOUS_RECEIVER', 'VOLUME_SPIKE');

-- CreateEnum
CREATE TYPE "LabelSource" AS ENUM ('SIMULATOR', 'INVESTIGATION');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "account_ref" VARCHAR(64) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_merchant" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "external_id" VARCHAR(64) NOT NULL,
    "sender_id" UUID NOT NULL,
    "receiver_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "device_fingerprint" VARCHAR(128) NOT NULL,
    "is_new_device" BOOLEAN NOT NULL DEFAULT false,
    "channel" "TransactionChannel" NOT NULL DEFAULT 'UPI_P2P',
    "status" "TransactionStatus" NOT NULL DEFAULT 'COMPLETED',
    "idempotency_key" VARCHAR(128),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_labels" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "label" "ScenarioLabel" NOT NULL,
    "source" "LabelSource" NOT NULL DEFAULT 'SIMULATOR',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_assessments" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "ruleset_version" VARCHAR(32) NOT NULL,
    "risk_score" INTEGER NOT NULL,
    "risk_category" "RiskCategory" NOT NULL,
    "triggered_rules" JSONB NOT NULL,
    "explanations" TEXT[],
    "features" JSONB,
    "assessed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "risk_assessment_id" UUID NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "outcome" "InvestigationOutcome" NOT NULL DEFAULT 'PENDING',
    "assigned_to_id" UUID,
    "resolved_by_id" UUID,
    "resolution_summary" VARCHAR(2000),
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigation_notes" (
    "id" UUID NOT NULL,
    "alert_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investigation_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_rules" (
    "id" UUID NOT NULL,
    "rule_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "weight" DECIMAL(5,2) NOT NULL,
    "config" JSONB NOT NULL,
    "ruleset_version" VARCHAR(32) NOT NULL,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fraud_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_settings" (
    "id" UUID NOT NULL,
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "medium_threshold" INTEGER NOT NULL,
    "high_threshold" INTEGER NOT NULL,
    "alert_threshold" INTEGER NOT NULL,
    "ruleset_version" VARCHAR(32) NOT NULL,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "risk_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" VARCHAR(64),
    "metadata" JSONB,
    "request_id" VARCHAR(64) NOT NULL,
    "ip_address" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_is_active_idx" ON "users"("is_active");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_account_ref_key" ON "accounts"("account_ref");

-- CreateIndex
CREATE INDEX "accounts_status_idx" ON "accounts"("status");

-- CreateIndex
CREATE INDEX "accounts_is_merchant_idx" ON "accounts"("is_merchant");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_external_id_key" ON "transactions"("external_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_idempotency_key_key" ON "transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "transactions_sender_id_occurred_at_idx" ON "transactions"("sender_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "transactions_receiver_id_occurred_at_idx" ON "transactions"("receiver_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "transactions_sender_id_receiver_id_occurred_at_idx" ON "transactions"("sender_id", "receiver_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "transactions_sender_id_device_fingerprint_idx" ON "transactions"("sender_id", "device_fingerprint");

-- CreateIndex
CREATE INDEX "transactions_occurred_at_idx" ON "transactions"("occurred_at" DESC);

-- CreateIndex
CREATE INDEX "transactions_created_at_idx" ON "transactions"("created_at" DESC);

-- CreateIndex
CREATE INDEX "transactions_status_idx" ON "transactions"("status");

-- CreateIndex
CREATE INDEX "transactions_amount_idx" ON "transactions"("amount");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_labels_transaction_id_key" ON "transaction_labels"("transaction_id");

-- CreateIndex
CREATE INDEX "transaction_labels_label_idx" ON "transaction_labels"("label");

-- CreateIndex
CREATE INDEX "transaction_labels_source_idx" ON "transaction_labels"("source");

-- CreateIndex
CREATE INDEX "risk_assessments_transaction_id_assessed_at_idx" ON "risk_assessments"("transaction_id", "assessed_at" DESC);

-- CreateIndex
CREATE INDEX "risk_assessments_risk_category_idx" ON "risk_assessments"("risk_category");

-- CreateIndex
CREATE INDEX "risk_assessments_risk_score_idx" ON "risk_assessments"("risk_score");

-- CreateIndex
CREATE INDEX "risk_assessments_assessed_at_idx" ON "risk_assessments"("assessed_at" DESC);

-- CreateIndex
CREATE INDEX "risk_assessments_ruleset_version_idx" ON "risk_assessments"("ruleset_version");

-- CreateIndex
CREATE INDEX "alerts_status_created_at_idx" ON "alerts"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "alerts_severity_created_at_idx" ON "alerts"("severity", "created_at" DESC);

-- CreateIndex
CREATE INDEX "alerts_outcome_idx" ON "alerts"("outcome");

-- CreateIndex
CREATE INDEX "alerts_assigned_to_id_status_idx" ON "alerts"("assigned_to_id", "status");

-- CreateIndex
CREATE INDEX "alerts_created_at_idx" ON "alerts"("created_at" DESC);

-- CreateIndex
CREATE INDEX "alerts_resolved_at_idx" ON "alerts"("resolved_at");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_transaction_assessment_key" ON "alerts"("transaction_id", "risk_assessment_id");

-- CreateIndex
CREATE INDEX "investigation_notes_alert_id_created_at_idx" ON "investigation_notes"("alert_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "investigation_notes_author_id_idx" ON "investigation_notes"("author_id");

-- CreateIndex
CREATE UNIQUE INDEX "fraud_rules_rule_id_key" ON "fraud_rules"("rule_id");

-- CreateIndex
CREATE INDEX "fraud_rules_enabled_idx" ON "fraud_rules"("enabled");

-- CreateIndex
CREATE INDEX "fraud_rules_ruleset_version_idx" ON "fraud_rules"("ruleset_version");

-- CreateIndex
CREATE UNIQUE INDEX "risk_settings_singleton_key" ON "risk_settings"("singleton");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_request_id_idx" ON "audit_logs"("request_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_labels" ADD CONSTRAINT "transaction_labels_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_risk_assessment_id_fkey" FOREIGN KEY ("risk_assessment_id") REFERENCES "risk_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_notes" ADD CONSTRAINT "investigation_notes_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_notes" ADD CONSTRAINT "investigation_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_rules" ADD CONSTRAINT "fraud_rules_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_settings" ADD CONSTRAINT "risk_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
