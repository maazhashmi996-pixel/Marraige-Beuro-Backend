const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs'); // <--- Password hashing ke liye
const User = require('../models/User');
const Profile = require('../models/Profile');
const authMiddleware = require('../middleware/authMiddleware');

/* ================= MULTER STORAGE CONFIGURATION ================= */
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

// 3. APPROVE USER (Unchanged)
router.put('/approve/:id', authMiddleware, async (req, res) => {
    try {
        const { packageType } = req.body;
        const user = await User.findById(req.params.id);

        if (!user) return res.status(404).json({ message: "User nahi mila" });
        if (user.isApproved) return res.status(400).json({ message: "User pehle se approved hai" });

        let limit = 0;
        if (packageType === 'Basic') limit = 3;
        else if (packageType === 'Gold') limit = 10;
        else if (packageType === 'Diamond') limit = 1000;

        const expiry = new Date();
        expiry.setMonth(expiry.getMonth() + 3);

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

        user.isApproved = true;
        user.packageType = packageType || 'Basic';
        user.viewLimit = limit;
        user.viewedCount = 0;
        user.expiryDate = expiry;
        user.unlockedProfiles = [];

        await user.save();

        res.json({ success: true, message: `User Approved as ${packageType}!`, profile: newProfile });
    } catch (err) {
        res.status(500).json({ message: "Approval process mein masla aaya", error: err.message });
    }
});

// 4. CREATE PROFILE & USER ACCOUNT (FULL UPDATED)
router.post('/create-profile', authMiddleware, upload.array('images', 5), async (req, res) => {
    try {
        const { email, password, name, phone } = req.body;

        // 1. Check if Email already exists in User table
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "Ye Email pehle se registered hai." });
        }

        // 2. Hash Password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password || "123456", salt);

        // 3. Handle Images
        const files = req.files;
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const imageUrls = files.map(file => `${baseUrl}/uploads/${file.filename}`);

        // 4. Create User Account (Taake login ho sakay)
        const newUser = new User({
            ...req.body,
            password: hashedPassword,
            images: imageUrls,
            isApproved: true, // Manual create hai to auto-approved
            packageType: 'Basic',
            viewLimit: 5,
            expiryDate: new Date(new Date().setMonth(new Date().getMonth() + 3))
        });
        const savedUser = await newUser.save();

        // 5. Create Public Profile
        const newProfile = new Profile({
            userId: savedUser._id,
            ...req.body,
            mainImage: imageUrls[0] || "",
            gallery: imageUrls,
            nationality: req.body.nationality || "Pakistani",
            profession: req.body.occupation || req.body.profession // Dono handle kar liye
        });

        await newProfile.save();

        res.json({
            success: true,
            message: "User Account & Profile Created Successfully!",
            profile: newProfile
        });

    } catch (err) {
        console.error("Create Error:", err);
        res.status(500).json({ message: "Account create nahi ho saka", error: err.message });
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