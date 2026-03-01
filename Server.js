const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const compression = require('compression');

dotenv.config();
const app = express();

/* ================= MIDDLEWARES ================= */
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());

const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'https://www.assanrishta.com',
    'https://assanrishta.com'
];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const dir = './uploads';
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

/* ================= HELPERS ================= */
const getFullUrl = (req, imgPath) => {
    if (!imgPath || imgPath === "undefined" || imgPath === "null") return "";
    if (imgPath.startsWith('http')) return imgPath;
    const fileName = path.basename(imgPath);
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl = `${protocol}://${req.get('host')}`;
    return `${baseUrl}/uploads/${fileName}`;
};

/* ================= MONGODB ================= */
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected!"))
    .catch(err => console.error("❌ DB Error:", err));

/* ================= SCHEMAS ================= */
const sharedFields = {
    name: String, fatherName: String, phone: String, age: Number, gender: String,
    city: String, caste: String, sect: String, monthlyIncome: String,
    maritalStatus: String, about: String, education: String, occupation: String,
    motherTongue: String, houseType: String, houseSize: String, requirements: String,
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
    package: { type: String, required: true, default: 'Basic Plan' },
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
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s/g, '_'));
    }
});
const upload = multer({ storage: storage, limits: { fileSize: 5 * 1024 * 1024 } });

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

/* ================= ADMIN & SETUP ROUTES ================= */

// Setup Admin Initial
app.post('/api/setup/admin-init', async (req, res) => {
    try {
        const { email, password, name, secretKey } = req.body;
        if (secretKey !== "ASSAN_RISHTA_786") return res.status(403).json({ success: false, message: "Invalid Secret Key" });
        const existingAdmin = await User.findOne({ email: email.toLowerCase().trim() });
        if (existingAdmin) return res.status(400).json({ success: false, message: "Admin already exists!" });
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const newAdmin = new User({
            name: name || "Super Admin", email: email.toLowerCase().trim(),
            password: hashedPassword, role: 'admin', isApproved: true,
            package: 'Diamond Plan', viewLimit: 999999
        });
        await newAdmin.save();
        res.json({ success: true, message: "✅ Admin Created!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Manual Profile Creation Handler
const manualProfileHandler = async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });
        const profileImages = req.files['images'] ? req.files['images'].map(f => f.filename) : [];
        const newProfile = new Profile({
            ...req.body,
            mainImage: profileImages[0] || "",
            gallery: profileImages
        });
        await newProfile.save();
        res.json({ success: true, message: "✅ Profile Created Manually!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
};
app.post('/api/admin/profile/manual', authMiddleware, upload.fields([{ name: 'images', maxCount: 10 }]), manualProfileHandler);
app.post('/admin/profile/manual', authMiddleware, upload.fields([{ name: 'images', maxCount: 10 }]), manualProfileHandler);

// Admin Stats
const getStats = async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });
        const totalUsers = await User.countDocuments({ role: 'user' });
        const pendingApprovals = await User.countDocuments({ isApproved: false, role: 'user' });
        const totalProfiles = await Profile.countDocuments();
        res.json({ totalUsers, pendingApprovals, totalProfiles });
    } catch (err) { res.status(500).json({ error: "Stats failed" }); }
};
app.get('/api/admin/stats', authMiddleware, getStats);
app.get('/admin/stats', authMiddleware, getStats);

// Registrations (Pending)
const getRegistrations = async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });
        const users = await User.find({ role: 'user', isApproved: false }).sort({ createdAt: -1 }).lean();
        res.json(users.map(u => ({
            ...u,
            paymentScreenshot: getFullUrl(req, u.paymentScreenshot),
            images: (u.images || []).map(img => getFullUrl(req, img))
        })));
    } catch (err) { res.status(500).json({ error: "Fetch failed" }); }
};
app.get('/api/admin/registrations', authMiddleware, getRegistrations);
app.get('/admin/registrations', authMiddleware, getRegistrations);

// All Profiles Management
const getProfiles = async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });
        const profiles = await Profile.find().sort({ createdAt: -1 }).lean();
        res.json(profiles.map(p => ({
            ...p,
            mainImage: getFullUrl(req, p.mainImage),
            gallery: (p.gallery || []).map(img => getFullUrl(req, img))
        })));
    } catch (err) { res.status(500).json({ error: "Fetch failed" }); }
};
app.get('/api/admin/profiles', authMiddleware, getProfiles);
app.get('/admin/profiles', authMiddleware, getProfiles);

