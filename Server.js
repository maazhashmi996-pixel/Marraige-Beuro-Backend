const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

dotenv.config();
const app = express();

/* ================= MIDDLEWARES ================= */
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure upload directory exists
const dir = './uploads';
if (!fs.existsSync(dir)) fs.mkdirSync(dir);

/* ================= HELPERS ================= */
const getFullUrl = (req, imgPath) => {
    if (!imgPath) return "";
    if (imgPath.startsWith('http')) return imgPath;
    const fileName = imgPath.split(/[/\\]/).pop();
    return `${req.protocol}://${req.get('host')}/uploads/${fileName}`;
};

/* ================= MONGODB CONNECTION ================= */
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected!"))
    .catch(err => console.error("❌ DB Connection Error:", err));

/* ================= SCHEMAS ================= */
const sharedFields = {
    name: String,
    fatherName: String,
    phone: String,
    age: Number,
    gender: String,
    city: String,
    caste: String,
    sect: String,
    monthlyIncome: String,
    maritalStatus: String,
    about: String,
    education: String,
    occupation: String,
    motherTongue: String,
    houseType: String,
    houseSize: String,
    requirements: String,
    createdAt: { type: Date, default: Date.now }
};

const profileSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ...sharedFields,
    mainImage: String,
    gallery: [String],
});

const userSchema = new mongoose.Schema({
    ...sharedFields,
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    package: { type: String, required: true },
    viewLimit: { type: Number, default: 0 },
    viewedProfiles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Profile' }],
    isApproved: { type: Boolean, default: false },
    images: [String],
    paymentScreenshot: String,
    role: { type: String, default: 'user' }
});

const Profile = mongoose.model('Profile', profileSchema);
const User = mongoose.model('User', userSchema);

/* ================= MULTER CONFIG ================= */
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s/g, '_'))
});
const upload = multer({ storage: storage });

/* ================= AUTH MIDDLEWARE ================= */
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ message: "No token" });
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) { res.status(401).json({ message: "Invalid Token" }); }
};

