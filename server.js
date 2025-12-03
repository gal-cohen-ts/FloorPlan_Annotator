const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3001;

// =====================================
// Directories
// =====================================
const IMAGES_DIR = path.resolve(process.env.HOME || process.env.USERPROFILE, 'Google Drive/Shared drives/Algo Uploads/cg-non-lidar-data/cg_tagging_data/for_retagging');
const SAVE_DIR = path.resolve(process.env.HOME || process.env.USERPROFILE, 'Google Drive/Shared drives/Algo Uploads/cg-non-lidar-data/cg_tagging_data/jsons_liri');

// Ensure save directory exists
fs.mkdirSync(SAVE_DIR, { recursive: true });

// =====================================
// Middleware
// =====================================
app.use(cors());
app.use(express.json());
app.use('/images', express.static(IMAGES_DIR));

// =====================================
// Endpoint: list all images
// =====================================
app.get('/api/images', (req, res) => {
  fs.readdir(IMAGES_DIR, (err, files) => {
    if (err)
      return res.status(500).json({ error: 'Unable to read images directory' });

    const imageFiles = files.filter(file => /\.(png|jpe?g|webp)$/i.test(file));

    // Sort by session UUID first, then by index number
    imageFiles.sort((a, b) => {
      // Example: 2d_fp_input_<UUID>_<index>.png
      const regex = /^2d_fp_input_([A-F0-9-]+)_(\d+)\./i;

      const matchA = a.match(regex);
      const matchB = b.match(regex);

      if (!matchA || !matchB) return a.localeCompare(b); // fallback

      const [, uuidA, idxA] = matchA;
      const [, uuidB, idxB] = matchB;

      if (uuidA === uuidB) {
        // Same session → sort numerically by frame index
        return Number(idxA) - Number(idxB);
      }

      // Different sessions → sort by UUID string (stable but arbitrary)
      return uuidA.localeCompare(uuidB);
    });

    res.json(imageFiles);
  });
});

// =====================================
// Endpoint: save JSON annotation
// =====================================
app.post('/api/save-json', (req, res) => {
  try {
    const { imageName, data } = req.body;
    if (!imageName || !data) {
      return res.status(400).json({ error: 'Missing imageName or data' });
    }

    const filename = imageName.replace(/\.[^/.]+$/, '') + '.json';
    const filePath = path.join(SAVE_DIR, filename);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`✅ Saved ${filename} to ${SAVE_DIR}`);
    res.json({ success: true, path: filePath });
  } catch (err) {
    console.error('❌ Error saving JSON:', err);
    res.status(500).json({ error: 'Failed to save file' });
  }
});

// =====================================
// Start server
// =====================================
app.listen(PORT, () => {
  console.log(`🟢 Server running at http://localhost:${PORT}`);
  console.log(`📁 Serving images from: ${IMAGES_DIR}`);
  console.log(`💾 Saving JSONs to: ${SAVE_DIR}`);
});