// Approve User
const approveUser = async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ message: "User not found" });
        user.isApproved = true;
        await user.save();
        const existingProfile = await Profile.findOne({ userId: user._id });
        if (!existingProfile) {
            const userData = user.toObject();
            const originalId = userData._id;
            const images = userData.images || [];
            delete userData._id; delete userData.password; delete userData.images; delete userData.__v;
            const newProfile = new Profile({ ...userData, userId: originalId, mainImage: images[0] || "", gallery: images });
            await newProfile.save();
        }
        res.json({ success: true, message: "User Approved!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
};
app.put('/api/admin/approve/:userId', authMiddleware, approveUser);
app.put('/admin/approve/:userId', authMiddleware, approveUser);

// Delete User/Profile
const deleteUser = async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });
        const id = req.params.id;
        await User.findByIdAndDelete(id);
        await Profile.findOneAndDelete({ userId: id });
        res.json({ success: true, message: "Deleted successfully" });
    } catch (err) { res.status(500).json({ error: "Delete failed" }); }
};
app.delete('/api/admin/registration/:id', authMiddleware, deleteUser);
app.delete('/admin/registration/:id', authMiddleware, deleteUser);

/* ================= USER ROUTES ================= */

app.post('/api/users/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (!user) return res.status(401).json({ success: false, message: "User not found" });
        if (user.role !== 'admin' && !user.isApproved) return res.status(403).json({ success: false, message: "Account pending approval." });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ success: false, message: "Invalid credentials" });
        const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, user: { id: user._id, name: user.name, role: user.role, package: user.package, viewLimit: user.viewLimit, gender: user.gender } });
    } catch (err) { res.status(500).json({ error: "Server Error" }); }
});

app.post('/api/users/register', upload.fields([{ name: 'images', maxCount: 10 }, { name: 'paymentScreenshot', maxCount: 1 }]), async (req, res) => {
    try {
        const { password, email, package: pkg } = req.body;
        const existingEmail = await User.findOne({ email: email.toLowerCase().trim() });
        if (existingEmail) return res.status(400).json({ success: false, message: "Email already registered!" });
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const userImages = req.files['images'] ? req.files['images'].map(f => f.filename) : [];
        const screenshot = req.files['paymentScreenshot'] ? req.files['paymentScreenshot'][0].filename : null;
        const limits = { 'Basic Plan': 3, 'Gold Plan': 10, 'Diamond Plan': 999999 };
        const newUser = new User({ ...req.body, email: email.toLowerCase().trim(), password: hashedPassword, viewLimit: limits[pkg] || 3, images: userImages, paymentScreenshot: screenshot, isApproved: false, role: 'user' });
        await newUser.save();
        res.json({ success: true, message: "Registered! Waiting approval." });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users/matches', async (req, res) => {
    try {
        let currentUser = null;
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            try { const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET); currentUser = await User.findById(decoded.userId); } catch (e) { }
        }
        let query = {};
        if (currentUser && currentUser.role !== 'admin') {
            const myGender = (currentUser.gender || "").trim().toLowerCase();
            const target = (myGender === 'female' || myGender === 'larki') ? 'male' : 'female';
            query.gender = { $regex: new RegExp(`^${target}$`, "i") };
            query.userId = { $ne: currentUser._id };
        }
        let matches = await Profile.find(query).sort({ createdAt: -1 }).lean();
        const processed = matches.map(p => {
            let isLocked = true;
            const pid = (p._id || p.userId).toString();
            if (currentUser) {
                const hasViewed = currentUser.viewedProfiles?.some(id => id.toString() === pid);
                if (hasViewed || currentUser.package === 'Diamond Plan' || currentUser.role === 'admin') isLocked = false;
            }
            const data = { ...p, mainImage: getFullUrl(req, p.mainImage), gallery: (p.gallery || []).map(img => getFullUrl(req, img)), isLocked: isLocked };
            if (isLocked) { delete data.phone; delete data.fatherName; }
            return data;
        });
        res.json({ success: true, profiles: processed, credits: currentUser ? currentUser.viewLimit : 0 });
    } catch (err) { res.status(500).json({ error: "Fetch Error" }); }
});

app.post('/api/users/unlock-profile', authMiddleware, async (req, res) => {
    try {
        const { profileId } = req.body;
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        if (user.viewedProfiles.includes(profileId)) return res.json({ success: true, message: "Already unlocked" });
        if (user.package !== 'Diamond Plan' && user.viewLimit <= 0) return res.status(400).json({ success: false, message: "No credits left." });
        if (user.package !== 'Diamond Plan') user.viewLimit -= 1;
        user.viewedProfiles.push(profileId);
        await user.save();
        res.json({ success: true, message: "Profile unlocked!", remainingCredits: user.viewLimit });
    } catch (err) { res.status(500).json({ success: false, message: "Server error" }); }
});

/* ================= SERVER START ================= */
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server on port ${PORT}`));