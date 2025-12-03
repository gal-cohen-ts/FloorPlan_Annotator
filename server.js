const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = 3001;

// =====================================
// Directories
// =====================================
const IMAGES_DIR = path.resolve(
    process.env.HOME || process.env.USERPROFILE,
    "Google Drive/Shared drives/Algo Uploads/cg-non-lidar-data/cg_tagging_data/for_retagging_neta"
);

const JSON_DIR = path.resolve(
    process.env.HOME || process.env.USERPROFILE,
    "Downloads/jsons_neta"
);

fs.mkdirSync(JSON_DIR, { recursive: true });

// =====================================
// Middleware
// =====================================
app.use(cors());
app.use(express.json());

// Serve images
app.use("/images", express.static(IMAGES_DIR));

// =====================================
// API: List images
// =====================================
app.get("/api/images", (req, res) => {
    fs.readdir(IMAGES_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: "Unable to read images directory" });

        const imageFiles = files.filter(f => /\.(png|jpe?g|webp)$/i.test(f));

        // Sort by session UUID and numeric suffix
        imageFiles.sort((a, b) => {
            const regex = /^2d_fp_input_([A-F0-9-]+)_(\d+)\./i;
            const mA = a.match(regex);
            const mB = b.match(regex);
            if (!mA || !mB) return a.localeCompare(b);

            const [, uuidA, idxA] = mA;
            const [, uuidB, idxB] = mB;

            if (uuidA === uuidB) return Number(idxA) - Number(idxB);
            return uuidA.localeCompare(uuidB);
        });

        res.json(imageFiles);
    });
});

// =====================================
// API: get JSON for image
// =====================================
app.get("/api/json/:imageName", (req, res) => {
    const imageName = req.params.imageName;
    const base = imageName.replace(/\.[^/.]+$/, "");
    const jsonPath = path.join(JSON_DIR, base + ".json");

    if (!fs.existsSync(jsonPath)) {
        return res.json({ exists: false, data: null });
    }

    const raw = fs.readFileSync(jsonPath, "utf-8");
    res.json({ exists: true, data: JSON.parse(raw) });
});

// =====================================
// API: save JSON
// =====================================
app.post("/api/save-json", (req, res) => {
    try {
        const { imageName, data } = req.body;
        if (!imageName || !data) {
            return res.status(400).json({ error: "Missing imageName or data" });
        }

        const filename = imageName.replace(/\.[^/.]+$/, "") + ".json";
        const filePath = path.join(JSON_DIR, filename);

        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");

        return res.json({ success: true, path: filePath });
    } catch (err) {
        console.error("❌ Error saving JSON:", err);
        return res.status(500).json({ error: "Failed to save file" });
    }
});

// =====================================
// Start server
// =====================================
app.listen(PORT, () => {
    console.log(`🟢 Server running at http://localhost:${PORT}`);
    console.log(`📁 Serving images from: ${IMAGES_DIR}`);
    console.log(`📁 Serving JSONs from: ${JSON_DIR}`);
});