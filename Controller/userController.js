const User = require('../models/User');
const Profile = require('../models/Profile');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ==========================================
// 1. REGISTER USER
// ==========================================
exports.registerUser = async (req, res) => {
    try {
        const userData = req.body;
        const existingUser = await User.findOne({ email: userData.email });
        if (existingUser) {
            return res.status(400).json({ success: false, message: "Email already registered" });
        }

        const images = req.files['images'] ? req.files['images'].map(file => file.path) : [];
        const screenshot = req.files['paymentScreenshot'] ? req.files['paymentScreenshot'][0].path : null;

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(userData.password, salt);

        const newUser = new User({
            ...userData,
            income: userData.monthlyIncome || userData.income,
            password: hashedPassword,
            images: images,
            mainImage: images.length > 0 ? images[0] : null,
            paymentScreenshot: screenshot,
            isApproved: false,
            credits: 0,
            unlockedProfiles: [],
            viewedCount: 0
        });

        await newUser.save();
        res.status(201).json({ success: true, message: "Registration successful! Pending admin approval." });
    } catch (error) {
        console.error("Register Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 2. APPROVE USER (Admin Action)
// ==========================================
exports.approveUser = async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await User.findById(userId);

        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        if (user.isApproved) return res.status(400).json({ success: false, message: "Already approved" });

        let views = 0;
        let monthsToAdd = 1;

        if (user.package === 'Basic Plan') { views = 3; monthsToAdd = 1; }
        else if (user.package === 'Gold Plan') { views = 10; monthsToAdd = 3; }
        else if (user.package === 'Diamond Plan') { views = 999; monthsToAdd = 12; }
        else { views = 0; monthsToAdd = 1; }

        const expiry = new Date();
        expiry.setMonth(expiry.getMonth() + monthsToAdd);

        user.credits = views;
        user.packageExpiry = expiry;
        user.isApproved = true;
        user.isPremium = ['Gold Plan', 'Diamond Plan'].includes(user.package);

        const mainImg = user.mainImage || (user.images.length > 0 ? user.images[0] : "");

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
            profession: user.occupation || user.profession,
            monthlyIncome: user.income,
            motherTongue: user.motherTongue,
            disability: user.disability,
            houseType: user.houseType,
            houseSize: user.houseSize,
            requirements: user.requirements,
            about: user.about,
            familyDetails: user.familyDetails,
            mainImage: mainImg,
            gallery: user.images
        });

        await newProfile.save();
        await user.save();

        res.status(200).json({ success: true, message: "Approved!", limits: { credits: views, expiry } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 3. GET PENDING (Admin Only)
// ==========================================
exports.getPendingRegistrations = async (req, res) => {
    try {
        const pending = await User.find({ isApproved: false }).sort({ createdAt: -1 });
        res.status(200).json(pending);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 4. USER LOGIN
// ==========================================
exports.loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ success: false, message: "Invalid credentials" });

        const token = jwt.sign(
            { id: user._id, role: user.role || 'user' },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '7d' }
        );

        res.status(200).json({
            success: true,
            token,
            user: {
                id: user._id,
                name: user.name,
                gender: user.gender,
                package: user.package,
                isApproved: user.isApproved,
                credits: user.credits,
                role: user.role || 'user'
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 5. UNLOCK PROFILE
// ==========================================
exports.unlockProfile = async (req, res) => {
    try {
        const { profileId } = req.body;
        const user = await User.findById(req.user.id);

        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        if (user.unlockedProfiles.includes(profileId)) {
            return res.status(200).json({ success: true, message: "Already unlocked", credits: user.credits });
        }

        if (user.packageExpiry && new Date() > new Date(user.packageExpiry)) {
            return res.status(403).json({ success: false, message: "Package expired!" });
        }

        const isDiamond = user.package === 'Diamond Plan';
        if (!isDiamond && user.credits <= 0) {
            return res.status(403).json({ success: false, message: "No credits left! Please upgrade." });
        }

        user.unlockedProfiles.push(profileId);
        if (!isDiamond) {
            user.credits -= 1;
        }
        user.viewedCount = (user.viewedCount || 0) + 1;

        await user.save();
        res.status(200).json({ success: true, message: "Profile Unlocked!", credits: user.credits });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 6. GET AVAILABLE MATCHES (Public & Gender Logic)
// ==========================================
exports.getAvailableMatches = async (req, res) => {
    try {
        // Find Logged In User (If token exists)
        const loggedInUser = req.user ? await User.findById(req.user.id) : null;

        // Base Query
        let query = {
            isApproved: true,
            role: 'user'
        };

        // 1. LOGIC FOR AUTHENTICATED USER
        if (loggedInUser) {
            // Admin gets everything, User gets opposite gender
            if (loggedInUser.role !== 'admin') {
                const targetGender = loggedInUser.gender === 'Male' ? 'Female' : 'Male';
                query.gender = targetGender;
                query._id = { $ne: loggedInUser._id };
            }
        }
        // 2. LOGIC FOR PUBLIC VIEW (LOGOUT)
        // No gender filter here - show all as per your request

        let rawProfiles = await User.find(query).select('-password').sort({ createdAt: -1 });

        const filteredProfiles = rawProfiles.map(profile => {
            const p = profile.toObject();

            let isLocked = true;

            if (loggedInUser) {
                const isUnlocked = loggedInUser.unlockedProfiles.includes(profile._id.toString());
                const isDiamond = loggedInUser.package === 'Diamond Plan';

                if (loggedInUser.role === 'admin' || isDiamond || isUnlocked) {
                    isLocked = false;
                }
            }

            // Privacy: Lockdown data if not unlocked or not logged in
            if (isLocked) {
                delete p.phone;
                delete p.familyDetails;
                delete p.paymentScreenshot;
                p.isLocked = true;
            } else {
                p.isLocked = false;
            }

            return p;
        });

        res.status(200).json({
            success: true,
            profiles: filteredProfiles,
            credits: loggedInUser ? loggedInUser.credits : 0,
            isLoggedIn: !!loggedInUser
        });

    } catch (error) {
        console.error("Match Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 7. GET SINGLE PROFILE
// ==========================================
exports.getSingleProfile = async (req, res) => {
    try {
        const { id } = req.params;
        const profile = await Profile.findById(id).populate('userId', 'isPremium package');
        if (!profile) return res.status(404).json({ success: false, message: "Profile not found" });

        res.status(200).json({ success: true, profile });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server Error" });
    }
};