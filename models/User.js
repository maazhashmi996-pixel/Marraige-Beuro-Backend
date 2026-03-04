const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    fatherName: { type: String, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    phone: { type: String, required: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },

    age: { type: Number },
    gender: { type: String },
    city: { type: String },
    caste: { type: String },
    sect: { type: String },
    religion: { type: String, default: "Islam" },
    nationality: { type: String, default: "Pakistani" },
    motherTongue: { type: String, default: "Urdu" },

    height: { type: String },
    weight: { type: String },
    maritalStatus: { type: String },
    disability: { type: String, default: "None / No" },

    education: { type: String },
    occupation: { type: String },
    monthlyIncome: { type: String },
    houseType: { type: String, default: "Own" },
    houseSize: { type: String },

    about: { type: String },
    requirements: { type: String },
    familyDetails: { type: String },

    // Fixed: Matches the names sent from your frontend/routes
    package: {
        type: String,
        enum: ['Basic Plan', 'Gold Plan', 'Diamond Plan', 'Standard'],
        default: 'Basic Plan'
    },
    paymentScreenshot: { type: String },

    // Fixed: Changed from 'credits' to 'viewLimit' to match your API routes
    viewLimit: { type: Number, default: 3 },
    isApproved: { type: Boolean, default: false },
    images: [{ type: String }],
    mainImage: { type: String },

    viewedProfiles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Profile' }],
    shortlistedProfiles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

}, { timestamps: true });

// --- Pre-save Logic: Credits Management ---
userSchema.pre('save', function (next) {
    // 1. Automated Credits Assignment based on exact Package string
    if (this.isModified('package') || this.isNew) {
        const limitsMap = {
            'Basic Plan': 3,
            'Gold Plan': 10,
            'Diamond Plan': 9999,
            'Standard': 0
        };
        // Set the credit
        this.viewLimit = limitsMap[this.package] || 3;
    }

    // 2. Set Main Image from images array if not set
    if (this.images && this.images.length > 0 && !this.mainImage) {
        this.mainImage = this.images[0];
    }

    next();
});

module.exports = mongoose.model('User', userSchema);