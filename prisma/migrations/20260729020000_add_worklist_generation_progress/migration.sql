ALTER TABLE "beneficiary_worklists"
    ADD COLUMN "generationCursor" TEXT,
    ADD COLUMN "generatedCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "beneficiary_worklists"
    ADD CONSTRAINT "beneficiary_worklists_generated_count_check"
    CHECK ("generatedCount" >= 0);

CREATE INDEX "beneficiary_worklists_generation_queue_idx"
    ON "beneficiary_worklists"(
        "organizationId",
        "generationComplete",
        "updatedAt"
    )
    WHERE "status" = 'DRAFT';
