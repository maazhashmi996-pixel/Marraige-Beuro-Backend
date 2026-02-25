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
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const dir = './uploads';
if (!fs.existsSync(dir)) fs.mkdirSync(dir);

/* ================= MONGODB CONNECTION ================= */
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected!"))
    .catch(err => console.error("❌ DB Connection Error:", err));

/* ================= SCHEMAS ================= */
const profileSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: String,
    fatherName: String,
    title: String,
    age: Number,
    gender: String,
    city: String,
    caste: String,
    sect: String,
    religion: String,
    height: String,
    weight: String,
    maritalStatus: String,
    education: String,
    profession: String,
    monthlyIncome: String,
    motherTongue: String,
    houseType: String,
    houseSize: String,
    disability: String,
    requirements: String,
    about: String,
    familyDetails: String,
    mainImage: String,
    gallery: [String],
    createdAt: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    phone: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    package: { type: String, required: true },
    viewLimit: { type: Number, default: 0 },
    viewedProfiles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Profile' }],
    isApproved: { type: Boolean, default: false },
    images: [String],
    paymentScreenshot: String,
    createdAt: { type: Date, default: Date.now }
});

const Profile = mongoose.model('Profile', profileSchema);
const User = mongoose.model('User', userSchema);

/* ================= MULTER CONFIGURATION ================= */
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
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) { res.status(401).json({ message: "Invalid Token" }); }
};

/* ================= ROUTES ================= */

// 1. ADMIN LOGIN
app.post('/api/auth/admin-login', (req, res) => {
    const { email, password } = req.body;
    if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
        const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '24h' });
        return res.json({ success: true, token, user: { role: 'admin', name: 'System Admin' } });
    }
    res.status(401).json({ success: false, message: "Ghalat Admin Email ya Password!" });
});

// 2. USER REGISTRATION
app.post('/api/users/register', upload.fields([
    { name: 'images', maxCount: 4 },
    { name: 'paymentScreenshot', maxCount: 1 }
]), async (req, res) => {
    try {
        const { password, email } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ success: false, message: "Email already registered!" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const userImages = req.files['images'] ? req.files['images'].map(f => `${baseUrl}/uploads/${f.filename}`) : [];
        const screenshotPath = req.files['paymentScreenshot'] ? `${baseUrl}/uploads/${req.files['paymentScreenshot'][0].filename}` : null;

        const limits = { 'Basic': 10, 'Gold': 20, 'Diamond': 50, 'Standard': 15 };

        const newUser = new User({
            ...req.body,
            password: hashedPassword,
            viewLimit: limits[req.body.package] || 0,
            images: userImages,
            paymentScreenshot: screenshotPath,
            isApproved: false
        });
        await newUser.save();
        res.json({ success: true, message: "Registered Successfully! Wait for admin approval." });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. USER LOGIN
app.post('/api/users/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ success: false, message: "User not found." });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ success: false, message: "Incorrect password." });

        if (!user.isApproved) return res.status(403).json({ success: false, message: "Account pending approval." });

        const token = jwt.sign({ userId: user._id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, user: { id: user._id, name: user.name, role: 'user' } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. GET USER MATCHES (FIXED: Added this route for matches page)
app.get('/api/users/matches', authMiddleware, async (req, res) => {
    try {
        const profiles = await Profile.find().sort({ createdAt: -1 });
        res.json(profiles);
    } catch (err) { res.status(500).json({ error: "Fetch failed" }); }
});

// 5. UNLOCK PROFILE (FIXED: Added this for contact unlock)
app.post('/api/users/unlock-profile', authMiddleware, async (req, res) => {
    try {
        const { profileId } = req.body;
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        if (user.viewLimit <= 0) return res.status(403).json({ message: "Limit exhausted!" });

        if (!user.viewedProfiles.includes(profileId)) {
            user.viewLimit -= 1;
            user.viewedProfiles.push(profileId);
            await user.save();
        }
        res.json({ success: true, viewLimit: user.viewLimit });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ================= ADMIN MANAGEMENT ROUTES ================= */
app.get('/api/admin/registrations', authMiddleware, async (req, res) => {
    try {
        const users = await User.find().sort({ createdAt: -1 });
        res.json(users);
    } catch (err) { res.status(500).json({ error: "Fetch failed" }); }
});

app.put('/api/admin/approve/:userId', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        const newProfile = new Profile({
            userId: user._id,
            name: user.name,
            age: user.age,
            city: user.city,
            caste: user.caste,
            mainImage: user.images[0] || "",
            gallery: user.images,
            title: `New Rishta - ${user.city}`
        });

        await newProfile.save();
        user.isApproved = true;
        await user.save();
        res.json({ success: true, message: "Approved!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/registration/:id', authMiddleware, async (req, res) => {
    try { await User.findByIdAndDelete(req.params.id); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: "Delete failed" }); }
});

/* ================= SERVER START ================= */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`✅ Server live on port ${PORT}`);
});