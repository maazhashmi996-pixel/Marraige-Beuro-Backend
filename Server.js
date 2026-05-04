const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const compression = require('compression');

// Cloudinary config file se import
const { upload } = require('./config/cloudinary');

dotenv.config();
const app = express();

/* ================= MIDDLEWARES ================= */
app.use(helmet({
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(compression());

const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'https://www.assanrishta.com',
    'https://assanrishta.com'
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || origin.includes('localhost')) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

/* ================= HELPERS ================= */
const getFullUrl = (req, imgPath) => {
    if (!imgPath || imgPath === "undefined" || imgPath === "null") return "";
    return imgPath;
};

const getPackageLimit = (pkgName) => {
    const limits = {
        'Basic Plan': 3, 'Basic': 3,
        'Gold Plan': 10, 'Gold': 10,
        'Diamond Plan': 9999, 'Diamond': 9999,
        'Standard': 0
    };
    return limits[pkgName] || 3;
};

/* ================= SCHEMAS ================= */
const sharedFields = {
    name: String, fatherName: String, phone: String, age: Number, gender: String,
    city: String, caste: String, sect: String, monthlyIncome: String,
    maritalStatus: String, about: String, education: String, occupation: String,
    motherTongue: String, familyDetails: String, houseType: String, houseSize: String,
    requirements: String, height: String, weight: String, disability: String,
    package: { type: String, default: 'Basic Plan' },
    createdAt: { type: Date, default: Date.now }
};

const profileSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    ...sharedFields,
    mainImage: String,
    gallery: [String]
});

const userSchema = new mongoose.Schema({
    ...sharedFields,
    email: { type: String, unique: true, required: true, index: true },
    password: { type: String, required: true },
    viewLimit: { type: Number, default: 3 },
    viewedProfiles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Profile' }],
    isApproved: { type: Boolean, default: false },
    images: [String],
    paymentScreenshot: String,
    role: { type: String, default: 'user' }
});

userSchema.pre('save', async function () {
    if (this.isModified('package') || this.isNew) {
        this.viewLimit = getPackageLimit(this.package);
    }
});

const Profile = mongoose.model('Profile', profileSchema);
const User = mongoose.model('User', userSchema);

/* ================= DB CONNECTION & FORCE FIX ================= */
mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        console.log("✅ MongoDB Connected & Cloudinary Ready!");
        await fixExistingUsersForcefully();
    })
    .catch(err => console.error("❌ DB Error:", err));

async function fixExistingUsersForcefully() {
    try {
        const usersToFix = await User.find({ viewLimit: 0, role: 'user', package: { $ne: 'Standard' } });
        for (let user of usersToFix) {
            await User.updateOne({ _id: user._id }, { $set: { viewLimit: getPackageLimit(user.package) } });
        }
    } catch (e) { console.log("Fix script error:", e); }
}

/* ================= AUTH MIDDLEWARE ================= */
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ success: false, message: "Unauthorized" });
    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) { return res.status(401).json({ success: false, message: "Invalid token" }); }
};

/* ================= ROUTES (ALL IN ONE) ================= */

app.get('/', (req, res) => res.send('Assan Rishta API is Running...'));

// ✅ SETUP: ADMIN INITIALIZATION (FIXED 404)
app.post('/api/setup/admin-init', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        const existingAdmin = await User.findOne({ role: 'admin' });
        if (existingAdmin) return res.status(400).json({ success: false, message: "Admin already exists" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password || "admin123", salt);

        const admin = new User({
            name: name || "Admin",
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            role: 'admin',
            isApproved: true,
            package: 'Diamond Plan',
            viewLimit: 9999
        });

        await admin.save();
        res.json({ success: true, message: "✅ Admin created successfully!" });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ✅ AUTH: REGISTER
app.post('/api/users/register', upload.fields([{ name: 'images', maxCount: 10 }, { name: 'paymentScreenshot', maxCount: 1 }]), async (req, res) => {
    try {
        const { password, email, package: pkg, age } = req.body;
        const existingEmail = await User.findOne({ email: email.toLowerCase().trim() });
        if (existingEmail) return res.status(400).json({ success: false, message: "Email already registered!" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const userImages = (req.files && req.files['images']) ? req.files['images'].map(f => f.path) : [];
        const screenshot = (req.files && req.files['paymentScreenshot']) ? req.files['paymentScreenshot'][0].path : null;

        const newUser = new User({
            ...req.body,
            age: age ? Number(age) : null,
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            viewLimit: getPackageLimit(pkg),
            images: userImages,
            paymentScreenshot: screenshot,
            isApproved: false,
            role: 'user'
        });

        await newUser.save();
        res.json({ success: true, message: "Registered! Waiting for admin approval." });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ✅ AUTH: LOGIN
app.post('/api/users/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (!user) return res.status(401).json({ success: false, message: "User not found" });

        if (user.role !== 'admin' && !user.isApproved) return res.status(403).json({ success: false, message: "Account pending approval." });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ success: false, message: "Invalid credentials" });

        const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, user: { id: user._id, name: user.name, role: user.role, package: user.package, viewLimit: user.viewLimit } });
    } catch (err) { res.status(500).json({ error: "Server Error" }); }
});

// ✅ MATCHES: FETCHING
app.get('/api/users/matches', async (req, res) => {
    try {
        let currentUser = null;
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
                currentUser = await User.findById(decoded.userId);
            } catch (e) { }
        }

        let query = {};
        if (currentUser && currentUser.role !== 'admin') {
            const target = (currentUser.gender?.toLowerCase() === 'female') ? 'male' : 'female';
            query.gender = { $regex: new RegExp(`^${target}$`, "i") };
            query.userId = { $ne: currentUser._id };
        }

        let matches = await Profile.find(query).sort({ createdAt: -1 }).lean();
        const processed = matches.map(p => {
            let isLocked = true;
            if (currentUser) {
                const hasViewed = currentUser.viewedProfiles?.some(id => id.toString() === p._id.toString());
                if (hasViewed || currentUser.package === 'Diamond Plan' || currentUser.role === 'admin') isLocked = false;
            }
            const data = { ...p, mainImage: getFullUrl(req, p.mainImage), gallery: (p.gallery || []).map(img => getFullUrl(req, img)), isLocked };
            if (isLocked) { delete data.phone; delete data.fatherName; }
            return data;
        });
        res.json({ success: true, profiles: processed, credits: currentUser ? currentUser.viewLimit : 0 });
    } catch (err) { res.status(500).json({ error: "Fetch Error" }); }
});

