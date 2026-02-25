const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Cloudinary Configuration (Ye keys aapko Cloudinary ki website se milengi)
cloudinary.config({
    cloud_name: 'apka_cloud_name',
    api_key: 'apki_api_key',
    api_secret: 'apka_api_secret'
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'matchmaking_profiles', // Cloudinary mein folder ka naam
        allowed_formats: ['jpg', 'png', 'jpeg'],
    },
});

const upload = multer({ storage: storage });

module.exports = upload;