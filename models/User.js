const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    // --- Basic & Account Info ---
    name: { type: String, required: true, trim: true },
    fatherName: { type: String, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    phone: { type: String, required: true },
    password: { type: String, required: true },

    // Role System
    role: { type: String, enum: ['user', 'admin'], default: 'user' },

    // --- Bio Details ---
    age: { type: Number },
    gender: { type: String, enum: ['Male', 'Female'], default: 'Male' },
    city: { type: String },
    caste: { type: String },
    sect: { type: String },
    religion: { type: String, default: "Islam" },
    nationality: { type: String, default: "Pakistani" },
    motherTongue: { type: String, default: "Urdu" },

    // --- Physical & Social ---
    height: { type: String },
    weight: { type: String },
    maritalStatus: { type: String },
    disability: { type: String, default: "None / No" },

    // --- Career & Lifestyle ---
    education: { type: String },
    occupation: { type: String },
    // Frontend 'monthlyIncome' ko 'income' map kiya gaya hai consistency ke liye
    income: { type: String },
    houseType: { type: String, default: "Own" },
    houseSize: { type: String },

    // --- Requirements & Others ---
    about: { type: String },
    requirements: { type: String },
    familyDetails: { type: String },

    // --- Registration & Payment Info ---
    package: {
        type: String,
        enum: ['Basic', 'Gold', 'Diamond', 'Standard'],
        default: 'Standard'
    },
    price: { type: String },
    paymentScreenshot: { type: String }, // Path to the file

    // --- Subscription & Credits ---
    packageExpiry: { type: Date },
    isPremium: { type: Boolean, default: false },
    credits: { type: Number, default: 0 },
    viewedCount: { type: Number, default: 0 },

    // --- Images System ---
    images: [{ type: String }], // Array for up to 4 images
    mainImage: { type: String },

    // --- System Status ---
    isApproved: { type: Boolean, default: false }, // Admin will toggle this
    isActive: { type: Boolean, default: true },

    // --- User Activity Tracking ---
    shortlistedProfiles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    unlockedProfiles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

}, { timestamps: true });

// --- Pre-save Logic: Package & Credits Management ---
userSchema.pre('save', function (next) {
    // 1. Premium Status Logic
    if (['Gold', 'Diamond', 'Basic'].includes(this.package)) {
        this.isPremium = true;
    } else {
        this.isPremium = false;
    }

    // 2. Automated Credits Assignment based on Package
    // Only set credits if the package field is changed (new user or upgrade)
    if (this.isModified('package')) {
        const creditsMap = {
            'Basic': 5,
            'Gold': 15,
            'Diamond': 40,
            'Standard': 0
        };
        this.credits = creditsMap[this.package] || 0;

        // Expiry Date Set (e.g., 30 days from now)
        let expiry = new Date();
        expiry.setDate(expiry.getDate() + 30);
        this.packageExpiry = expiry;
    }

    // 3. Set Main Image from images array if not set
    if (this.images && this.images.length > 0 && !this.mainImage) {
        this.mainImage = this.images[0];
    }

    next();
});

module.exports = mongoose.model('User', userSchema);