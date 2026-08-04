const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/auth");
const { prisma } = require("../utils/prisma");

router.get("/doctors", async (req, res) => {
  try {
    const { specialty, available } = req.query;
    const where = {};

    if (specialty) {
      where.specialty = { equals: specialty, mode: "insensitive" };
    }

    if (available !== undefined) {
      where.available = available === "true";
    }

    const results = await prisma.telemedicineDoctor.findMany({
      where,
      orderBy: { rating: "desc" },
    });

    res.json({ success: true, data: results });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/doctors/:id", async (req, res) => {
  try {
    const doctor = await prisma.telemedicineDoctor.findUnique({ where: { id: req.params.id } });

    if (!doctor) {
      return res.status(404).json({ success: false, message: "Doctor not found" });
    }

    res.json({ success: true, data: doctor });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/consultations", auth, async (req, res) => {
  try {
    const { doctorId, type, scheduledAt, notes } = req.body;

    if (!doctorId || !type || !scheduledAt) {
      return res
        .status(400)
        .json({ success: false, message: "doctorId, type, and scheduledAt are required" });
    }

    const validTypes = ["video", "phone", "chat"];
    if (!validTypes.includes(type)) {
      return res
        .status(400)
        .json({ success: false, message: "type must be video, phone, or chat" });
    }

    const doctor = await prisma.telemedicineDoctor.findUnique({ where: { id: doctorId } });
    if (!doctor) {
      return res.status(404).json({ success: false, message: "Doctor not found" });
    }

    const consultation = await prisma.telemedicineConsultation.create({
      data: {
        doctorId: doctor.id,
        patientId: req.user.id,
        type,
        scheduledAt: new Date(scheduledAt),
        status: "scheduled",
        price: doctor.price,
        notes: notes || "",
      },
    });

    res.status(201).json({ success: true, data: consultation });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/consultations", auth, async (req, res) => {
  try {
    const userConsultations = await prisma.telemedicineConsultation.findMany({
      where: { patientId: req.user.id },
      orderBy: { createdAt: "desc" },
      include: { doctor: true },
    });

    res.json({ success: true, data: userConsultations });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/consultations/:id", auth, async (req, res) => {
  try {
    const consultation = await prisma.telemedicineConsultation.findFirst({
      where: { id: req.params.id, patientId: req.user.id },
      include: { doctor: true },
    });

    if (!consultation) {
      return res
        .status(404)
        .json({ success: false, message: "Consultation not found" });
    }

    res.json({ success: true, data: consultation });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
