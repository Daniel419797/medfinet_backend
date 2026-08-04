CREATE TABLE "security_rate_limit_buckets" (
  "scope" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "windowStart" TIMESTAMPTZ(3) NOT NULL,
  "requestCount" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "security_rate_limit_buckets_pkey"
    PRIMARY KEY ("scope", "keyHash", "windowStart"),
  CONSTRAINT "security_rate_limit_buckets_scope_check"
    CHECK ("scope" ~ '^[a-z][a-z0-9:-]{1,79}$'),
  CONSTRAINT "security_rate_limit_buckets_hash_check"
    CHECK ("keyHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "security_rate_limit_buckets_count_check"
    CHECK ("requestCount" > 0),
  CONSTRAINT "security_rate_limit_buckets_expiry_check"
    CHECK ("expiresAt" > "windowStart")
);

CREATE INDEX "security_rate_limit_buckets_expiresAt_idx"
  ON "security_rate_limit_buckets"("expiresAt");
