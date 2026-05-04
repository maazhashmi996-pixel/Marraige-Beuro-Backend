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

// 2. Get All Public Profiles
router.get('/profiles', authMiddleware, async (req, res) => {
    try {
        const profiles = await Profile.find().sort({ createdAt: -1 });
        res.json(profiles);
    } catch (err) {
        res.status(500).json({ message: "Profiles fetch karne mein masla hai." });
    }
});

// 3. APPROVE USER (Manual Registration Approval)
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

        // Images already Cloudinary URLs hain agar registration ke waqt upload hui thin
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

// 4. CREATE PROFILE & USER ACCOUNT (Manual Admin Entry with Cloudinary)
router.post('/create-profile', authMiddleware, upload.array('images', 5), async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. Check if Email already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "Ye Email pehle se registered hai." });
        }

        // 2. Hash Password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password || "123456", salt);

        // 3. Handle Images (Cloudinary directly provides the path/URL)
        const files = req.files;
        const imageUrls = files ? files.map(file => file.path) : [];

        // 4. Create User Account
        const newUser = new User({
            ...req.body,
            password: hashedPassword,
            images: imageUrls,
            isApproved: true, // Admin khud bana raha hai to direct approve
            packageType: req.body.packageType || 'Basic',
            viewLimit: req.body.packageType === 'Gold' ? 10 : (req.body.packageType === 'Diamond' ? 1000 : 5),
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
        const profile = await Profile.findById(req.params.id);
        if (!profile) return res.status(404).json({ message: "Profile nahi mili" });

        // User aur Profile dono delete kar rahe hain
        await User.findByIdAndDelete(profile.userId);
        await Profile.findByIdAndDelete(req.params.id);

        res.json({ success: true, message: "User and Profile Deleted Successfully" });
    } catch (err) {
        res.status(500).json({ message: "Delete karne mein error aaya" });
    }
});

module.exports = router;