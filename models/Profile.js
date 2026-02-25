const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    // --- 1. Basic & Account Info (Old Logic) ---
    name: { type: String, required: true },
    fatherName: { type: String },
    email: { type: String, required: true, unique: true },
    phone: { type: String },
    password: { type: String, required: true },
    role: { type: String, default: 'user' }, // 'admin' or 'user'

    // --- 2. Bio & Personal Details (Old Logic) ---
    age: { type: Number },
    gender: { type: String, enum: ['Male', 'Female'], default: 'Male' },
    city: { type: String },
    caste: { type: String },
    sect: { type: String },
    religion: { type: String, default: "Islam" },
    nationality: { type: String, default: "Pakistani" },
    motherTongue: { type: String },
    height: { type: String },
    weight: { type: String },
    maritalStatus: { type: String },
    disability: { type: String, default: "None / No" },

    // --- 3. Career & Lifestyle (Old Logic) ---
    education: { type: String },
    occupation: { type: String },
    monthlyIncome: { type: String },
    houseType: { type: String },
    houseSize: { type: String },
    about: { type: String },
    requirements: { type: String },
    familyDetails: { type: String },

    // --- 4. Payment & Images (Old Logic) ---
    price: { type: String },
    paymentScreenshot: { type: String },
    images: [{ type: String }],

    // --- 5. NEW Tier & Package Logic (Updated) ---
    packageType: {
        type: String,
        enum: ['Basic', 'Gold', 'Diamond', 'Standard', 'None'],
        default: 'Standard'
    },
    viewLimit: { type: Number, default: 0 },    // Basic: 3, Gold: 10, Diamond: 999
    viewedCount: { type: Number, default: 0 },  // Kitni dekh chuka hai

    // Un Profiles ki IDs jo user ne "Unlock" kar li hain
    unlockedProfiles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // --- 6. System Status (Old + New) ---
    isApproved: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    expiryDate: { type: Date },
    createdAt: { type: Date, default: Date.now }
});

// Virtual or Helper to check if package is expired
UserSchema.virtual('isExpired').get(function () {
    if (!this.expiryDate) return false;
    return Date.now() > this.expiryDate;
});

module.exports = mongoose.model('User', UserSchema);