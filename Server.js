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
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const dir = './uploads';
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

/* ================= HELPERS ================= */
const getFullUrl = (req, imgPath) => {
    if (!imgPath || imgPath === "undefined" || imgPath === "null") return "";
    if (imgPath.startsWith('http') || imgPath.startsWith('data:')) return imgPath;
    const fileName = path.basename(imgPath);
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl = `${protocol}://${req.get('host')}`;
    return `${baseUrl}/uploads/${fileName}`;
};

// Credit Mapping Helper
const getPackageLimit = (pkgName) => {
    const limits = {
        'Basic Plan': 3, 'Basic': 3,
        'Gold Plan': 10, 'Gold': 10,
        'Diamond Plan': 9999, 'Diamond': 9999,
        'Standard': 0
    };
    return limits[pkgName] || 3;
};

/* ================= MONGODB & FORCE FIX ================= */
mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        console.log("✅ MongoDB Connected!");
        await fixExistingUsersForcefully();
    })
    .catch(err => console.error("❌ DB Error:", err));

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

// Pre-save backup logic
userSchema.pre('save', function (next) {
    if (this.isModified('package') || this.isNew) {
        this.viewLimit = getPackageLimit(this.package);
    }
    next();
});

const Profile = mongoose.model('Profile', profileSchema);
const User = mongoose.model('User', userSchema);

async function fixExistingUsersForcefully() {
    try {
        const usersToFix = await User.find({ viewLimit: 0, role: 'user', package: { $ne: 'Standard' } });
        for (let user of usersToFix) {
            await User.updateOne({ _id: user._id }, { $set: { viewLimit: getPackageLimit(user.package) } });
        }
        if (usersToFix.length > 0) console.log(`🛠️ System: Fixed ${usersToFix.length} legacy users.`);
    } catch (e) { console.log("Fix script error:", e); }
}

/* ================= MULTER CONFIG ================= */
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s/g, '_'));
    }
});
const upload = multer({ storage: storage, limits: { fileSize: 100 * 1024 * 1024 } });

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

/* ================= ROUTES ================= */

app.get('/', (req, res) => res.send('Assan Rishta API is Running...'));

// ✅ 1. MATCHES FETCHING
app.get(['/api/users/matches', '/users/matches'], async (req, res) => {
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
            const target = (myGender === 'female' || myGender === 'larki' || myGender === 'aurat') ? 'male' : 'female';
            query.gender = { $regex: new RegExp(`^${target}$`, "i") };
            query.userId = { $ne: currentUser._id };
        }

        let matches = await Profile.find(query).sort({ createdAt: -1 }).lean();

        const processed = matches.map(p => {
            let isLocked = true;
            const profileId = p._id.toString();

            if (currentUser) {
                const hasViewed = currentUser.viewedProfiles?.some(id => id.toString() === profileId);
                if (hasViewed || currentUser.package === 'Diamond Plan' || currentUser.role === 'admin') {
                    isLocked = false;
                }
            }

            const data = {
                ...p,
                mainImage: getFullUrl(req, p.mainImage),
                gallery: (p.gallery || []).map(img => getFullUrl(req, img)),
                isLocked: isLocked
            };

            if (isLocked) {
                delete data.phone;
                delete data.fatherName;
            }
            return data;
        });

        res.json({ success: true, profiles: processed, credits: currentUser ? currentUser.viewLimit : 0 });
    } catch (err) { res.status(500).json({ error: "Fetch Error" }); }
});

