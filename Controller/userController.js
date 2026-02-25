const User = require('../models/User');
const Profile = require('../models/Profile');
const bcrypt = require('bcryptjs'); // Password verify karne ke liye
const jwt = require('jsonwebtoken'); // Token banane ke liye

// 1. REGISTER USER (Form Submission)
exports.registerUser = async (req, res) => {
    try {
        const userData = req.body;

        // FIXED: Frontend se 'paymentScreenshot' aa raha hai, 'screenshot' nahi
        const images = req.files['images'] ? req.files['images'].map(file => file.path) : [];
        const screenshot = req.files['paymentScreenshot'] ? req.files['paymentScreenshot'][0].path : null;

        // Hash password before saving
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(userData.password, salt);

        const newUser = new User({
            ...userData,
            password: hashedPassword,
            images: images,
            paymentScreenshot: screenshot, // Schema field name matched
            isApproved: false
        });

        await newUser.save();
        res.status(201).json({ success: true, message: "Registration successful! Pending admin approval." });
    } catch (error) {
        console.error("Register Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. APPROVE USER (Admin Action) - UPDATED WITH TIER LOGIC
exports.approveUser = async (req, res) => {
    try {
        const userId = req.params.id;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        if (user.isApproved) {
            return res.status(400).json({ success: false, message: "User already approved" });
        }

        // --- NEW: Package Limits & Expiry Logic ---
        let views = 0;
        let monthsToAdd = 1;

        if (user.packageType === 'Basic') {
            views = 3;
            monthsToAdd = 1;
        } else if (user.packageType === 'Gold') {
            views = 10;
            monthsToAdd = 1;
        } else if (user.packageType === 'Diamond') {
            views = 999;
            monthsToAdd = 3;
        } else if (user.packageType === 'Standard') {
            views = 1; // Default Standard limit
            monthsToAdd = 1;
        }

        const expiry = new Date();
        expiry.setMonth(expiry.getMonth() + monthsToAdd);

        // Update User with Limits
        user.viewLimit = views;
        user.expiryDate = expiry;
        user.isApproved = true;

        // --- Old Image Logic ---
        const mainImg = user.images.length > 0 ? user.images[0] : "";
        const galleryImgs = user.images.length > 1 ? user.images.slice(1) : [];

        // Profile model mein saara data shift karein
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
            nationality: user.nationality,
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
        await user.save();

        res.status(200).json({
            success: true,
            message: "User approved and profile is now live!",
            profile: newProfile,
            limits: { viewLimit: views, expiry: expiry }
        });

    } catch (error) {
        console.error("Approve Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. GET ALL PENDING REGISTRATIONS
exports.getPendingRegistrations = async (req, res) => {
    try {
        const pending = await User.find({ isApproved: false }).sort({ createdAt: -1 });
        res.status(200).json(pending);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. USER LOGIN
exports.loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ success: false, message: "Invalid credentials" });

        const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });

        res.status(200).json({
            success: true,
            token,
            user: {
                id: user._id,
                name: user.name,
                packageType: user.packageType,
                isApproved: user.isApproved,
                viewLimit: user.viewLimit,
                viewedCount: user.viewedCount
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 5. UNLOCK PROFILE DETAILS
exports.unlockProfile = async (req, res) => {
    try {
        const { profileId } = req.body;
        const user = await User.findById(req.user.id);

        if (user.unlockedProfiles.includes(profileId)) {
            return res.status(200).json({ success: true, message: "Already unlocked" });
        }

        if (user.packageType !== 'Diamond' && user.viewedCount >= user.viewLimit) {
            return res.status(403).json({ success: false, message: "Limit exceeded. Please upgrade!" });
        }

        user.unlockedProfiles.push(profileId);
        user.viewedCount += 1;
        await user.save();

        res.status(200).json({ success: true, message: "Profile unlocked!" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 6. GET AVAILABLE MATCHES (PACKAGE BASED FILTERING)
exports.getAvailableMatches = async (req, res) => {
    try {
        const loggedInUser = await User.findById(req.user.id);

        // Approved users dikhao, khud ko chhor kar
        let profiles = await User.find({
            isApproved: true,
            _id: { $ne: req.user.id },
            role: 'user'
        }).select('-password');

        const filteredProfiles = profiles.map(profile => {
            const p = profile.toObject();

            // Check if Diamond user or already unlocked
            const isUnlocked = loggedInUser.unlockedProfiles.includes(profile._id);
            const isDiamond = loggedInUser.packageType === 'Diamond';

            if (isDiamond || isUnlocked) {
                p.isLocked = false;
            } else {
                // Sensitive details hide kardo
                delete p.phone;
                delete p.familyDetails;
                p.isLocked = true;
            }
            return p;
        });

        res.status(200).json({ success: true, profiles: filteredProfiles });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};