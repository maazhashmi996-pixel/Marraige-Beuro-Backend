const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const User = require('../models/User');
const Profile = require('../models/Profile');
const authMiddleware = require('../middleware/authMiddleware');

/* ================= MULTER STORAGE CONFIGURATION (Unchanged) ================= */
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
    limits: { fileSize: 5 * 1024 * 1024 }
});

/* ================= UPDATED ROUTES ================= */

// 1. Get Registrations (Unchanged)
router.get('/registrations', authMiddleware, async (req, res) => {
    try {
        const { range } = req.query;
        let startDate = new Date(0);
        const now = new Date();

        if (range === 'day') { startDate = new Date(now.setHours(0, 0, 0, 0)); }
        else if (range === 'week') { startDate = new Date(now.setDate(now.getDate() - 7)); }
        else if (range === 'month') { startDate = new Date(now.setMonth(now.getMonth() - 1)); }

        const users = await User.find({ createdAt: { $gte: startDate } }).sort({ createdAt: -1 });
        res.json(users);
    } catch (err) {
        console.error("Fetch Registrations Error:", err);
        res.status(500).json({ message: "Registrations fetch karne mein masla hai." });
    }
});

// 2. Get All Public Profiles (Unchanged)
router.get('/profiles', authMiddleware, async (req, res) => {
    try {
        const profiles = await Profile.find().sort({ createdAt: -1 });
        res.json(profiles);
    } catch (err) {
        res.status(500).json({ message: "Profiles fetch karne mein masla hai." });
    }
});

// 3. APPROVE USER (Updated with Package & Limits Logic)
router.put('/approve/:id', authMiddleware, async (req, res) => {
    try {
        const { packageType } = req.body; // Frontend se 'Basic', 'Gold', ya 'Diamond' aayega
        const user = await User.findById(req.params.id);

        if (!user) return res.status(404).json({ message: "User nahi mila" });
        if (user.isApproved) return res.status(400).json({ message: "User pehle se approved hai" });

        // Tier-Based Logic
        let limit = 0;
        if (packageType === 'Basic') limit = 3;
        else if (packageType === 'Gold') limit = 10;
        else if (packageType === 'Diamond') limit = 1000; // Unlimited as 1000

        // 3 Months Validity Calculation
        const expiry = new Date();
        expiry.setMonth(expiry.getMonth() + 3);

        // Sync Data to Profile Table (Aapka purana logic)
        const mainImg = user.images && user.images.length > 0 ? user.images[0] : "";
        const galleryImgs = user.images && user.images.length > 0 ? user.images : [];

        const newProfile = new Profile({
            userId: user._id,
            name: user.name,
            fatherName: user.fatherName,
            title: `${user.caste || 'New'} Rishta - ${user.city || 'Pakistan'}`,
            age: user.age,
            gender: user.gender,
            city: user.city,
            caste: user.caste,
            sect: user.sect,
            religion: user.religion,
            nationality: user.nationality || "Pakistani",
            height: user.height,
            weight: user.weight,
            maritalStatus: user.maritalStatus,
            education: user.education,
            profession: user.occupation,
            monthlyIncome: user.monthlyIncome,
            motherTongue: user.motherTongue,
            disability: user.disability,
            houseType: user.houseType,
            houseSize: user.houseSize,
            requirements: user.requirements,
            about: user.about,
            familyDetails: user.familyDetails,
            mainImage: mainImg,
            gallery: galleryImgs
        });

        await newProfile.save();

        // --- UPDATE USER MODEL WITH TIER INFO ---
        user.isApproved = true;
        user.packageType = packageType || 'Basic'; // Default Basic agar bhool jayein
        user.viewLimit = limit;
        user.viewedCount = 0;
        user.expiryDate = expiry;
        user.unlockedProfiles = []; // Shuru mein empty array

        await user.save();

        res.json({
            success: true,
            message: `User Approved as ${packageType}! Profile is now live.`,
            profile: newProfile
        });
    } catch (err) {
        console.error("Approval Error:", err);
        res.status(500).json({ message: "Approval process mein masla aaya", error: err.message });
    }
});

// 4. Create Public Profile Manual (Unchanged)
router.post('/create-profile', authMiddleware, upload.array('images', 5), async (req, res) => {
    try {
        const files = req.files;
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const imageUrls = files.map(file => `${baseUrl}/uploads/${file.filename}`);

        const newProfile = new Profile({
            name: req.body.name,
            fatherName: req.body.fatherName,
            title: req.body.title,
            age: req.body.age,
            gender: req.body.gender,
            city: req.body.city,
            caste: req.body.caste,
            sect: req.body.sect,
            religion: req.body.religion,
            nationality: req.body.nationality || "Pakistani",
            height: req.body.height,
            weight: req.body.weight,
            education: req.body.education,
            profession: req.body.profession,
            monthlyIncome: req.body.monthlyIncome,
            maritalStatus: req.body.maritalStatus,
            motherTongue: req.body.motherTongue,
            houseType: req.body.houseType,
            houseSize: req.body.houseSize,
            requirements: req.body.requirements,
            about: req.body.about || req.body.description,
            familyDetails: req.body.familyDetails,
            mainImage: imageUrls[0] || "",
            gallery: imageUrls
        });

        await newProfile.save();
        res.json({ success: true, message: "Profile Created Successfully", profile: newProfile });
    } catch (err) {
        res.status(400).json({ message: "Data save nahi ho saka" });
    }
});

// 5. Delete Profile (Unchanged)
router.delete('/profile/:id', authMiddleware, async (req, res) => {
    try {
        const deletedProfile = await Profile.findByIdAndDelete(req.params.id);
        if (!deletedProfile) return res.status(404).json({ message: "Profile nahi mili" });
        res.json({ success: true, message: "Profile Deleted Successfully" });
    } catch (err) {
        res.status(500).json({ message: "Delete karne mein error aaya" });
    }
});

module.exports = router;