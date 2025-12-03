import React, {useEffect, useRef, useState} from 'react';
import {Stage, Layer, Image as KonvaImage, Line, Circle} from 'react-konva';
import useImage from 'use-image';

// ==================
// Reusable Button
// ==================
const Button = ({children, onClick, inactive = false, color = 'blue'}) => {
    const colors = {
        blue: '#007bff',
        green: '#28a745',
        red: '#dc3545',
        orange: '#fd7e14',
        gray: '#999'
    };
    const bgColor = inactive ? '#999' : (colors[color] || colors.blue);

    return (
        <button
            onClick={onClick}
            style={{
                padding: '8px 12px',
                marginRight: 8,
                backgroundColor: bgColor,
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                opacity: inactive ? 0.6 : 1,
                cursor: inactive ? 'not-allowed' : 'pointer',
            }}
        >
            {children}
        </button>
    );
};

// ==================
// Main App
// ==================
export default function App() {
    const [prevImageName, setPrevImageName] = useState(null);
    const [didScaleForImage, setDidScaleForImage] = useState(false);
    const [imageList, setImageList] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [prevImage, setPrevImage] = useState(null);
    const [cvReady, setCvReady] = useState(false);
    const [stageScale, setStageScale] = useState(1);
    const [stageDimensions, setStageDimensions] = useState({width: 0, height: 0});

    // --- Separate annotations for outer wall, inner wall, and floor ---
    const [outerWallPoints, setOuterWallPoints] = useState([]);
    const [outerWallEdges, setOuterWallEdges] = useState([]);
    const [innerWallPoints, setInnerWallPoints] = useState([]);
    const [innerWallEdges, setInnerWallEdges] = useState([]);
    const [floorPoints, setFloorPoints] = useState([]);
    const [floorEdges, setFloorEdges] = useState([]);
    const [hoverTarget, setHoverTarget] = useState(null);

    const [annotationMode, setAnnotationMode] = useState('outer'); // 'outer', 'inner', or 'floor'
    const [historyVersion, setHistoryVersion] = useState(0); // to trigger re-render when needed
    const historyRef = useRef([]); // stable reference that never resets automatically
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [hasExported, setHasExported] = useState(false);
    const stageRef = useRef(null);

    // --- Load current image ---
    const currentImageName = imageList[currentIndex];
    const imageURL = currentImageName
        ? `http://localhost:3001/images/${currentImageName}`
        : null;
    console.log("Loading image:", imageURL);
    const [image] = useImage(imageURL, 'anonymous');  // ✅ enable cross-origin image loading

    const pushHistory = () => {
        if (!image) return;
        historyRef.current.push({
            outerWallPoints: [...outerWallPoints],
            outerWallEdges: [...outerWallEdges],
            innerWallPoints: [...innerWallPoints],
            innerWallEdges: [...innerWallEdges],
            floorPoints: [...floorPoints],
            floorEdges: [...floorEdges],
        });
        setHistoryVersion(v => v + 1); // force update to refresh Ctrl+Z listener
        const MAX_HISTORY = 200; // or whatever you prefer
        if (historyRef.current.length > MAX_HISTORY) {
            historyRef.current.shift(); // remove oldest
        }
    };

    const handleMouseMove = (e) => {
        const stage = e.target.getStage();
        let mousePos = stage.getPointerPosition();

        // Convert from scaled Stage coordinates to original image coordinates
        if (mousePos && stageScale !== 1) {
            mousePos = {
                x: mousePos.x / stageScale,
                y: mousePos.y / stageScale
            };
        }

        const hoverDist = 8 / (stageScale || 1); // Adjust hover distance for scale
        let nearest = null;
        let minDist = Infinity;

        const allSets = [
            {mode: 'outer', points: outerWallPoints, edges: outerWallEdges},
            {mode: 'inner', points: innerWallPoints, edges: innerWallEdges},
            {mode: 'floor', points: floorPoints, edges: floorEdges}
        ];

        // Check points first
        for (const set of allSets) {
            set.points.forEach((pt, idx) => {
                const d = distance(mousePos, pt);
                if (d < hoverDist && d < minDist) {
                    minDist = d;
                    nearest = {type: 'point', mode: set.mode, index: idx, data: pt};
                }
            });
        }

        // Check edges
        for (const set of allSets) {
            set.edges.forEach(([i1, i2], idx) => {
                const a = set.points[i1];
                const b = set.points[i2];
                const cp = closestPointOnSegment(mousePos, a, b);
                const d = distance(mousePos, cp);
                if (d < hoverDist && d < minDist) {
                    minDist = d;
                    nearest = {type: 'edge', mode: set.mode, index: idx, data: {a, b, cp}};
                }
            });
        }

        if (hoverTarget?.type === 'edge' && (e.evt.ctrlKey || e.evt.metaKey)) {
            stage.container().style.cursor = 'not-allowed';
        } else {
            stage.container().style.cursor = 'default';
        }

        setHoverTarget(nearest);
    };

// --- Geometry helpers ---
    function distance(p1, p2) {
        return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
    }

    function closestPointOnSegment(p, a, b) {
        const ap = {x: p.x - a.x, y: p.y - a.y};
        const ab = {x: b.x - a.x, y: b.y - a.y};
        const ab2 = ab.x * ab.x + ab.y * ab.y;
        const t = Math.max(0, Math.min(1, (ap.x * ab.x + ap.y * ab.y) / ab2));
        return {x: a.x + ab.x * t, y: a.y + ab.y * t};
    }

    function matFromImageData(imgData) {
        const mat = new window.cv.Mat(imgData.height, imgData.width, window.cv.CV_8UC4);
        mat.data.set(imgData.data);
        return mat;
    }

    function imageToMat(image) {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const mat = matFromImageData(imgData);
        window.cv.cvtColor(mat, mat, window.cv.COLOR_RGBA2GRAY, 0);
        return mat;
    }

    /**
     * Find the transformation matrix between two images using feature matching
     * Returns a 2x3 affine transformation matrix or null if matching fails
     */
    function findImageAlignment(prevImage, currImage) {
        try {
            const matPrev = imageToMat(prevImage);
            const matCurr = imageToMat(currImage);

            // Use ORB detector for feature matching
            const orb = new window.cv.ORB(500);
            const kpPrev = new window.cv.KeyPointVector();
            const descPrev = new window.cv.Mat();
            const kpCurr = new window.cv.KeyPointVector();
            const descCurr = new window.cv.Mat();

            orb.detectAndCompute(matPrev, new window.cv.Mat(), kpPrev, descPrev);
            orb.detectAndCompute(matCurr, new window.cv.Mat(), kpCurr, descCurr);

            // Match features
            const bf = new window.cv.BFMatcher(window.cv.NORM_HAMMING, true);
            const matches = new window.cv.DMatchVector();
            bf.match(descPrev, descCurr, matches);

            // Need at least 3 matches for affine transform
            if (matches.size() < 3) {
                matPrev.delete();
                matCurr.delete();
                kpPrev.delete();
                descPrev.delete();
                kpCurr.delete();
                descCurr.delete();
                matches.delete();
                bf.delete();
                orb.delete();
                return null;
            }

            // Extract matched points
            const srcPoints = new window.cv.Mat(matches.size(), 1, window.cv.CV_32FC2);
            const dstPoints = new window.cv.Mat(matches.size(), 1, window.cv.CV_32FC2);

            for (let i = 0; i < matches.size(); i++) {
                const match = matches.get(i);
                const pt1 = kpPrev.get(match.queryIdx);
                const pt2 = kpCurr.get(match.trainIdx);
                srcPoints.data32F[i * 2] = pt1.pt.x;
                srcPoints.data32F[i * 2 + 1] = pt1.pt.y;
                dstPoints.data32F[i * 2] = pt2.pt.x;
                dstPoints.data32F[i * 2 + 1] = pt2.pt.y;
            }

            // Estimate affine transform using RANSAC
            // Try estimateAffine2D first (more general), fallback to getAffineTransform if we have exactly 3 points
            let transform;
            if (matches.size() === 3) {
                // For exactly 3 points, use getAffineTransform
                transform = window.cv.getAffineTransform(srcPoints, dstPoints);
            } else {
                // For more points, use estimateAffine2D with RANSAC
                const inliers = new window.cv.Mat();
                try {
                    transform = window.cv.estimateAffine2D(
                        srcPoints,
                        dstPoints,
                        inliers,
                        window.cv.RANSAC,
                        3.0,
                        2000,
                        0.99,
                        10.0
                    );
                    inliers.delete();
                } catch (e) {
                    // Fallback: use first 3 points for getAffineTransform
                    const src3 = new window.cv.Mat(3, 1, window.cv.CV_32FC2);
                    const dst3 = new window.cv.Mat(3, 1, window.cv.CV_32FC2);
                    for (let i = 0; i < 3; i++) {
                        src3.data32F[i * 2] = srcPoints.data32F[i * 2];
                        src3.data32F[i * 2 + 1] = srcPoints.data32F[i * 2 + 1];
                        dst3.data32F[i * 2] = dstPoints.data32F[i * 2];
                        dst3.data32F[i * 2 + 1] = dstPoints.data32F[i * 2 + 1];
                    }
                    transform = window.cv.getAffineTransform(src3, dst3);
                    src3.delete();
                    dst3.delete();
                    inliers.delete();
                }
            }

            matPrev.delete();
            matCurr.delete();
            kpPrev.delete();
            descPrev.delete();
            kpCurr.delete();
            descCurr.delete();
            matches.delete();
            bf.delete();
            orb.delete();
            srcPoints.delete();
            dstPoints.delete();

            if (!transform || transform.empty()) {
                return null;
            }

            return transform;
        } catch (err) {
            console.warn("Image alignment failed:", err);
            return null;
        }
    }

    /**
     * Apply affine transformation to points
     */
    function applyTransform(points, transform) {
        if (!transform || points.length === 0) return points;

        const a = transform.doubleAt(0, 0);
        const b = transform.doubleAt(0, 1);
        const tx = transform.doubleAt(0, 2);
        const c = transform.doubleAt(1, 0);
        const d = transform.doubleAt(1, 1);
        const ty = transform.doubleAt(1, 2);

        return points.map(p => ({
            x: a * p.x + b * p.y + tx,
            y: c * p.x + d * p.y + ty,
        }));
    }

    /**
     * Fallback: Use template matching to find translation-only alignment
     * This is more robust for images that are primarily translated
     */
    function findTranslationAlignment(prevImage, currImage) {
        try {
            const matPrev = imageToMat(prevImage);
            const matCurr = imageToMat(currImage);

            // Use a portion of the previous image as a template (center region)
            const templateSize = Math.min(matPrev.cols, matPrev.rows, matCurr.cols, matCurr.rows) * 0.5;
            const templateX = Math.floor((matPrev.cols - templateSize) / 2);
            const templateY = Math.floor((matPrev.rows - templateSize) / 2);

            const template = matPrev.roi(new window.cv.Rect(
                templateX,
                templateY,
                Math.floor(templateSize),
                Math.floor(templateSize)
            ));

            // Match template in current image
            const result = new window.cv.Mat();
            const mask = new window.cv.Mat();
            window.cv.matchTemplate(matCurr, template, result, window.cv.TM_CCOEFF_NORMED, mask);

            // Find best match
            const minMaxLoc = window.cv.minMaxLoc(result, mask);
            const matchX = minMaxLoc.maxLoc.x;
            const matchY = minMaxLoc.maxLoc.y;

            // Calculate translation
            const shiftX = matchX - templateX;
            const shiftY = matchY - templateY;

            // Create translation-only transform matrix
            // Matrix format: [a b tx]
            //                [c d ty]
            const transform = new window.cv.Mat(2, 3, window.cv.CV_64F);
            transform.set(0, 0, 1, 0); // a = 1
            transform.set(0, 1, 0, 0); // b = 0
            transform.set(0, 2, shiftX, 0); // tx
            transform.set(1, 0, 0, 0); // c = 0
            transform.set(1, 1, 1, 0); // d = 1
            transform.set(1, 2, shiftY, 0); // ty

            matPrev.delete();
            matCurr.delete();
            template.delete();
            result.delete();
            mask.delete();

            return transform;
        } catch (err) {
            console.warn("Translation alignment failed:", err);
            return null;
        }
    }

    /**
     * Transform points from previous image coordinate space to current image coordinate space
     * Uses image alignment to find the transformation
     */
    function transformPointsBetweenImages(points, prevImage, currImage) {
        if (!points || points.length === 0 || !prevImage || !currImage) {
            return points;
        }

        // Try feature-based alignment first
        let transform = findImageAlignment(prevImage, currImage);

        // Fallback to phase correlation if feature matching fails
        if (!transform) {
            console.log("Feature matching failed, trying phase correlation...");
            transform = findTranslationAlignment(prevImage, currImage);
        }

        if (!transform) {
            console.warn("Could not find alignment, returning original points");
            return points;
        }

        const transformed = applyTransform(points, transform);
        transform.delete();
        return transformed;
    }

    // ==================
    // Load images + restore saved index
    // ==================
    useEffect(() => {
        fetch('http://localhost:3001/api/images')
            .then(res => res.json())
            .then(files => {
                setImageList(files);
                const savedIndex = localStorage.getItem('currentImageIndex');
                if (savedIndex !== null) {
                    const idx = parseInt(savedIndex, 10);
                    const safeIdx = Math.min(Math.max(idx, 0), files.length - 1);
                    setCurrentIndex(safeIdx);
                }
            })
            .catch(err => console.error("Failed to fetch image list:", err));
    }, []);

    // Save current index to localStorage whenever it changes
    useEffect(() => {
        if (imageList.length > 0) {
            localStorage.setItem('currentImageIndex', currentIndex.toString());
        }
    }, [currentIndex, imageList.length]);

    useEffect(() => {
        const waitForCV = () => {
            if (window.cv && window.cv.Mat) {
                console.log("✅ OpenCV.js ready");
                setCvReady(true);
            } else {
                console.log("⌛ Waiting for OpenCV...");
                setTimeout(waitForCV, 500);
            }
        };
        waitForCV();
    }, []);

    // Calculate stage scale to fit viewport
    useEffect(() => {
        if (!image) {
            setStageScale(1);
            setStageDimensions({width: 0, height: 0});
            return;
        }

        const calculateStageScale = () => {
            const imgWidth = image.naturalWidth || image.width;
            const imgHeight = image.naturalHeight || image.height;

            // Get viewport dimensions (accounting for toolbar and padding)
            const maxWidth = window.innerWidth - 100; // Leave some margin
            const maxHeight = window.innerHeight - 200; // Account for toolbar and padding

            // Calculate scale to fit within viewport while maintaining aspect ratio
            const scaleX = maxWidth / imgWidth;
            const scaleY = maxHeight / imgHeight;
            const scale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down

            // Use full image dimensions for the Stage (it will be scaled)
            setStageDimensions({width: imgWidth, height: imgHeight});
            setStageScale(scale);
        };

        calculateStageScale();

        // Recalculate on window resize
        const handleResize = () => {
            calculateStageScale();
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [image]);


    useEffect(() => {
        if (!image) return;
        if (!prevImageName || !prevImage) {
            // First load, no previous image
            setPrevImageName(currentImageName);
            if (image) setPrevImage(image);
            return;
        }

        if (!cvReady) {
            console.warn("Skipping alignment — OpenCV not ready yet");
            setPrevImageName(currentImageName);
            if (image) setPrevImage(image);
            return;
        }

        // Transform annotations using image alignment
        const mapPoints = (pts) => {
            if (!pts || pts.length === 0) return pts;
            return transformPointsBetweenImages(pts, prevImage, image);
        };

        setOuterWallPoints(p => mapPoints(p));
        setInnerWallPoints(p => mapPoints(p));
        setFloorPoints(p => mapPoints(p));

        setPrevImageName(currentImageName);
        setPrevImage(image);
        setDidScaleForImage(true);
    }, [image, currentImageName, prevImageName, prevImage, cvReady]);

    useEffect(() => {
        if (!didScaleForImage) return;
        if (!image) return;

        historyRef.current = [
            {
                outerWallPoints: [...outerWallPoints],
                outerWallEdges: [...outerWallEdges],
                innerWallPoints: [...innerWallPoints],
                innerWallEdges: [...innerWallEdges],
                floorPoints: [...floorPoints],
                floorEdges: [...floorEdges],
            },
        ];
        setHistoryVersion((v) => v + 1);
        setDidScaleForImage(false);
    }, [didScaleForImage, image]);

    function deletePoint(points, edges, pointIndex) {
        // 1. Remove edges containing this point
        const remainingEdges = edges.filter(([a, b]) => a !== pointIndex && b !== pointIndex);

        // 2. Same cleanup as deleteEdge
        const used = new Set();
        remainingEdges.forEach(([a, b]) => {
            used.add(a);
            used.add(b);
        });

        // 3. Filter + remap
        const newPoints = [];
        const remap = {};

        points.forEach((pt, i) => {
            if (i !== pointIndex && used.has(i)) {
                remap[i] = newPoints.length;
                newPoints.push(pt);
            }
        });

        // 4. Remap edges
        const newEdges = remainingEdges.map(([a, b]) => [
            remap[a],
            remap[b]
        ]);

        return {newPoints, newEdges};
    }

    function deleteEdge(points, edges, edgeIndex) {
        // 1. Remove selected edge
        const remainingEdges = edges.filter((_, idx) => idx !== edgeIndex);

        // 2. Find all point indices still used
        const used = new Set();
        remainingEdges.forEach(([a, b]) => {
            used.add(a);
            used.add(b);
        });

        // 3. Filter points and build index remap
        const newPoints = [];
        const remap = {};
        points.forEach((pt, i) => {
            if (used.has(i)) {
                remap[i] = newPoints.length;
                newPoints.push(pt);
            }
        });

        // 4. Remap edges
        const newEdges = remainingEdges.map(([a, b]) => [
            remap[a],
            remap[b]
        ]);

        return {newPoints, newEdges};
    }

    // ==================
    // Handle drawing click
    // ==================
    const handleClick = (e) => {
        e.evt.preventDefault(); // prevent right-click menu
        const stage = e.target.getStage();
        let point = stage.getPointerPosition();

        // Convert from scaled Stage coordinates to original image coordinates
        // When Stage is scaled, getPointerPosition returns coordinates in Stage space
        // We need to account for the scale to get coordinates in the original image space
        if (point && stageScale !== 1) {
            point = {
                x: point.x / stageScale,
                y: point.y / stageScale
            };
        }

        // Ensure point is valid
        if (!point) return;

        const isRightClick = e.evt.button === 2;
        const isCtrlClick = e.evt.ctrlKey || e.evt.metaKey;

        // ==========================
        // Ctrl+Click → Delete point/node
        // ==========================
        if (isCtrlClick && hoverTarget?.type === 'point') {
            e.evt.stopPropagation(); // Prevent any other handlers
            pushHistory(); // for undo
            const {mode, index} = hoverTarget;

            // Read current state and calculate updates, then apply both
            if (mode === 'outer') {
                const currentPoints = outerWallPoints;
                const currentEdges = outerWallEdges;
                const {newPoints, newEdges} = deletePoint(currentPoints, currentEdges, index);
                setOuterWallPoints(newPoints);
                setOuterWallEdges(newEdges);
            } else if (mode === 'inner') {
                const currentPoints = innerWallPoints;
                const currentEdges = innerWallEdges;
                const {newPoints, newEdges} = deletePoint(currentPoints, currentEdges, index);
                setInnerWallPoints(newPoints);
                setInnerWallEdges(newEdges);
            } else {
                const currentPoints = floorPoints;
                const currentEdges = floorEdges;
                const {newPoints, newEdges} = deletePoint(currentPoints, currentEdges, index);
                setFloorPoints(newPoints);
                setFloorEdges(newEdges);
            }

            setHasUnsavedChanges(true);
            setHasExported(false);
            return; // ✅ stop here – don't add new points
        }

        // ==========================
        // Ctrl+Click → Delete edge
        // ==========================
        if (isCtrlClick && hoverTarget?.type === 'edge') {
            e.evt.stopPropagation(); // Prevent any other handlers
            pushHistory(); // for undo
            const {mode, index} = hoverTarget;

            // Read current state and calculate updates, then apply both
            if (mode === 'outer') {
                const currentPoints = outerWallPoints;
                const currentEdges = outerWallEdges;
                const {newPoints, newEdges} = deleteEdge(currentPoints, currentEdges, index);
                setOuterWallPoints(newPoints);
                setOuterWallEdges(newEdges);
            } else if (mode === 'inner') {
                const currentPoints = innerWallPoints;
                const currentEdges = innerWallEdges;
                const {newPoints, newEdges} = deleteEdge(currentPoints, currentEdges, index);
                setInnerWallPoints(newPoints);
                setInnerWallEdges(newEdges);
            } else {
                const currentPoints = floorPoints;
                const currentEdges = floorEdges;
                const {newPoints, newEdges} = deleteEdge(currentPoints, currentEdges, index);
                setFloorPoints(newPoints);
                setFloorEdges(newEdges);
            }

            setHasUnsavedChanges(true);
            setHasExported(false);
            return; // ✅ stop here – don't add new points
        }

        // ==========================
        // Normal drawing behavior
        // ==========================
        if (hoverTarget) {
            if (hoverTarget.type === 'point') {
                point = hoverTarget.data;
            } else if (hoverTarget.type === 'edge') {
                point = hoverTarget.data.cp;
            }
        }

        const connect = !isRightClick;
        pushHistory();

        if (annotationMode === 'outer') {
            const newPoints = [...outerWallPoints, point];
            const newEdges = [...outerWallEdges];
            if (connect && outerWallPoints.length > 0) {
                newEdges.push([outerWallPoints.length - 1, outerWallPoints.length]);
            }
            setOuterWallPoints(newPoints);
            setOuterWallEdges(newEdges);
        } else if (annotationMode === 'inner') {
            const newPoints = [...innerWallPoints, point];
            const newEdges = [...innerWallEdges];
            if (connect && innerWallPoints.length > 0) {
                newEdges.push([innerWallPoints.length - 1, innerWallPoints.length]);
            }
            setInnerWallPoints(newPoints);
            setInnerWallEdges(newEdges);
        } else {
            const newPoints = [...floorPoints, point];
            const newEdges = [...floorEdges];
            if (connect && floorPoints.length > 0) {
                newEdges.push([floorPoints.length - 1, floorPoints.length]);
            }
            setFloorPoints(newPoints);
            setFloorEdges(newEdges);
        }

        setHasUnsavedChanges(true);
        setHasExported(false);
    };

    // ==================
    // Export JSON (no popup)
    // ==================
    const exportData = async () => {
        if (!image) {
            alert("❌ No image loaded — cannot export yet.");
            return;
        }

        // Extract the actual source dimensions of the current image
        const imgWidth = image.naturalWidth || image.width;
        const imgHeight = image.naturalHeight || image.height;

        const output = {
            image_name: currentImageName,
            size: {width: imgWidth, height: imgHeight}, // ✅ new field
            outer_walls: {points: outerWallPoints, edges: outerWallEdges},
            inner_walls: {points: innerWallPoints, edges: innerWallEdges},
            floor: {points: floorPoints, edges: floorEdges},
        };

        try {
            const res = await fetch("http://localhost:3001/api/save-json", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    imageName: currentImageName,
                    data: output
                })
            });

            if (!res.ok) throw new Error(await res.text());
            const result = await res.json();
            console.log(`✅ Saved ${result.path}`);

            setHasUnsavedChanges(false);
            setHasExported(true);
        } catch (err) {
            console.error("❌ Error saving JSON:", err);
            alert("Failed to save JSON file.");
        }
    };

    // ==================
    // Navigation
    // ==================
    const goToImage = async (delta) => {
        const newIndex = currentIndex + delta;
        if (newIndex < 0 || newIndex >= imageList.length) {
            window.alert("No more images in this direction.");
            return;
        }

        // Warn if there are unsaved changes, but allow navigation
        if (!hasExported && (outerWallPoints.length > 0 || innerWallPoints.length > 0 || floorPoints.length > 0)) {
            const confirmed = window.confirm("⚠️ You have unsaved annotations. Are you sure you want to continue without saving?");
            if (!confirmed) {
                return; // User cancelled, stay on current image
            }
        }

        if (image) setPrevImage(image);
        setPrevImageName(currentImageName);
        setDidScaleForImage(false);
        setCurrentIndex(newIndex);
        setHasUnsavedChanges(false);
        setHasExported(false);
    };