/* ================= PUBLIC ROUTES ================= */
app.get('/api/public/profiles', async (req, res) => {
    try {
        const profiles = await Profile.find().sort({ createdAt: -1 }).limit(10).lean();
        const safe = profiles.map(p => ({
            ...p,
            mainImage: getFullUrl(req, p.mainImage),
            phone: "Locked",
            isLocked: true
        }));
        res.json(safe);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ================= AUTH & USER ROUTES ================= */

app.post('/api/users/register', upload.fields([
    { name: 'images', maxCount: 4 },
    { name: 'paymentScreenshot', maxCount: 1 }
]), async (req, res) => {
    try {
        const { password, email, package } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ success: false, message: "Email already registered!" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const userImages = req.files['images'] ? req.files['images'].map(f => `uploads/${f.filename}`) : [];
        const screenshotPath = req.files['paymentScreenshot'] ? `uploads/${req.files['paymentScreenshot'][0].filename}` : null;

        const limits = { 'Basic': 3, 'Gold': 10, 'Diamond': 999999 };

        const newUser = new User({
            ...req.body,
            password: hashedPassword,
            viewLimit: limits[package] || 0,
            images: userImages,
            paymentScreenshot: screenshotPath,
            isApproved: false
        });

        await newUser.save();
        res.json({ success: true, message: "Registered! Waiting for approval." });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/users/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (!user) return res.status(401).json({ success: false, message: "User not found" });
        if (!user.isApproved) return res.status(403).json({ success: false, message: "Pending approval" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ success: false, message: "Invalid credentials" });

        const token = jwt.sign({ userId: user._id, role: user.role || 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({
            success: true,
            token,
            user: {
                id: user._id,
                name: user.name,
                role: user.role || 'user',
                viewLimit: user.viewLimit,
                package: user.package
            }
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// MAIN MATCHES ROUTE
app.get('/api/users/matches', authMiddleware, async (req, res) => {
    try {
        const currentUser = await User.findById(req.user.userId);
        if (!currentUser) return res.status(404).json({ success: false, message: "User not found" });

        const matchGender = currentUser.gender === 'Male' ? 'Female' : 'Male';

        const profiles = await Profile.find({
            gender: matchGender,
            userId: { $ne: currentUser._id }
        }).sort({ createdAt: -1 }).limit(100).lean();

        const safeMatches = profiles.map(p => {
            const isUnlocked = currentUser.viewedProfiles && currentUser.viewedProfiles.some(id => id.toString() === p._id.toString());
            const isDiamond = currentUser.package === 'Diamond';

            const profileData = {
                ...p,
                mainImage: getFullUrl(req, p.mainImage),
                gallery: (p.gallery || []).map(img => getFullUrl(req, img)),
            };

            if (isUnlocked || isDiamond || currentUser.role === 'admin') {
                profileData.isLocked = false;
            } else {
                delete profileData.phone;
                profileData.isLocked = true;
            }
            return profileData;
        });

        res.json({
            success: true,
            profiles: safeMatches,
            credits: currentUser.viewLimit || 0,
            unlockedProfiles: currentUser.viewedProfiles || []
        });
    } catch (err) {
        res.status(500).json({ success: false, error: "Failed to fetch matches" });
    }
});

/* ================= UNLOCK PROFILE ROUTE ================= */
app.post('/api/users/unlock-profile', authMiddleware, async (req, res) => {
    try {
        const { profileId } = req.body;
        const currentUser = await User.findById(req.user.userId);

        if (!currentUser) return res.status(404).json({ success: false, message: "User not found" });

        if (currentUser.viewedProfiles.includes(profileId)) {
            return res.json({ success: true, message: "Already unlocked" });
        }

        if (currentUser.package === 'Diamond' || currentUser.role === 'admin') {
            currentUser.viewedProfiles.push(profileId);
            await currentUser.save();
            return res.json({ success: true, message: "Unlocked!" });
        }

        if (currentUser.viewLimit <= 0) {
            return res.status(400).json({ success: false, message: "No credits left. Please upgrade package." });
        }

        currentUser.viewLimit -= 1;
        currentUser.viewedProfiles.push(profileId);
        await currentUser.save();

        res.json({
            success: true,
            message: "Profile unlocked!",
            credits: currentUser.viewLimit
        });
    } catch (err) {
        res.status(500).json({ success: false, error: "Unlock failed" });
    }
});

/* ================= ADMIN ROUTES ================= */

// NEW ROUTE: Fetch all approved profiles for admin
app.get('/api/admin/profiles', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: "Access denied" });
        }
        const profiles = await Profile.find().sort({ createdAt: -1 }).lean();
        const updated = profiles.map(p => ({
            ...p,
            mainImage: getFullUrl(req, p.mainImage),
            gallery: (p.gallery || []).map(img => getFullUrl(req, img))
        }));
        res.json(updated);
    } catch (err) { res.status(500).json({ error: "Fetch failed" }); }
});

app.put('/api/admin/approve/:userId', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        const existingProfile = await Profile.findOne({ userId: user._id });
        if (!existingProfile) {
            const userData = user.toObject();
            const originalUserId = userData._id;
            delete userData._id;

            const newProfile = new Profile({
                ...userData,
                userId: originalUserId,
                mainImage: user.images[0] || "",
                gallery: user.images,
            });
            await newProfile.save();
        }

        user.isApproved = true;
        await user.save();
        res.json({ success: true, message: "Approved!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/registrations', authMiddleware, async (req, res) => {
    try {
        const users = await User.find().sort({ createdAt: -1 }).lean();
        res.json(users.map(u => ({
            ...u,
            paymentScreenshot: getFullUrl(req, u.paymentScreenshot),
            images: (u.images || []).map(img => getFullUrl(req, img))
        })));
    } catch (err) { res.status(500).json({ error: "Fetch failed" }); }
});

app.delete('/api/admin/registration/:id', authMiddleware, async (req, res) => {
    try {
        await User.findByIdAndDelete(req.params.id);
        await Profile.findOneAndDelete({ userId: req.params.id });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Delete failed" }); }
});

/* ================= SERVER START ================= */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`✅ Server Live on http://localhost:${PORT}`);
});