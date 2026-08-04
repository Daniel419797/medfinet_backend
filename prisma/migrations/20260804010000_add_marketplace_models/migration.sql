-- CreateTable
CREATE TABLE "hospitals" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "website" TEXT NOT NULL DEFAULT '',
    "establishedYear" INTEGER,
    "bedCount" INTEGER NOT NULL DEFAULT 0,
    "specialties" JSONB NOT NULL,
    "street" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT '',
    "zipCode" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT 'Nigeria',
    "adminName" TEXT NOT NULL DEFAULT '',
    "adminEmail" TEXT NOT NULL DEFAULT '',
    "adminPhone" TEXT NOT NULL DEFAULT '',
    "adminTitle" TEXT NOT NULL DEFAULT '',
    "walletAddress" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hospitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_workers" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "walletAddress" TEXT NOT NULL,
    "facilityName" TEXT NOT NULL DEFAULT '',
    "facilityType" TEXT NOT NULL DEFAULT '',
    "licenseNumber" TEXT NOT NULL DEFAULT '',
    "specialization" TEXT NOT NULL DEFAULT '',
    "professionalRole" TEXT NOT NULL DEFAULT '',
    "verificationStatus" TEXT NOT NULL DEFAULT 'pending',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemedicine_doctors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specialty" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "experience" INTEGER NOT NULL DEFAULT 0,
    "avatar" TEXT NOT NULL DEFAULT '',
    "available" BOOLEAN NOT NULL DEFAULT true,
    "price" DOUBLE PRECISION NOT NULL,
    "nextAvailable" TIMESTAMP(3),

    CONSTRAINT "telemedicine_doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemedicine_consultations" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "price" DOUBLE PRECISION NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telemedicine_consultations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_policies" (
    "id" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "premium" DOUBLE PRECISION NOT NULL,
    "frequency" TEXT NOT NULL,
    "coverage" JSONB NOT NULL,
    "benefits" JSONB NOT NULL,
    "documents" JSONB NOT NULL,
    "nextPaymentDate" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_claims" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "claimNumber" TEXT NOT NULL,
    "patientName" TEXT NOT NULL,
    "serviceDate" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "submissionDate" TEXT NOT NULL,
    "documents" JSONB NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_payments" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentDate" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',

    CONSTRAINT "insurance_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "patientName" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "issueDate" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'tokenized',
    "tokenId" TEXT NOT NULL,
    "blockchainHash" TEXT NOT NULL,
    "tokenizationDate" TEXT NOT NULL,
    "fundingOptions" TEXT NOT NULL,
    "funderWallet" TEXT,
    "fundedAmount" DOUBLE PRECISION,
    "fundedAt" TIMESTAMP(3),
    "fundedBy" TEXT,
    "organizationId" TEXT NOT NULL DEFAULT 'ORG-001',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "thumbnail" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_designs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "thumbnail" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastModified" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_designs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "childName" TEXT NOT NULL,
    "vaccinations" JSONB NOT NULL,
    "templateId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_packages" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "category" TEXT NOT NULL,
    "image" TEXT NOT NULL DEFAULT '',
    "impact" TEXT NOT NULL DEFAULT '',
    "goal" DOUBLE PRECISION NOT NULL,
    "funded" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_packages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hospitals_email_key" ON "hospitals"("email");

-- CreateIndex
CREATE UNIQUE INDEX "hospitals_walletAddress_key" ON "hospitals"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "health_workers_email_key" ON "health_workers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "health_workers_walletAddress_key" ON "health_workers"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_policies_policyNumber_key" ON "insurance_policies"("policyNumber");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_claims_claimNumber_key" ON "insurance_claims"("claimNumber");

-- AddForeignKey
ALTER TABLE "telemedicine_consultations" ADD CONSTRAINT "telemedicine_consultations_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "telemedicine_doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "insurance_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_payments" ADD CONSTRAINT "insurance_payments_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "insurance_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
