const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/auth");
const { prisma } = require("../utils/prisma");

const randomTokenId = () => "TKN-" + Math.random().toString(36).substring(2, 10).toUpperCase();
const randomBlockchainHash = () => "0x" + Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

router.get("/marketplace", async (req, res) => {
  try {
    const available = await prisma.invoice.findMany({
      where: { status: "tokenized" },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, count: available.length, data: available });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/user/invoices", auth, async (req, res) => {
  try {
    const userInvoices = await prisma.invoice.findMany({
      where: { OR: [{ patientId: req.user.id }, { providerId: req.user.id }] },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, count: userInvoices.length, data: userInvoices });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }
    res.json({ success: true, data: invoice });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/:id/fund", auth, async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }
    if (invoice.status !== "tokenized") {
      return res.status(400).json({ success: false, message: "Invoice is not available for funding" });
    }

    const { amount, funderWallet } = req.body;
    if (!amount || !funderWallet) {
      return res.status(400).json({ success: false, message: "amount and funderWallet are required" });
    }
    if (amount < JSON.parse(invoice.fundingOptions).minFundingAmount) {
      return res.status(400).json({ success: false, message: "Amount below minimum funding threshold" });
    }

    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "funded",
        funderWallet,
        fundedAmount: amount,
        fundedAt: new Date(),
        fundedBy: req.user.id,
      },
    });

    res.json({ success: true, message: "Invoice funded successfully", data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/", auth, async (req, res) => {
  try {
    const { providerName, patientName, service, amount, currency, dueDate, fundingOptions } = req.body;
    if (!providerName || !patientName || !service || !amount || !dueDate) {
      return res.status(400).json({ success: false, message: "providerName, patientName, service, amount, and dueDate are required" });
    }

    const invoiceCount = await prisma.invoice.count();
    const today = new Date().toISOString().split("T")[0];

    const newInvoice = await prisma.invoice.create({
      data: {
        id: "INV-" + String(invoiceCount + 1).padStart(3, "0"),
        providerId: req.user.id,
        providerName,
        patientId: "PAT-" + Math.random().toString(36).substring(2, 6).toUpperCase(),
        patientName,
        service,
        amount: Number(amount),
        currency: currency || "NGN",
        issueDate: today,
        dueDate,
        status: "tokenized",
        tokenId: randomTokenId(),
        blockchainHash: randomBlockchainHash(),
        tokenizationDate: today,
        fundingOptions: JSON.stringify(fundingOptions || { minFundingAmount: 50000, interestRate: 8.0, fundingPeriod: 30 }),
        organizationId: req.user.organizationId || "ORG-001",
      },
    });

    res.status(201).json({ success: true, message: "Invoice created and tokenized", data: newInvoice });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
