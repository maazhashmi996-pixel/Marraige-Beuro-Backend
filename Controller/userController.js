const User = require('../models/User');
const Profile = require('../models/Profile');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ==========================================
// 1. ADMIN: CREATE MANUAL PROFILE
// ==========================================
exports.createManualProfile = async (req, res) => {
    try {
        const userData = req.body;
        const existingUser = await User.findOne({ email: userData.email });
        if (existingUser) {
            return res.status(400).json({ success: false, message: "Email already registered" });
        }

        const images = req.files && req.files['images'] ? req.files['images'].map(file => file.path) : [];
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(userData.password || "123456", salt);

        const newUser = new User({
            ...userData,
            password: hashedPassword,
            images: images,
            mainImage: images.length > 0 ? images[0] : null,
            isApproved: true,
            package: userData.package || 'Basic Plan',
            credits: 5,
            role: 'user'
        });

        const savedUser = await newUser.save();

        const newProfile = new Profile({
            userId: savedUser._id,
            name: savedUser.name,
            fatherName: savedUser.fatherName,
            title: userData.title || `${savedUser.caste || 'New'} Rishta`,
            age: savedUser.age,
            gender: savedUser.gender,
            city: savedUser.city,
            caste: savedUser.caste,
            sect: savedUser.sect,
            religion: savedUser.religion,
            height: savedUser.height,
            weight: savedUser.weight,
            maritalStatus: savedUser.maritalStatus,
            education: savedUser.education,
            occupation: savedUser.occupation || savedUser.profession, // Sync here
            monthlyIncome: savedUser.monthlyIncome,
            motherTongue: savedUser.motherTongue,
            about: savedUser.about,
            requirements: savedUser.requirements,
            familyDetails: savedUser.familyDetails,
            mainImage: savedUser.mainImage,
            gallery: savedUser.images
        });

        await newProfile.save();
        res.status(201).json({ success: true, message: "User Account & Profile Created Successfully!", user: savedUser });

    } catch (error) {
        console.error("Manual Create Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 2. REGISTER USER (Self Registration)
// ==========================================
exports.registerUser = async (req, res) => {
    try {
        const userData = req.body;

        // 1. Basic Validation (Is se 500 error ruk jayega)
        if (!userData.email || !userData.password) {
            return res.status(400).json({ success: false, message: "Email and Password are required!" });
        }

        const existingUser = await User.findOne({ email: userData.email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ success: false, message: "Email already registered" });
        }

        // 2. Safely handle files (taake undefined error na aaye)
        const images = req.files && req.files['images'] ? req.files['images'].map(file => file.path) : [];

        // Screenshot check
        let screenshot = null;
        if (req.files && req.files['paymentScreenshot'] && req.files['paymentScreenshot'][0]) {
            screenshot = req.files['paymentScreenshot'][0].path;
        }

        // 3. Safe Hashing
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(userData.password.toString(), salt);

        // 4. Create User with Schema matching fields
        const newUser = new User({
            ...userData,
            password: hashedPassword,
            images: images,
            mainImage: images.length > 0 ? images[0] : null,
            paymentScreenshot: screenshot,
            isApproved: false,
            viewLimit: 0, // Schema mein viewLimit hai, credits nahi
            unlockedProfiles: []
        });

        await newUser.save();
        res.status(201).json({ success: true, message: "Registration successful! Pending admin approval." });

    } catch (error) {
        console.error("REGISTER ERROR:", error); // Railway logs mein check karein
        res.status(500).json({ success: false, message: error.message });
    }
};
// ==========================================
// 3. APPROVE USER
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
        else { views = 5; monthsToAdd = 1; }

        const expiry = new Date();
        expiry.setMonth(expiry.getMonth() + monthsToAdd);

        user.credits = views;
        user.packageExpiry = expiry;
        user.isApproved = true;

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
            height: user.height,
            weight: user.weight,
            maritalStatus: user.maritalStatus,
            education: user.education,
            profession: user.occupation || user.profession,
            monthlyIncome: user.monthlyIncome || user.income,
            motherTongue: user.motherTongue,
            requirements: user.requirements,
            about: user.about,
            familyDetails: user.familyDetails,
            mainImage: user.mainImage || (user.images.length > 0 ? user.images[0] : ""),
            gallery: user.images
        });

        await newProfile.save();
        await user.save();
        res.status(200).json({ success: true, message: "Approved!" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 4. GET PENDING & LOGIN (Kept Intact)
// ==========================================
exports.getPendingRegistrations = async (req, res) => {
    try {
        const pending = await User.find({ isApproved: false }).sort({ createdAt: -1 });
        res.status(200).json(pending);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ success: false, message: "Invalid credentials" });

        const token = jwt.sign({ id: user._id, role: user.role || 'user' }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
        res.status(200).json({ success: true, token, user });
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

        const isDiamond = user.package === 'Diamond Plan';
        if (!isDiamond && user.credits <= 0) {
            return res.status(403).json({ success: false, message: "No credits left!" });
        }

        user.unlockedProfiles.push(profileId);
        if (!isDiamond) user.credits -= 1;
        await user.save();
        res.status(200).json({ success: true, message: "Profile Unlocked!", credits: user.credits });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 6. GET AVAILABLE MATCHES (UPDATED FOR PUBLIC DATA)
// ==========================================
exports.getAvailableMatches = async (req, res) => {
    try {
        const loggedInUser = req.user ? await User.findById(req.user.id) : null;
        let query = { isApproved: true, role: 'user' };

        if (loggedInUser && loggedInUser.role !== 'admin') {
            const targetGender = loggedInUser.gender === 'Male' ? 'Female' : 'Male';
            query.gender = targetGender;
            query._id = { $ne: loggedInUser._id };
        }

        let rawProfiles = await User.find(query).select('-password').sort({ createdAt: -1 });

        const filteredProfiles = rawProfiles.map(profile => {
            const p = profile.toObject();

            // PUBLIC DATA SYNC: In cheezon ko humne hamesha dikhana hai
            p.name = p.name || p.title || "Member";
            p.age = p.age || "N/A";
            p.gender = p.gender || "Not Specified";
            p.city = p.city || "Not Specified";
            p.occupation = p.occupation || p.profession || "Not Specified";
            p.education = p.education || "Not Specified";
            p.maritalStatus = p.maritalStatus || "Not Specified";

            let isLocked = true;
            if (loggedInUser) {
                const isUnlocked = loggedInUser.unlockedProfiles.includes(profile._id.toString());
                if (loggedInUser.role === 'admin' || loggedInUser.package === 'Diamond Plan' || isUnlocked) {
                    isLocked = false;
                }
            }

            p.isLocked = isLocked;

            // Sirf sensitive data delete karein, public fields nahi
            if (isLocked) {
                delete p.phone;
                delete p.fatherName;
                delete p.familyDetails;
                delete p.email;
                delete p.address;
                // Income ko bhi private rakhna hai toh niche wali line uncomment karein
                // delete p.monthlyIncome; 
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