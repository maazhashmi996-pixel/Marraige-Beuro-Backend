const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authMiddleware, isAdmin } = require('../middleware/authMiddleware');
const upload = require('../middleware/multer'); // Aapka purana multer logic

// ==========================================
// 1. PUBLIC ROUTES (No Login Required)
// ==========================================

// Register route with multi-file upload
router.post('/register', upload.fields([
    { name: 'images', maxCount: 5 },
    { name: 'paymentScreenshot', maxCount: 1 }
]), userController.registerUser);

// Login route
router.post('/login', userController.loginUser);


// ==========================================
// 2. PROTECTED ROUTES (Login Required)
// ==========================================

// NEW: User ko saare rishtay (matches) dikhane ke liye
router.get('/matches', authMiddleware, userController.getAvailableMatches);

// Profile ki contact details unlock karne ke liye
router.post('/unlock-profile', authMiddleware, userController.unlockProfile);


// ==========================================
// 3. ADMIN ROUTES (Login + Admin Role Required)
// ==========================================

// Pending registrations dekhna (Sirf Admin)
router.get('/pending', authMiddleware, isAdmin, userController.getPendingRegistrations);

// User ko approve karna (Sirf Admin)
router.put('/approve/:id', authMiddleware, isAdmin, userController.approveUser);
// User routes file mein
router.get('/view/:id', authMiddleware, userController.getSingleProfile);
module.exports = router;