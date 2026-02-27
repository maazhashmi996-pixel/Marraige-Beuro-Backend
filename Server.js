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

// Ensure uploads directory exists
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

/* ================= AUTH MIDDLEWARE (FIXED FOR 403) ================= */
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: "Unauthorized: No token provided" });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        req.user = decoded; // Contains userId and role
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: "Unauthorized: Invalid token" });
    }
};

/* ================= SPECIAL: ADMIN ONE-TIME SETUP ================= */
app.post('/api/setup/admin-init', async (req, res) => {
    try {
        const adminExists = await User.findOne({ role: 'admin' });
        if (adminExists) return res.status(400).json({ success: false, message: "Admin already exists!" });
        const { email, password, name } = req.body;
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const newAdmin = new User({
            name, email, password: hashedPassword,
            role: 'admin', isApproved: true, package: 'Diamond', viewLimit: 999999
        });
        await newAdmin.save();
        res.json({ success: true, message: "Super Admin created!" });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

/* ================= AUTH & USER ROUTES ================= */
app.post('/api/users/register', upload.fields([
    { name: 'images', maxCount: 4 },
    { name: 'paymentScreenshot', maxCount: 1 }
]), async (req, res) => {
    try {
        const { password, email, package } = req.body;
        if (req.body.role === 'admin') return res.status(403).json({ success: false, message: "Cannot register as admin." });
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ success: false, message: "Email already registered!" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const userImages = req.files['images'] ? req.files['images'].map(f => `uploads/${f.filename}`) : [];
        const screenshotPath = req.files['paymentScreenshot'] ? `uploads/${req.files['paymentScreenshot'][0].filename}` : null;

        const limits = { 'Basic': 3, 'Gold': 10, 'Diamond': 999999 };
        const newUser = new User({
            ...req.body, password: hashedPassword, viewLimit: limits[package] || 0,
            images: userImages, paymentScreenshot: screenshotPath, isApproved: false, role: 'user'
        });
        await newUser.save();
        res.json({ success: true, message: "Registered! Waiting for approval." });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/users/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(401).json({ success: false, message: "User not found" });

        if (user.role !== 'admin' && !user.isApproved) {
            return res.status(403).json({ success: false, message: "Account pending approval." });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ success: false, message: "Invalid credentials" });

        const token = jwt.sign(
            { userId: user._id, role: user.role || 'user' },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            token,
            user: { id: user._id, name: user.name, role: user.role, package: user.package }
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ================= MATCHES ROUTE ================= */
app.get('/api/users/matches', authMiddleware, async (req, res) => {
    try {
        const currentUser = await User.findById(req.user.userId);
        let query = { isApproved: true };

        if (currentUser && currentUser.role !== 'admin') {
            query.gender = currentUser.gender === 'Male' ? 'Female' : 'Male';
            query.userId = { $ne: currentUser._id };
        }

        const profiles = await Profile.find(query).sort({ createdAt: -1 }).lean();
        const safeMatches = profiles.map(p => {
            let isLocked = true;
            if (currentUser) {
                const isUnlocked = currentUser.viewedProfiles?.some(id => id.toString() === p._id.toString());
                if (isUnlocked || currentUser.package === 'Diamond' || currentUser.role === 'admin') isLocked = false;
            }
            const data = {
                ...p,
                mainImage: getFullUrl(req, p.mainImage),
                gallery: (p.gallery || []).map(img => getFullUrl(req, img))
            };
            if (isLocked) { delete data.phone; data.isLocked = true; } else { data.isLocked = false; }
            return data;
        });
        res.json({ success: true, profiles: safeMatches });
    } catch (err) { res.status(500).json({ error: "Failed to fetch matches" }); }
});

/* ================= ADMIN MANAGEMENT ================= */

// 1. Get Registrations
app.get('/api/admin/registrations', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });
        const users = await User.find({ role: 'user' }).sort({ createdAt: -1 }).lean();
        res.json(users.map(u => ({
            ...u,
            paymentScreenshot: getFullUrl(req, u.paymentScreenshot),
            images: (u.images || []).map(img => getFullUrl(req, img))
        })));
    } catch (err) { res.status(500).json({ error: "Fetch failed" }); }
});

// 2. Get Profiles
app.get('/api/admin/profiles', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });
        const profiles = await Profile.find().sort({ createdAt: -1 }).lean();
        res.json(profiles.map(p => ({
            ...p,
            mainImage: getFullUrl(req, p.mainImage),
            gallery: (p.gallery || []).map(img => getFullUrl(req, img))
        })));
    } catch (err) { res.status(500).json({ error: "Fetch failed" }); }
});

// 3. Create Profile (Fixed with Any File Handling)
app.post('/api/admin/create-profile', authMiddleware, upload.any(), async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });

        const { email, password } = req.body;
        if (!email) return res.status(400).json({ success: false, message: "Email is required" });

        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ success: false, message: "User already exists!" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password || '123456', salt);

        const newUser = new User({
            ...req.body,
            password: hashedPassword,
            isApproved: true,
            role: 'user'
        });
        const savedUser = await newUser.save();

        let mainImg = "";
        let gall = [];
        if (req.files) {
            req.files.forEach(file => {
                const imgPath = `uploads/${file.filename}`;
                if (file.fieldname === 'mainImage' || file.fieldname === 'image') {
                    mainImg = imgPath;
                } else {
                    gall.push(imgPath);
                }
            });
            if (!mainImg && gall.length > 0) mainImg = gall[0];
        }

        const newProfile = new Profile({
            ...req.body,
            userId: savedUser._id,
            mainImage: mainImg,
            gallery: gall
        });
        await newProfile.save();
        res.json({ success: true, message: "Profile Created Successfully!" });
    } catch (err) {
        console.error("Admin Create Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// 4. Approve User
app.put('/api/admin/approve/:userId', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        const existingProfile = await Profile.findOne({ userId: user._id });
        if (!existingProfile) {
            const userData = user.toObject();
            const originalUserId = userData._id;
            delete userData._id; delete userData.password;
            const newProfile = new Profile({
                ...userData,
                userId: originalUserId,
                mainImage: user.images[0] || "",
                gallery: user.images
            });
            await newProfile.save();
        }
        user.isApproved = true;
        await user.save();
        res.json({ success: true, message: "Approved!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. Delete Registration
app.delete('/api/admin/registration/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });
        await User.findByIdAndDelete(req.params.id);
        await Profile.findOneAndDelete({ userId: req.params.id });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Delete failed" }); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server Live on http://localhost:${PORT}`));