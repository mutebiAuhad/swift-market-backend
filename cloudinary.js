const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

const configured = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
if (!configured) {
  console.error('[cloudinary] Not configured — uploads will fail until CLOUDINARY_* env vars are set.');
}

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const isVideo = file.mimetype.startsWith('video/');
    return {
      folder: 'swift-market',
      resource_type: isVideo ? 'video' : 'image',
      // Public delivery type: anyone with the page link can view/stream the media inline,
      // matching the "no login required to browse" requirement. Saving the *original file*
      // is a separate, gated action — see signedDownloadUrl() below — checked against the
      // requester's subscription on our own server before we hand out that link.
      type: 'upload',
      allowed_formats: isVideo
        ? ['mp4', 'mov', 'webm']
        : ['jpg', 'jpeg', 'png', 'webp']
    };
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB ceiling; tune to your Cloudinary plan
});

// Proof-of-payment screenshots for the manual bank-transfer flow — these can stay public
// delivery type since they're just receipts, not the platform's paid content.
const proofStorage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'swift-market/payment-proofs', resource_type: 'image' }
});
const uploadProof = multer({ storage: proofStorage, limits: { fileSize: 10 * 1024 * 1024 } });

function signedDownloadUrl(publicId, resourceType, format) {
  // Short-lived (10 min) signed URL with a forced 'attachment' disposition, generated only
  // after our route confirms the requester is logged in with an active subscription. The
  // signature+expiry mean this specific link can't be usefully reshared once it goes stale.
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 10;
  return cloudinary.utils.private_download_url(publicId, format, {
    resource_type: resourceType,
    type: 'upload',
    attachment: true,
    expires_at: expiresAt
  });
}

function deleteAsset(publicId, resourceType) {
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType, type: 'upload' });
}

module.exports = { cloudinary, upload, uploadProof, signedDownloadUrl, deleteAsset, configured };
