ALTER TABLE "ussd_otp_challenges" ADD COLUMN "sourceSessionId" TEXT;
CREATE UNIQUE INDEX "ussd_otp_challenges_sourceSessionId_key"
  ON "ussd_otp_challenges"("sourceSessionId");
