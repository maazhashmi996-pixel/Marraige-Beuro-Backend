const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const helmet = require('helmet'); // Security headers
const compression = require('compression'); // Speed optimization

dotenv.config();
const app = express();

/* ================= PRODUCTION MIDDLEWARES ================= */
// Helmet security (crossOriginResourcePolicy: false takay images load hon)
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());

// CORS Configuration (Production mein origin ko apni domain par set karein)
const allowedOrigins = [process.env.FRONTEND_URL, 'http://localhost:3000'];
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

// Static Folder for Uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const dir = './uploads';
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

/* ================= HELPERS ================= */
const getFullUrl = (req, imgPath) => {
    if (!imgPath || imgPath === "undefined" || imgPath === "null") return "";
    if (imgPath.startsWith('http')) return imgPath;
    const fileName = path.basename(imgPath);
    // Production mein HTTPS check zaroori hai
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl = `${protocol}://${req.get('host')}`;
    return `${baseUrl}/uploads/${fileName}`;
};

/* ================= MONGODB CONNECTION ================= */
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected Production Mode!"))
    .catch(err => console.error("❌ DB Connection Error:", err));

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
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

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

/* ================= USER ROUTES ================= */

app.post('/api/users/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (!user) return res.status(401).json({ success: false, message: "User not found" });
        if (user.role !== 'admin' && !user.isApproved) return res.status(403).json({ success: false, message: "Account pending approval." });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ success: false, message: "Invalid credentials" });

        const token = jwt.sign(
            { userId: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user._id,
                name: user.name,
                role: user.role,
                package: user.package,
                viewLimit: user.viewLimit,
                gender: user.gender
            }
        });
    } catch (err) { res.status(500).json({ error: "Internal Server Error" }); }
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
        const newUser = new User({
            ...req.body,
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            viewLimit: limits[pkg] || 3,
            images: userImages,
            paymentScreenshot: screenshot,
            isApproved: false,
            role: 'user'
        });

        await newUser.save();
        res.json({ success: true, message: "Registered! Waiting for admin approval." });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

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
            const myGender = (currentUser.gender || "").trim().toLowerCase();
            const target = (myGender === 'female' || myGender === 'larki') ? 'male' : 'female';
            query.gender = { $regex: new RegExp(`^${target}$`, "i") };
            query.userId = { $ne: currentUser._id };
        }

        let matches = await Profile.find(query).sort({ createdAt: -1 }).lean();

        if (matches.length === 0) {
            const approvedUsers = await User.find({ ...query, isApproved: true, role: 'user' }).lean();
            matches = approvedUsers.map(u => ({
                ...u,
                userId: u._id,
                mainImage: u.images ? u.images[0] : "",
                gallery: u.images || []
            }));
        }

        const processed = matches.map(p => {
            let isLocked = true;
            const pid = (p._id || p.userId).toString();
            if (currentUser) {
                const hasViewed = currentUser.viewedProfiles?.some(id => id.toString() === pid);
                if (hasViewed || currentUser.package === 'Diamond Plan' || currentUser.role === 'admin') isLocked = false;
            }
            const data = {
                ...p,
                mainImage: getFullUrl(req, p.mainImage),
                gallery: (p.gallery || []).map(img => getFullUrl(req, img)),
                isLocked: isLocked
            };
            if (isLocked) { delete data.phone; delete data.fatherName; }
            return data;
        });

        res.json({
            success: true,
            profiles: processed,
            credits: currentUser ? currentUser.viewLimit : 0,
            unlockedProfiles: currentUser ? currentUser.viewedProfiles : []
        });

    } catch (err) {
        res.status(500).json({ success: false, error: "Fetch Error" });
    }
});

app.post('/api/users/unlock-profile', authMiddleware, async (req, res) => {
    try {
        const { profileId } = req.body;
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        if (user.viewedProfiles.includes(profileId)) {
            return res.json({ success: true, message: "Already unlocked" });
        }

        if (user.package !== 'Diamond Plan' && user.viewLimit <= 0) {
            return res.status(400).json({ success: false, message: "No credits left." });
        }

        if (user.package !== 'Diamond Plan') user.viewLimit -= 1;
        user.viewedProfiles.push(profileId);
        await user.save();

        res.json({ success: true, message: "Profile unlocked!", remainingCredits: user.viewLimit });
    } catch (err) { res.status(500).json({ success: false, message: "Server error" }); }
});

/* ================= ADMIN ROUTES ================= */

app.get('/api/admin/registrations', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });
        const users = await User.find({ role: 'user', isApproved: false }).sort({ createdAt: -1 }).lean();
        res.json(users.map(u => ({ ...u, paymentScreenshot: getFullUrl(req, u.paymentScreenshot), images: (u.images || []).map(img => getFullUrl(req, img)) })));
    } catch (err) { res.status(500).json({ error: "Fetch failed" }); }
});

app.put('/api/admin/approve/:userId', authMiddleware, async (req, res) => {
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
});

app.delete('/api/admin/registration/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });
        await User.findByIdAndDelete(req.params.id);
        await Profile.findOneAndDelete({ userId: req.params.id });
        res.json({ success: true, message: "Deleted" });
    } catch (err) { res.status(500).json({ error: "Delete failed" }); }
});

/* ================= SERVER START ================= */
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Production Server running on port ${PORT}`));