// ✅ 2. ADMIN: MANUAL PROFILE CREATION (FIXED FOR NEW USERS)
app.post(['/api/admin/profile/manual', '/admin/profile/manual'], authMiddleware, upload.fields([{ name: 'images', maxCount: 10 }]), async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });
        const { email, password, package: pkg, ...restData } = req.body;

        const existing = await User.findOne({ email: email.toLowerCase().trim() });
        if (existing) return res.status(400).json({ success: false, message: "Email already exists" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password || "123456", salt);

        const newUser = new User({
            ...restData,
            package: pkg || 'Basic Plan',
            viewLimit: getPackageLimit(pkg || 'Basic Plan'), // 🔥 DIRECT ASSIGN
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            isApproved: true,
            role: 'user'
        });
        const savedUser = await newUser.save();

        let profileImages = [];
        if (req.files && req.files['images']) {
            profileImages = req.files['images'].map(f => f.filename);
        }

        const newProfile = new Profile({
            ...restData,
            package: pkg || 'Basic Plan',
            userId: savedUser._id,
            mainImage: profileImages[0] || "",
            gallery: profileImages
        });
        await newProfile.save();

        res.status(200).json({ success: true, message: `✅ Profile Created with ${savedUser.viewLimit} credits!` });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ✅ 3. ADMIN: APPROVE USER (FIXED)
app.put(['/api/admin/approve/:userId', '/admin/approve/:userId'], authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });

        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        user.viewLimit = getPackageLimit(user.package); // 🔥 RE-SYNC ON APPROVAL
        user.isApproved = true;
        await user.save();

        let profile = await Profile.findOne({ userId: user._id });
        const profileData = {
            userId: user._id,
            ...user.toObject(),
            mainImage: user.images && user.images.length > 0 ? user.images[0] : "",
            gallery: user.images || []
        };
        delete profileData._id;

        if (!profile) { profile = new Profile(profileData); }
        else { Object.assign(profile, profileData); }

        await profile.save();
        res.json({ success: true, message: "User Approved with " + user.viewLimit + " credits!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ✅ 4. USER: UNLOCK PROFILE
app.post(['/api/users/unlock-profile', '/users/unlock-profile'], authMiddleware, async (req, res) => {
    try {
        const { profileId } = req.body;
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        if (user.viewedProfiles.includes(profileId)) return res.json({ success: true, message: "Already unlocked" });

        if (user.package !== 'Diamond Plan' && user.viewLimit <= 0) {
            return res.status(400).json({ success: false, message: "No credits left." });
        }

        if (user.package !== 'Diamond Plan') {
            user.viewLimit -= 1;
        }

        user.viewedProfiles.push(profileId);
        await user.save();
        res.json({ success: true, message: "Unlocked!", remainingCredits: user.viewLimit });
    } catch (err) { res.status(500).json({ success: false, message: "Server error" }); }
});

// ✅ 5. USER: REGISTRATION (FIXED FOR NEW USERS)
app.post(['/api/users/register', '/users/register'], upload.fields([{ name: 'images', maxCount: 10 }, { name: 'paymentScreenshot', maxCount: 1 }]), async (req, res) => {
    try {
        const { password, email, package: pkg } = req.body;
        const existingEmail = await User.findOne({ email: email.toLowerCase().trim() });
        if (existingEmail) return res.status(400).json({ success: false, message: "Email already registered!" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({
            ...req.body,
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            viewLimit: getPackageLimit(pkg), // 🔥 FORAN CREDITS ASSIGN
            images: req.files['images'] ? req.files['images'].map(f => f.filename) : [],
            paymentScreenshot: req.files['paymentScreenshot'] ? req.files['paymentScreenshot'][0].filename : null,
            isApproved: false,
            role: 'user'
        });

        await newUser.save();
        res.json({ success: true, message: "Registered successfully! Waiting for admin approval." });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ✅ 6. USER: LOGIN
app.post(['/api/users/login', '/users/login'], async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (!user) return res.status(401).json({ success: false, message: "User not found" });

        if (user.role !== 'admin' && !user.isApproved) {
            return res.status(403).json({ success: false, message: "Account pending approval." });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ success: false, message: "Invalid credentials" });

        const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({
            success: true,
            token,
            user: { id: user._id, name: user.name, role: user.role, package: user.package, viewLimit: user.viewLimit }
        });
    } catch (err) { res.status(500).json({ error: "Server Error" }); }
});

// ✅ 8. ADMIN: GET ALL PROFILES
app.get(['/api/admin/profiles', '/admin/profiles'], authMiddleware, async (req, res) => {
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

// ✅ 9. ADMIN: GET PENDING
app.get(['/api/admin/registrations', '/admin/registrations'], authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });
        const users = await User.find({ role: 'user', isApproved: false }).sort({ createdAt: -1 }).lean();
        res.json(users.map(u => ({
            ...u,
            paymentScreenshot: getFullUrl(req, u.paymentScreenshot),
            images: (u.images || []).map(img => getFullUrl(req, img))
        })));
    } catch (err) { res.status(500).json({ error: "Fetch failed" }); }
});

// ✅ 10. ADMIN: DELETE
app.delete(['/api/admin/registration/:id', '/api/admin/profile/:id'], authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Access denied" });
        const id = req.params.id;

        // Find by ID directly
        const user = await User.findById(id);
        const profile = await Profile.findById(id);

        let uId = user ? user._id : null;
        let pId = profile ? profile._id : null;

        // If it's a profile ID, find associated User
        if (profile && !uId) uId = profile.userId;
        // If it's a user ID, find associated Profile
        if (user && !pId) {
            const linkedP = await Profile.findOne({ userId: user._id });
            if (linkedP) pId = linkedP._id;
        }

        if (uId) await User.findByIdAndDelete(uId);
        if (pId) await Profile.findByIdAndDelete(pId);

        res.json({ success: true, message: "Permanently deleted" });
    } catch (err) { res.status(500).json({ error: "Delete failed" }); }
});

/* ================= SERVER START ================= */
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server on port ${PORT}`));