// ==================
// Undo (Ctrl+Z) – fixed to always stay in sync
// ==================
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                const stack = historyRef.current;
                if (stack.length === 0) return;

                const last = stack.pop();
                if (!last) return;

                setOuterWallPoints([...last.outerWallPoints]);
                setOuterWallEdges([...last.outerWallEdges]);
                setInnerWallPoints([...last.innerWallPoints]);
                setInnerWallEdges([...last.innerWallEdges]);
                setFloorPoints([...last.floorPoints]);
                setFloorEdges([...last.floorEdges]);
                setHasUnsavedChanges(true);
                setHasExported(false);
                setHistoryVersion(v => v + 1);
            }
        };

        // Attach only once
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, []); // <- no dependencies

    // ==================
    // Rendering
    // ==================
    return (
        <div className="p-4 space-y-4">
            {/* === Toolbar === */}
            <div className="flex gap-4 items-center">
                {/* Mode toggle cycles through 3 types */}
                <Button
                    onClick={() => {
                        const next = annotationMode === 'outer'
                            ? 'inner'
                            : annotationMode === 'inner'
                                ? 'floor'
                                : 'outer';
                        setAnnotationMode(next);
                    }}
                    color={
                        annotationMode === 'outer'
                            ? 'red'
                            : annotationMode === 'inner'
                                ? 'orange'
                                : 'green'
                    }
                >
                    Mode: {annotationMode === 'outer'
                    ? 'Outer Walls'
                    : annotationMode === 'inner'
                        ? 'Inner Walls'
                        : 'Floor'}
                </Button>

                <Button onClick={exportData} color="green">
                    Save
                </Button>

                <Button
                    onClick={() => {
                        // BEFORE clearing → save current state
                        pushHistory();

                        setOuterWallPoints([]);
                        setOuterWallEdges([]);
                        setInnerWallPoints([]);
                        setInnerWallEdges([]);
                        setFloorPoints([]);
                        setFloorEdges([]);

                        setHasUnsavedChanges(false);
                        setHasExported(false);

                        // DO NOT reset historyRef here — let undo work
                    }}
                >
                    Clear
                </Button>

                <Button onClick={() => goToImage(-1)}>Previous</Button>
                <Button onClick={() => goToImage(1)}>Next</Button>

                <Button
                    onClick={() => {
                        localStorage.removeItem('currentImageIndex');
                        setCurrentIndex(0);
                    }}
                >
                    Reset Progress
                </Button>

                <span style={{fontWeight: 'bold', color: hasExported ? 'green' : 'red'}}>
          {hasExported ? 'Saved' : 'Not Saved'}
        </span>

                <span style={{marginLeft: 10, fontStyle: 'italic', color: '#555'}}>
          Left-click = connect, Right-click = free node
        </span>

                <span>{currentImageName}</span>
            </div>

            {/* === Canvas === */}
            <div
                className="border border-gray-300 inline-block"
                style={{
                    overflow: 'auto',
                    maxWidth: '100vw',
                    maxHeight: '90vh',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'flex-start'
                }}
            >
                {image ? (
                    <Stage
                        width={stageDimensions.width}
                        height={stageDimensions.height}
                        scaleX={stageScale}
                        scaleY={stageScale}
                        onClick={handleClick}
                        onMouseMove={handleMouseMove}
                        onContextMenu={(e) => e.evt.preventDefault()}
                        ref={stageRef}
                    >
                        <Layer>
                            <KonvaImage
                                image={image}
                                width={image.naturalWidth || image.width}
                                height={image.naturalHeight || image.height}
                            />
                            {/* Outer Walls (red) */}
                            {outerWallEdges.map(([i1, i2], idx) => (
                                <Line
                                    key={`outer-${idx}`}
                                    points={[
                                        outerWallPoints[i1].x, outerWallPoints[i1].y,
                                        outerWallPoints[i2].x, outerWallPoints[i2].y
                                    ]}
                                    stroke="red"
                                    strokeWidth={
                                        hoverTarget?.type === 'edge' &&
                                        hoverTarget?.mode === 'outer' &&
                                        hoverTarget?.index === idx
                                            ? 3
                                            : 2
                                    }
                                />
                            ))}
                            {outerWallPoints.map((pt, idx) => (
                                <Circle key={`opt-${idx}`} x={pt.x} y={pt.y} radius={
                                    hoverTarget?.type === 'point' &&
                                    hoverTarget?.mode === 'outer' &&
                                    hoverTarget?.index === idx
                                        ? 6
                                        : 4
                                } fill="red"/>
                            ))}

                            {/* Inner Walls (orange) */}
                            {innerWallEdges.map(([i1, i2], idx) => (
                                <Line
                                    key={`inner-${idx}`}
                                    points={[
                                        innerWallPoints[i1].x, innerWallPoints[i1].y,
                                        innerWallPoints[i2].x, innerWallPoints[i2].y
                                    ]}
                                    stroke="orange"
                                    strokeWidth={
                                        hoverTarget?.type === 'edge' &&
                                        hoverTarget?.mode === 'inner' &&
                                        hoverTarget?.index === idx
                                            ? 3
                                            : 2
                                    }
                                />
                            ))}
                            {innerWallPoints.map((pt, idx) => (
                                <Circle key={`ipt-${idx}`} x={pt.x} y={pt.y} radius={
                                    hoverTarget?.type === 'point' &&
                                    hoverTarget?.mode === 'inner' &&
                                    hoverTarget?.index === idx
                                        ? 6
                                        : 4
                                } fill="orange"/>
                            ))}

                            {/* Floor (green) */}
                            {floorEdges.map(([i1, i2], idx) => (
                                <Line
                                    key={`floor-${idx}`}
                                    points={[
                                        floorPoints[i1].x, floorPoints[i1].y,
                                        floorPoints[i2].x, floorPoints[i2].y
                                    ]}
                                    stroke="green"
                                    strokeWidth={
                                        hoverTarget?.type === 'edge' &&
                                        hoverTarget?.mode === 'floor' &&
                                        hoverTarget?.index === idx
                                            ? 3
                                            : 2
                                    }
                                />
                            ))}
                            {floorPoints.map((pt, idx) => (
                                <Circle key={`fpt-${idx}`} x={pt.x} y={pt.y} radius={
                                    hoverTarget?.type === 'point' &&
                                    hoverTarget?.mode === 'floor' &&
                                    hoverTarget?.index === idx
                                        ? 6
                                        : 4
                                } fill="green"/>
                            ))}
                        </Layer>
                    </Stage>
                ) : (
                    <p style={{padding: 10}}>Loading image...</p>
                )}
            </div>
        </div>
    );
}