// ✅ USER: UNLOCK PROFILE
app.post('/api/users/unlock-profile', authMiddleware, async (req, res) => {
    try {
        const { profileId } = req.body;
        const user = await User.findById(req.user.userId);
        if (user.viewedProfiles.includes(profileId)) return res.json({ success: true, message: "Already unlocked" });
        if (user.package !== 'Diamond Plan' && user.viewLimit <= 0) return res.status(400).json({ success: false, message: "No credits left." });
        if (user.package !== 'Diamond Plan') user.viewLimit -= 1;
        user.viewedProfiles.push(profileId);
        await user.save();
        res.json({ success: true, message: "Unlocked!", remainingCredits: user.viewLimit });
    } catch (err) { res.status(500).json({ success: false, message: "Server error" }); }
});

// ✅ ADMIN: GET ALL PROFILES
app.get('/api/admin/profiles', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });
        const profiles = await Profile.find().sort({ createdAt: -1 }).lean();
        res.json(profiles.map(p => ({ ...p, mainImage: getFullUrl(req, p.mainImage), gallery: (p.gallery || []).map(img => getFullUrl(req, img)) })));
    } catch (err) { res.status(500).json({ error: "Fetch failed" }); }
});

// ✅ ADMIN: GET PENDING REGISTRATIONS
app.get('/api/admin/registrations', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });
        const users = await User.find({ role: 'user', isApproved: false }).sort({ createdAt: -1 }).lean();
        res.json(users.map(u => ({ ...u, paymentScreenshot: getFullUrl(req, u.paymentScreenshot), images: (u.images || []).map(img => getFullUrl(req, img)) })));
    } catch (err) { res.status(500).json({ error: "Fetch failed" }); }
});

// ✅ ADMIN: MANUAL CREATE
router.post('/api/admin/profile/manual', authMiddleware, upload.array('images', 10), async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });
        const { email, password, package: pkg } = req.body;
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password || "123456", salt);
        const imageUrls = req.files ? req.files.map(file => file.path) : [];

        const newUser = new User({ ...req.body, email: email.toLowerCase().trim(), password: hashedPassword, images: imageUrls, isApproved: true, role: 'user', viewLimit: getPackageLimit(pkg) });
        const savedUser = await newUser.save();
        const newProfile = new Profile({ ...req.body, userId: savedUser._id, mainImage: imageUrls[0] || "", gallery: imageUrls });
        await newProfile.save();
        res.json({ success: true, message: "Profile Created!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ✅ ADMIN: APPROVE USER
app.put('/api/admin/approve/:userId', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });
        const user = await User.findById(req.params.userId);
        user.viewLimit = getPackageLimit(user.package);
        user.isApproved = true;
        await user.save();

        let profile = await Profile.findOne({ userId: user._id });
        const profileData = { userId: user._id, ...user.toObject(), mainImage: user.images[0] || "", gallery: user.images || [] };
        delete profileData._id;
        if (!profile) profile = new Profile(profileData); else Object.assign(profile, profileData);
        await profile.save();
        res.json({ success: true, message: "User Approved!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ✅ ADMIN: DELETE
app.delete(['/api/admin/registration/:id', '/api/admin/profile/:id'], authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });
        const id = req.params.id;
        const user = await User.findById(id);
        const profile = await Profile.findById(id);
        let uId = user ? user._id : (profile ? profile.userId : null);
        if (uId) await User.findByIdAndDelete(uId);
        await Profile.findOneAndDelete({ userId: uId });
        res.json({ success: true, message: "Deleted!" });
    } catch (err) { res.status(500).json({ error: "Delete failed" }); }
});

/* ================= SERVER START ================= */
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server on port ${PORT}`));