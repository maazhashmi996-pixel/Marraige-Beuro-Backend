const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const User = require('../models/User'); // Path unchanged
const Profile = require('../models/Profile'); // Path unchanged

/* ================= 1. MULTER SETUP ================= */
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB Limit
});

/* ================= 2. ROUTES ================= */

// A. LIVE PROFILES (Approved ones)
router.get('/live-profiles', async (req, res) => {
    try {
        const profiles = await Profile.find().sort({ createdAt: -1 });
        res.json(profiles);
    } catch (err) {
        res.status(500).json({ message: "Profiles fetch karne mein masla hai." });
    }
});

// B. REGISTER NEW USER
router.post('/register', upload.fields([
    { name: 'image_1', maxCount: 1 },
    { name: 'image_2', maxCount: 1 },
    { name: 'image_3', maxCount: 1 },
    { name: 'image_4', maxCount: 1 },
    { name: 'payment_screenshot', maxCount: 1 }
]), async (req, res) => {
    try {
        const baseUrl = `${req.protocol}://${req.get('host')}`;

        // 1. Profile Images collect karein
        const profileImages = [];
        for (let i = 1; i <= 4; i++) {
            const fieldName = `image_${i}`;
            if (req.files[fieldName]) {
                profileImages.push(`${baseUrl}/uploads/${req.files[fieldName][0].filename}`);
            }
        }

        // 2. Payment Screenshot
        const screenshotUrl = req.files['payment_screenshot']
            ? `${baseUrl}/uploads/${req.files['payment_screenshot'][0].filename}`
            : null;

        // 3. Naya User Database mein save karein (All fields included)
        const newUser = new User({
            name: req.body.fullName, // Frontend fullName
            fatherName: req.body.fatherName,
            email: req.body.email,
            phone: req.body.phone,
            password: req.body.password,

            // Nayi Fields jo sync ki hain
            age: req.body.age,
            gender: req.body.gender,
            city: req.body.city,
            caste: req.body.caste,
            sect: req.body.sect,
            religion: req.body.religion || "Islam",
            height: req.body.height,
            weight: req.body.weight,
            maritalStatus: req.body.maritalStatus,
            motherTongue: req.body.motherTongue,
            education: req.body.education,
            occupation: req.body.occupation,
            monthlyIncome: req.body.monthlyIncome,
            houseType: req.body.houseType,
            houseSize: req.body.houseSize,
            disability: req.body.disability,
            about: req.body.about,
            requirements: req.body.requirements,
            familyDetails: req.body.familyDetails,

            // Package Info
            selectedPackage: req.body.selectedPackage,
            price: req.body.price,

            // Assets
            images: profileImages, // Model mein 'images' array hai
            paymentScreenshot: screenshotUrl,

            isApproved: false,
            createdAt: new Date()
        });

        await newUser.save();

        res.status(201).json({
            success: true,
            message: "Registration submitted for approval",
            userId: newUser._id
        });

    } catch (err) {
        console.error("Registration Error:", err);
        res.status(400).json({
            success: false,
            message: "Data save nahi ho saka.",
            error: err.message
        });
    }
});

module.exports = router;

