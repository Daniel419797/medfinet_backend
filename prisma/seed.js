const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.hospital.createMany({
    data: [
      {
        id: 'hospital-001',
        name: 'Lagos University Teaching Hospital (LUTH)',
        type: 'Teaching Hospital',
        email: 'info@luth.lagos.gov.ng',
        phone: '+234-1-234-5678',
        website: 'https://www.luth.lagos.gov.ng',
        establishedYear: 1962,
        bedCount: 2000,
        specialties: ['Cardiology', 'Oncology', 'Neurology', 'Pediatrics', 'Orthopedics', 'General Surgery'],
        street: 'Idi-Araba, Mushin',
        city: 'Lagos',
        state: 'Lagos',
        zipCode: '100221',
        country: 'Nigeria',
        adminName: 'Prof. Christopher Bode',
        adminEmail: 'admin@luth.lagos.gov.ng',
        adminPhone: '+234-1-234-5680',
        adminTitle: 'Chief Medical Director',
        walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
        status: 'verified',
        verified: true,
        createdAt: '2024-01-15T08:30:00.000Z',
      },
      {
        id: 'hospital-002',
        name: 'Reddington Hospital',
        type: 'Multi-Specialist Hospital',
        email: 'info@reddingtonhospital.com',
        phone: '+234-1-628-0000',
        website: 'https://www.reddingtonhospital.com',
        establishedYear: 1998,
        bedCount: 350,
        specialties: ['Cardiology', 'Cardiac Surgery', 'Internal Medicine', 'Diagnostic Imaging', 'Emergency Medicine'],
        street: '12 Idowu Martins Street, Victoria Island',
        city: 'Lagos',
        state: 'Lagos',
        zipCode: '101241',
        country: 'Nigeria',
        adminName: 'Dr. Michael Omololu',
        adminEmail: 'admin@reddingtonhospital.com',
        adminPhone: '+234-1-628-0001',
        adminTitle: 'Medical Director',
        walletAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        status: 'verified',
        verified: true,
        createdAt: '2024-02-20T10:00:00.000Z',
      },
      {
        id: 'hospital-003',
        name: 'Mecure Healthcare Limited',
        type: 'General Hospital',
        email: 'info@mecurehealthcare.com',
        phone: '+234-1-460-0000',
        website: 'https://www.mecurehealthcare.com',
        establishedYear: 1987,
        bedCount: 500,
        specialties: ['General Medicine', 'Surgery', 'Obstetrics & Gynecology', 'Pediatrics', 'Radiology', 'Laboratory Services'],
        street: '50 Isaac John Street, GRA Ikeja',
        city: 'Lagos',
        state: 'Lagos',
        zipCode: '101233',
        country: 'Nigeria',
        adminName: 'Dr. Adebayo Adebiyi',
        adminEmail: 'admin@mecurehealthcare.com',
        adminPhone: '+234-1-460-0001',
        adminTitle: 'Group Managing Director',
        walletAddress: '0x9876543210fedcba9876543210fedcba98765432',
        status: 'pending',
        verified: false,
        createdAt: '2024-03-10T14:15:00.000Z',
      },
    ],
    skipDuplicates: true,
  });

  await prisma.healthWorker.createMany({
    data: [
      {
        id: 'worker-001',
        firstName: 'Adaeze',
        lastName: 'Okonkwo',
        email: 'adaeze.okonkwo@luth.lagos.gov.ng',
        phone: '+234-803-123-4567',
        walletAddress: '0x1111111111111111111111111111111111111111',
        facilityName: 'Lagos University Teaching Hospital (LUTH)',
        facilityType: 'Teaching Hospital',
        licenseNumber: 'MDCN/LUTH/2020/001',
        specialization: 'Cardiology',
        professionalRole: 'Consultant Cardiologist',
        verificationStatus: 'verified',
        status: 'active',
        createdAt: '2024-01-20T09:00:00.000Z',
      },
      {
        id: 'worker-002',
        firstName: 'Emeka',
        lastName: 'Adeyemi',
        email: 'emeka.adeyemi@reddingtonhospital.com',
        phone: '+234-805-234-5678',
        walletAddress: '0x2222222222222222222222222222222222222222',
        facilityName: 'Reddington Hospital',
        facilityType: 'Multi-Specialist Hospital',
        licenseNumber: 'MDCN/RED/2019/045',
        specialization: 'Internal Medicine',
        professionalRole: 'Senior Registrar',
        verificationStatus: 'verified',
        status: 'active',
        createdAt: '2024-02-25T11:30:00.000Z',
      },
      {
        id: 'worker-003',
        firstName: 'Ngozi',
        lastName: 'Ibrahim',
        email: 'ngozi.ibrahim@mecurehealthcare.com',
        phone: '+234-807-345-6789',
        walletAddress: '0x3333333333333333333333333333333333333333',
        facilityName: 'Mecure Healthcare Limited',
        facilityType: 'General Hospital',
        licenseNumber: 'MDCN/MEC/2021/012',
        specialization: 'Obstetrics & Gynecology',
        professionalRole: 'Medical Officer',
        verificationStatus: 'pending',
        status: 'active',
        createdAt: '2024-03-15T13:45:00.000Z',
      },
    ],
    skipDuplicates: true,
  });

  await prisma.telemedicineDoctor.createMany({
    data: [
      { id: 'doctor-001', name: 'Dr. Adaeze Okonkwo', specialty: 'Pediatrics', rating: 4.9, experience: 12, avatar: '', available: true, price: 15000, nextAvailable: '2026-08-05T09:00:00.000Z' },
      { id: 'doctor-002', name: 'Dr. Emeka Adeyemi', specialty: 'General Practice', rating: 4.7, experience: 8, avatar: '', available: true, price: 10000, nextAvailable: '2026-08-05T10:30:00.000Z' },
      { id: 'doctor-003', name: 'Dr. Funmilayo Adebayo', specialty: 'Dermatology', rating: 4.8, experience: 10, avatar: '', available: false, price: 18000, nextAvailable: '2026-08-07T14:00:00.000Z' },
      { id: 'doctor-004', name: 'Dr. Olumide Bankole', specialty: 'Cardiology', rating: 4.9, experience: 15, avatar: '', available: true, price: 25000, nextAvailable: '2026-08-05T11:00:00.000Z' },
      { id: 'doctor-005', name: 'Dr. Nneka Igwe', specialty: 'OB/GYN', rating: 4.8, experience: 11, avatar: '', available: true, price: 20000, nextAvailable: '2026-08-06T08:00:00.000Z' },
      { id: 'doctor-006', name: 'Dr. Tunde Alabi', specialty: 'Nutrition', rating: 4.6, experience: 7, avatar: '', available: true, price: 12000, nextAvailable: '2026-08-05T13:00:00.000Z' },
    ],
    skipDuplicates: true,
  });

  await prisma.insurancePolicy.createMany({
    data: [
      {
        id: 'pol_001',
        policyNumber: 'NHIS-2025-00123',
        provider: 'National Health Insurance Scheme (NHIS)',
        type: 'health',
        status: 'active',
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        premium: 15000,
        frequency: 'yearly',
        coverage: {
          inpatient: true, outpatient: true, maternity: true, dental: false, vision: false,
          maxCoverage: 5000000, deductible: 5000, coinsurance: '80/20',
        },
        benefits: [
          'Inpatient hospitalization up to 30 days per year',
          'Outpatient consultations (up to 12 visits)',
          'Maternity care (normal and complications)',
          'Prescription drugs formulary list A & B',
          'Diagnostic tests and laboratory work',
          'Emergency ambulance services',
        ],
        documents: [
          { name: 'NHIS Enrolment Card', url: '/docs/nhis-card.pdf' },
          { name: 'Policy Certificate', url: '/docs/nhis-cert.pdf' },
        ],
        nextPaymentDate: '2026-01-01',
        createdAt: '2024-12-15T10:30:00.000Z',
      },
      {
        id: 'pol_002',
        policyNumber: 'PRV-HL-2025-04567',
        provider: 'Hygeia HMO',
        type: 'supplemental',
        status: 'active',
        startDate: '2025-03-01',
        endDate: '2026-02-28',
        premium: 85000,
        frequency: 'monthly',
        coverage: {
          inpatient: true, outpatient: true, maternity: false, dental: true, vision: true,
          maxCoverage: 10000000, deductible: 10000, coinsurance: '90/10',
        },
        benefits: [
          'Comprehensive inpatient and outpatient coverage',
          'Dental cleanings, fillings, and extractions',
          'Vision exams and eyeglass allowance',
          'International emergency coverage',
          'Wellness and preventive screenings',
          'Mental health consultations (up to 8 per year)',
          'Telehealth virtual consultations',
        ],
        documents: [
          { name: 'Hygeia Membership Card', url: '/docs/hygeia-card.pdf' },
          { name: 'Policy Schedule', url: '/docs/hygeia-schedule.pdf' },
          { name: 'Terms and Conditions', url: '/docs/hygeia-tc.pdf' },
        ],
        nextPaymentDate: '2025-07-01',
        createdAt: '2025-02-20T14:00:00.000Z',
      },
    ],
    skipDuplicates: true,
  });

  await prisma.insuranceClaim.createMany({
    data: [
      {
        id: 'clm_001',
        policyId: 'pol_001',
        claimNumber: 'CLM-NHIS-2025-0001',
        patientName: 'Aisha Mohammed',
        serviceDate: '2025-06-10',
        provider: 'Lagos University Teaching Hospital',
        service: 'Inpatient surgery and recovery (appendectomy)',
        amount: 450000,
        status: 'approved',
        submissionDate: '2025-06-12T09:00:00.000Z',
        documents: [
          { name: 'Hospital Bill', url: '/docs/claims/bill-001.pdf' },
          { name: 'Discharge Summary', url: '/docs/claims/discharge-001.pdf' },
          { name: 'Lab Results', url: '/docs/claims/lab-001.pdf' },
        ],
        notes: 'Pre-authorization obtained. Claim reviewed and approved for payment.',
        createdAt: '2025-06-12T09:00:00.000Z',
      },
      {
        id: 'clm_002',
        policyId: 'pol_002',
        claimNumber: 'CLM-PRV-2025-0001',
        patientName: 'Emeka Okonkwo',
        serviceDate: '2025-06-15',
        provider: 'Mecure Healthcare',
        service: 'Dental cleaning and filling',
        amount: 35000,
        status: 'paid',
        submissionDate: '2025-06-16T11:30:00.000Z',
        documents: [
          { name: 'Dental Invoice', url: '/docs/claims/dental-inv-001.pdf' },
          { name: 'Treatment Report', url: '/docs/claims/dental-report-001.pdf' },
        ],
        notes: 'Routine dental procedure. Payment processed within 5 business days.',
        createdAt: '2025-06-16T11:30:00.000Z',
      },
      {
        id: 'clm_003',
        policyId: 'pol_001',
        claimNumber: 'CLM-NHIS-2025-0002',
        patientName: 'Aisha Mohammed',
        serviceDate: '2025-06-20',
        provider: 'Memorial Hospital',
        service: 'Outpatient consultation and blood work',
        amount: 25000,
        status: 'under_review',
        submissionDate: '2025-06-20T16:00:00.000Z',
        documents: [
          { name: 'Consultation Receipt', url: '/docs/claims/consult-001.pdf' },
          { name: 'Lab Report', url: '/docs/claims/lab-002.pdf' },
        ],
        notes: 'Pending verification of outpatient visit limit.',
        createdAt: '2025-06-20T16:00:00.000Z',
      },
    ],
    skipDuplicates: true,
  });

  await prisma.insurancePayment.createMany({
    data: [
      { id: 'pay_001', policyId: 'pol_001', amount: 15000, paymentDate: '2024-12-15T10:30:00.000Z', method: 'bank_transfer', reference: 'NHIS-2025-PAID', status: 'completed' },
      { id: 'pay_002', policyId: 'pol_002', amount: 85000, paymentDate: '2025-03-01T08:00:00.000Z', method: 'card', reference: 'PRV-MAR-2025-001', status: 'completed' },
      { id: 'pay_003', policyId: 'pol_002', amount: 85000, paymentDate: '2025-04-01T08:15:00.000Z', method: 'card', reference: 'PRV-APR-2025-001', status: 'completed' },
      { id: 'pay_004', policyId: 'pol_002', amount: 85000, paymentDate: '2025-05-01T07:45:00.000Z', method: 'card', reference: 'PRV-MAY-2025-001', status: 'completed' },
      { id: 'pay_005', policyId: 'pol_002', amount: 85000, paymentDate: '2025-06-01T09:00:00.000Z', method: 'bank_transfer', reference: 'PRV-JUN-2025-001', status: 'completed' },
    ],
    skipDuplicates: true,
  });

  await prisma.invoice.createMany({
    data: [
      {
        id: 'INV-001', providerId: 'PROV-001', providerName: 'Lagos University Teaching Hospital',
        patientId: 'PAT-001', patientName: 'Adebayo Ogunlesi',
        service: 'Cardiology Consultation & Echocardiogram', amount: 450000, currency: 'NGN',
        issueDate: '2026-07-15', dueDate: '2026-08-15', status: 'tokenized',
        tokenId: 'TKN-8K3MZ2QX', blockchainHash: '0x3f9a1c7b5d2e8f4a6b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b',
        tokenizationDate: '2026-07-16', fundingOptions: JSON.stringify({ minFundingAmount: 50000, interestRate: 8.5, fundingPeriod: 30 }),
        organizationId: 'ORG-001', createdAt: '2026-07-15T09:00:00.000Z',
      },
      {
        id: 'INV-002', providerId: 'PROV-002', providerName: 'Reddington Hospital',
        patientId: 'PAT-002', patientName: 'Chidinma Eze',
        service: 'Orthopedic Surgery - Knee Arthroscopy', amount: 1250000, currency: 'NGN',
        issueDate: '2026-07-10', dueDate: '2026-08-10', status: 'funded',
        tokenId: 'TKN-QW5ZXC2A', blockchainHash: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c',
        tokenizationDate: '2026-07-11', fundingOptions: JSON.stringify({ minFundingAmount: 100000, interestRate: 9.2, fundingPeriod: 45 }),
        organizationId: 'ORG-002', createdAt: '2026-07-10T14:30:00.000Z',
      },
      {
        id: 'INV-003', providerId: 'PROV-003', providerName: 'Mecure Healthcare',
        patientId: 'PAT-003', patientName: 'Fatima Bello',
        service: 'Maternity Package - Antenatal & Delivery', amount: 850000, currency: 'NGN',
        issueDate: '2026-07-20', dueDate: '2026-09-20', status: 'tokenized',
        tokenId: 'TKN-7YHN4BG', blockchainHash: '0x9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6',
        tokenizationDate: '2026-07-21', fundingOptions: JSON.stringify({ minFundingAmount: 75000, interestRate: 7.8, fundingPeriod: 60 }),
        organizationId: 'ORG-003', createdAt: '2026-07-20T11:15:00.000Z',
      },
      {
        id: 'INV-004', providerId: 'PROV-004', providerName: 'Total Health Trust',
        patientId: 'PAT-004', patientName: 'Olumide Adekunle',
        service: 'MRI Scan & Neurology Consultation', amount: 320000, currency: 'NGN',
        issueDate: '2026-07-25', dueDate: '2026-08-25', status: 'paid',
        tokenId: 'TKN-K8JL5M3', blockchainHash: '0x5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2',
        tokenizationDate: '2026-07-26', fundingOptions: JSON.stringify({ minFundingAmount: 30000, interestRate: 7.0, fundingPeriod: 30 }),
        organizationId: 'ORG-004', createdAt: '2026-07-25T08:45:00.000Z',
      },
    ],
    skipDuplicates: true,
  });

  await prisma.designTemplate.createMany({
    data: [
      { id: 'tpl-001', name: 'Child Growth Chart', thumbnail: '', category: 'health-education', description: 'Visual growth chart tracking height and weight percentiles for children aged 0-5.' },
      { id: 'tpl-002', name: 'Nutrition Guide Poster', thumbnail: '', category: 'health-education', description: 'Illustrated guide showing age-appropriate nutrition for infants and toddlers.' },
      { id: 'tpl-003', name: 'BCG Vaccination Certificate', thumbnail: '', category: 'vaccination-certificates', description: 'Official certificate template for BCG vaccination with QR verification.' },
      { id: 'tpl-004', name: 'Polio Vaccination Card', thumbnail: '', category: 'vaccination-certificates', description: 'Multi-dose card tracking polio vaccination schedule and status.' },
      { id: 'tpl-005', name: 'Community Health Fair Flyer', thumbnail: '', category: 'community-outreach', description: 'Eye-catching flyer for promoting community health screening events.' },
      { id: 'tpl-006', name: 'Mothers Support Group Banner', thumbnail: '', category: 'community-outreach', description: 'Banner design for maternal health support group sessions and meetings.' },
      { id: 'tpl-007', name: 'Immunization Schedule', thumbnail: '', category: 'child-health', description: 'Comprehensive immunization schedule showing all required vaccines from birth to age 5.' },
      { id: 'tpl-008', name: 'Wellness Check Record', thumbnail: '', category: 'child-health', description: 'Track routine wellness check-ups, milestones, and developmental screening results.' },
    ],
    skipDuplicates: true,
  });

  await prisma.userDesign.createMany({
    data: [
      {
        id: 'ud-001', name: 'My Nutrition Poster', thumbnail: '', category: 'health-education',
        userId: 'user-demo-001', templateId: 'tpl-002',
        content: { title: 'Healthy Eating for Kids', sections: ['Proteins', 'Vitamins', 'Hydration'] },
        createdAt: '2026-07-01T10:00:00.000Z', lastModified: '2026-07-15T14:30:00.000Z',
      },
      {
        id: 'ud-002', name: 'Village Vaccination Day', thumbnail: '', category: 'community-outreach',
        userId: 'user-demo-001', templateId: 'tpl-005',
        content: { event: 'Vaccination Day', date: '2026-08-10', location: 'Community Center' },
        createdAt: '2026-07-20T09:00:00.000Z', lastModified: '2026-07-25T11:00:00.000Z',
      },
    ],
    skipDuplicates: true,
  });

  await prisma.certificate.createMany({
    data: [
      {
        id: 'cert-001', childId: 'child-demo-001', childName: 'Amina Osei',
        vaccinations: [
          { name: 'BCG', date: '2026-01-10', batchNo: 'BCG-2026-001' },
          { name: 'OPV-0', date: '2026-02-14', batchNo: 'OPV-2026-003' },
        ],
        templateId: 'tpl-003',
        content: { verified: true, issuedBy: 'District Health Office' },
        createdAt: '2026-03-01T09:00:00.000Z',
      },
    ],
    skipDuplicates: true,
  });

  await prisma.healthPackage.createMany({
    data: [
      {
        title: 'Vaccination Drive Support',
        description: 'Fund vaccines and cold-chain logistics for outreach clinics in underserved communities.',
        price: 200, currency: 'ALGO', category: 'Vaccination',
        image: '', impact: '1,200 children vaccinated',
        goal: 10000, funded: 6200, progress: 62, active: true,
      },
      {
        title: 'Maternal Health Care',
        description: 'Provide antenatal care, safe delivery kits, and postnatal support for mothers.',
        price: 500, currency: 'ALGO', category: 'Maternal',
        image: '', impact: '350 safe deliveries',
        goal: 25000, funded: 14250, progress: 57, active: true,
      },
      {
        title: 'Emergency Medical Fund',
        description: 'Rapid-response funding for emergency surgeries and trauma care in rural areas.',
        price: 1000, currency: 'ALGO', category: 'Emergency',
        image: '', impact: '90 emergency cases treated',
        goal: 50000, funded: 21400, progress: 43, active: true,
      },
      {
        title: 'Community Health Screening',
        description: 'Free screening camps for hypertension, diabetes, and malaria in low-income areas.',
        price: 150, currency: 'ALGO', category: 'Prevention',
        image: '', impact: '5,000 people screened',
        goal: 15000, funded: 4200, progress: 28, active: true,
      },
    ],
    skipDuplicates: true,
  });

  console.log('Seed complete: hospitals, health workers, doctors, insurance, invoices, designs, certificates, health packages');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
