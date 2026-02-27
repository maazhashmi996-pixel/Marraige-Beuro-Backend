const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
    // Frontend se header mein token aata hai: "Bearer <token>"
    const authHeader = req.headers.authorization;

    // --- UPDATED LOGIC: Optional Authentication ---
    // Agar token nahi hai, toh request block mat karo (401 mat bhejo)
    // Bas req.user ko null set kar do aur next() kar do taake Public View chale
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        req.user = null;
        return next();
    }

    const token = authHeader.split(' ')[1];

    try {
        // Token ko verify karna
        // Note: Make sure aapke .env mein JWT_SECRET wahi ho jo loginController mein hai
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');

        // Request object mein user ka data daal dena (id, role, etc.)
        req.user = decoded;

        // Agle function (Route) par bhejna
        next();
    } catch (err) {
        // Agar token expire ho gaya hai ya galat hai, tab bhi block na karein
        // Bas user ko anonymous treat karein (Public View ke liye)
        console.error("Auth Middleware Error:", err.message);
        req.user = null;
        next();
    }
};

// --- Admin Check Logic (Disturb nahi kiya gaya) ---
// Note: Isme req.user hona zaroori hai kyunki admin ko login hona parta hai
const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ success: false, message: "Access denied. Admins only." });
    }
};

module.exports = { authMiddleware, isAdmin };