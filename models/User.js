const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    // Basic & Account Info
    name: { type: String, required: true },
    fatherName: { type: String },
    email: { type: String, required: true, unique: true },
    phone: { type: String },
    password: { type: String, required: true },

    // NEW: Role System (Admin vs User)
    role: { type: String, enum: ['user', 'admin'], default: 'user' },

    // Bio Details (Matching Frontend)
    age: { type: Number },
    gender: { type: String, enum: ['Male', 'Female'], default: 'Male' },
    city: { type: String },
    caste: { type: String },
    sect: { type: String },
    religion: { type: String, default: "Islam" },
    nationality: { type: String, default: "Pakistani" },
    motherTongue: { type: String },

    // Physical & Social
    height: { type: String },
    weight: { type: String },
    maritalStatus: { type: String },
    disability: { type: String, default: "None / No" },

    // Career & Lifestyle
    education: { type: String },
    occupation: { type: String }, // Profession
    monthlyIncome: { type: String },
    houseType: { type: String }, // Own / Rental
    houseSize: { type: String },

    // Requirements & Others
    about: { type: String },
    requirements: { type: String },
    familyDetails: { type: String },

    // Registration/Payment Info
    package: {
        type: String,
        enum: ['Basic', 'Gold', 'Diamond', 'Standard'],
        default: 'Standard'
    },
    price: { type: String },
    paymentScreenshot: { type: String }, // Cloudinary URL

    // NEW: Package Validity (Subscription management)
    packageExpiry: { type: Date },
    isPremium: { type: Boolean, default: false }, // Direct check for gold/diamond

    images: [{ type: String }], // Initial profile images

    // System Status
    isApproved: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true }, // To block/unblock user

    // NEW: User Activity (Favorites/Shortlist)
    shortlistedProfiles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    createdAt: { type: Date, default: Date.now }
});

// Pre-save logic (Optional): Agar package change ho to isPremium auto true ho jaye
userSchema.pre('save', function (next) {
    if (['Gold', 'Diamond'].includes(this.package)) {
        this.isPremium = true;
    } else {
        this.isPremium = false;
    }
    next();
});

module.exports = mongoose.model('User', userSchema);