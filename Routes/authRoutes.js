const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Admin Login API (Pehalay wala logic mehfooz hai)
app.post('/api/auth/admin-login', async (req, res) => {
    const { email, password } = req.body;

    if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
        // Role 'admin' pass ho raha hai dashboard access ke liye
        const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '24h' });
        return res.json({
            success: true,
            token,
            role: 'admin'
        });
    }

    res.status(401).json({ success: false, message: "Invalid Admin Credentials" });
});

// User Login (Mobile Number based - FULL UPDATED with Tier Logic)
app.post('/api/auth/user-login', async (req, res) => {
    try {
        const { phone } = req.body;
        const user = await User.findOne({ phone });

        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        // Check if Admin has approved the profile/payment
        if (!user.isApproved) {
            return res.status(403).json({ success: false, message: "Account pending approval or payment not verified" });
        }

        // Token mein ID aur Role save kar rahe hain
        const token = jwt.sign({ id: user._id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '90d' }); // 3 months validity

        // Response mein user ka pura status bhej rahe hain frontend ke liye
        res.json({
            success: true,
            token,
            role: 'user',
            user: {
                id: user._id,
                name: user.name,
                packageType: user.packageType, // Basic, Gold, Diamond
                viewLimit: user.viewLimit,     // 3, 10, or 1000
                viewedCount: user.viewedCount, // Kitni dekh chuka hai
                unlockedProfiles: user.unlockedProfiles // IDs of profiles already seen
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error during login" });
    }
});