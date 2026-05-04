const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Profile = require('../models/Profile');
const authMiddleware = require('../middleware/authMiddleware');

// Cloudinary config aur multer yahan se aayega
const { upload } = require('../config/cloudinary');

/* ================= UPDATED ROUTES ================= */

// 1. Get Registrations
router.get('/registrations', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });

        const { range } = req.query;
        let startDate = new Date(0);
        const now = new Date();

        if (range === 'day') { startDate = new Date(now.setHours(0, 0, 0, 0)); }
        else if (range === 'week') { startDate = new Date(now.setDate(now.getDate() - 7)); }
        else if (range === 'month') { startDate = new Date(now.setMonth(now.getMonth() - 1)); }

        const users = await User.find({
            role: 'user',
            isApproved: false,
            createdAt: { $gte: startDate }
        }).sort({ createdAt: -1 });

        res.json(users);
    } catch (err) {
        console.error("Fetch Registrations Error:", err);
        res.status(500).json({ message: "Registrations fetch karne mein masla hai." });
    }
});

// 2. Get All Public Profiles
router.get('/profiles', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });
        const profiles = await Profile.find().sort({ createdAt: -1 });
        res.json(profiles);
    } catch (err) {
        res.status(500).json({ message: "Profiles fetch karne mein masla hai." });
    }
});

// 3. APPROVE USER (Manual Registration Approval)
router.put('/approve/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });

        const { package: pkg } = req.body;
        const user = await User.findById(req.params.id);

        if (!user) return res.status(404).json({ message: "User nahi mila" });
        if (user.isApproved) return res.status(400).json({ message: "User pehle se approved hai" });

        const getPkgLimit = (p) => {
            if (p === 'Gold Plan' || p === 'Gold') return 10;
            if (p === 'Diamond Plan' || p === 'Diamond') return 9999;
            return 3;
        };

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
            occupation: user.occupation,
            monthlyIncome: user.monthlyIncome,
            motherTongue: user.motherTongue,
            disability: user.disability,
            houseType: user.houseType,
            houseSize: user.houseSize,
            requirements: user.requirements,
            about: user.about,
            familyDetails: user.familyDetails,
            mainImage: mainImg,
            gallery: galleryImgs,
            package: pkg || user.package || 'Basic Plan'
        });

        await newProfile.save();

        user.isApproved = true;
        user.package = pkg || user.package || 'Basic Plan';
        user.viewLimit = getPkgLimit(user.package);
        user.viewedCount = 0;
        user.expiryDate = expiry;
        user.viewedProfiles = [];

        await user.save();

        res.json({ success: true, message: `User Approved as ${user.package}!`, profile: newProfile });
    } catch (err) {
        res.status(500).json({ message: "Approval process mein masla aaya", error: err.message });
    }
});

// 4. CREATE PROFILE & USER ACCOUNT (Manual Admin Entry with Cloudinary)
router.post('/create-profile', authMiddleware, upload.array('images', 10), async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });

        const { email, password, package: pkg } = req.body;

        const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
        if (existingUser) {
            return res.status(400).json({ message: "Ye Email pehle se registered hai." });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password || "123456", salt);

        const files = req.files;
        const imageUrls = files ? files.map(file => file.path) : [];

        const getPkgLimit = (p) => {
            if (p === 'Gold Plan' || p === 'Gold') return 10;
            if (p === 'Diamond Plan' || p === 'Diamond') return 9999;
            return 3;
        };

        const newUser = new User({
            ...req.body,
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            images: imageUrls,
            isApproved: true,
            package: pkg || 'Basic Plan',
            viewLimit: getPkgLimit(pkg || 'Basic Plan'),
            expiryDate: new Date(new Date().setMonth(new Date().getMonth() + 3)),
            role: 'user'
        });
        const savedUser = await newUser.save();

        const newProfile = new Profile({
            ...req.body,
            userId: savedUser._id,
            mainImage: imageUrls[0] || "",
            gallery: imageUrls,
            package: pkg || 'Basic Plan',
            nationality: req.body.nationality || "Pakistani",
            title: `${req.body.caste || 'New'} Rishta - ${req.body.city || 'Pakistan'}`
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

// 5. Delete Profile & Linked User
router.delete('/profile/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });

        const profile = await Profile.findById(req.params.id);
        if (!profile) return res.status(404).json({ message: "Profile nahi mili" });

        if (profile.userId) {
            await User.findByIdAndDelete(profile.userId);
        }
        await Profile.findByIdAndDelete(req.params.id);

        res.json({ success: true, message: "User and Profile Deleted Successfully" });
    } catch (err) {
        res.status(500).json({ message: "Delete karne mein error aaya" });
    }
});

module.exports = router;