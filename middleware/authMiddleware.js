const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
    // Frontend se header mein token aata hai: "Bearer <token>"
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: "No token, authorization denied" });
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
        console.error("Auth Middleware Error:", err.message);
        res.status(401).json({ message: "Token is not valid" });
    }
};

// --- Naya Optional Logic: Sirf Admin Check karne ke liye ---
// Isse aapka purana middleware disturb nahi hoga, ye extra feature hai
const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: "Access denied. Admins only." });
    }
};

module.exports = { authMiddleware, isAdmin };