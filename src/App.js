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
        gray: '#999',
    };
    const bgColor = inactive ? '#999' : (colors[color] || colors.blue);

    return (
        <button
            onClick={inactive ? undefined : onClick}
            disabled={inactive}
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

    // --- Annotations ---
    const [outerWallPoints, setOuterWallPoints] = useState([]);
    const [outerWallEdges, setOuterWallEdges] = useState([]);
    const [innerWallPoints, setInnerWallPoints] = useState([]);
    const [innerWallEdges, setInnerWallEdges] = useState([]);
    const [floorPoints, setFloorPoints] = useState([]);
    const [floorEdges, setFloorEdges] = useState([]);
    const [hoverTarget, setHoverTarget] = useState(null);

    const [annotationMode, setAnnotationMode] = useState('outer');
    const historyRef = useRef([]);
    const [hasExported, setHasExported] = useState(false);
    const stageRef = useRef(null);

    // --- Load Mode / Dual Preview ---
    const [loadMode, setLoadMode] = useState(false);
    const [choicePending, setChoicePending] = useState(false);
    const [transformedPreview, setTransformedPreview] = useState(null);
    const [loadedPreview, setLoadedPreview] = useState(null);
    const [previewedImage, setPreviewedImage] = useState(null);
    const [loadingJson, setLoadingJson] = useState(false);
    const [jsonError, setJsonError] = useState(null);

    // --- Load current image ---
    const currentImageName = imageList[currentIndex];
    const imageURL = currentImageName
        ? `http://localhost:3001/images/${currentImageName}`
        : null;
    const [image] = useImage(imageURL, 'anonymous');

    const emptyAnn = {
        outer: {points: [], edges: []},
        inner: {points: [], edges: []},
        floor: {points: [], edges: []},
    };

    const getCurrentSnapshot = () => ({
        outer: {points: [...outerWallPoints], edges: [...outerWallEdges]},
        inner: {points: [...innerWallPoints], edges: [...innerWallEdges]},
        floor: {points: [...floorPoints], edges: [...floorEdges]},
    });

    const applySnapshot = (snap) => {
        const s = snap || emptyAnn;
        setOuterWallPoints(s.outer.points || []);
        setOuterWallEdges(s.outer.edges || []);
        setInnerWallPoints(s.inner.points || []);
        setInnerWallEdges(s.inner.edges || []);
        setFloorPoints(s.floor.points || []);
        setFloorEdges(s.floor.edges || []);
    };

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
        const MAX_HISTORY = 200;
        if (historyRef.current.length > MAX_HISTORY) {
            historyRef.current.shift();
        }
    };

    const handleMouseMove = (e) => {
        const stage = e.target.getStage();
        let mousePos = stage.getPointerPosition();

        if (mousePos && stageScale !== 1) {
            mousePos = {
                x: mousePos.x / stageScale,
                y: mousePos.y / stageScale
            };
        }

        const hoverDist = 8 / (stageScale || 1);
        let nearest = null;
        let minDist = Infinity;

        const allSets = [
            {mode: 'outer', points: outerWallPoints, edges: outerWallEdges},
            {mode: 'inner', points: innerWallPoints, edges: innerWallEdges},
            {mode: 'floor', points: floorPoints, edges: floorEdges}
        ];

        // Points
        for (const set of allSets) {
            set.points.forEach((pt, idx) => {
                const d = distance(mousePos, pt);
                if (d < hoverDist && d < minDist) {
                    minDist = d;
                    nearest = {type: 'point', mode: set.mode, index: idx, data: pt};
                }
            });
        }

        // Edges
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

    function imageToMat(imageObj) {
        const canvas = document.createElement('canvas');
        canvas.width = imageObj.naturalWidth || imageObj.width;
        canvas.height = imageObj.naturalHeight || imageObj.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imageObj, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const mat = matFromImageData(imgData);
        window.cv.cvtColor(mat, mat, window.cv.COLOR_RGBA2GRAY, 0);
        return mat;
    }

    function findImageAlignment(prevImageObj, currImageObj) {
        try {
            const matPrev = imageToMat(prevImageObj);
            const matCurr = imageToMat(currImageObj);

            const orb = new window.cv.ORB(500);
            const kpPrev = new window.cv.KeyPointVector();
            const descPrev = new window.cv.Mat();
            const kpCurr = new window.cv.KeyPointVector();
            const descCurr = new window.cv.Mat();

            orb.detectAndCompute(matPrev, new window.cv.Mat(), kpPrev, descPrev);
            orb.detectAndCompute(matCurr, new window.cv.Mat(), kpCurr, descCurr);

            const bf = new window.cv.BFMatcher(window.cv.NORM_HAMMING, true);
            const matches = new window.cv.DMatchVector();
            bf.match(descPrev, descCurr, matches);

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

            let transform;
            if (matches.size() === 3) {
                transform = window.cv.getAffineTransform(srcPoints, dstPoints);
            } else {
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
            console.warn('Image alignment failed:', err);
            return null;
        }
    }

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

    function findTranslationAlignment(prevImageObj, currImageObj) {
        try {
            const matPrev = imageToMat(prevImageObj);
            const matCurr = imageToMat(currImageObj);

            const templateSize =
                Math.min(matPrev.cols, matPrev.rows, matCurr.cols, matCurr.rows) * 0.5;
            const templateX = Math.floor((matPrev.cols - templateSize) / 2);
            const templateY = Math.floor((matPrev.rows - templateSize) / 2);

            const template = matPrev.roi(
                new window.cv.Rect(
                    templateX,
                    templateY,
                    Math.floor(templateSize),
                    Math.floor(templateSize)
                )
            );

            const result = new window.cv.Mat();
            const mask = new window.cv.Mat();
            window.cv.matchTemplate(matCurr, template, result, window.cv.TM_CCOEFF_NORMED, mask);

            const minMaxLoc = window.cv.minMaxLoc(result, mask);
            const matchX = minMaxLoc.maxLoc.x;
            const matchY = minMaxLoc.maxLoc.y;

            const shiftX = matchX - templateX;
            const shiftY = matchY - templateY;

            const transform = new window.cv.Mat(2, 3, window.cv.CV_64F);
            transform.set(0, 0, 1, 0);
            transform.set(0, 1, 0, 0);
            transform.set(0, 2, shiftX, 0);
            transform.set(1, 0, 0, 0);
            transform.set(1, 1, 1, 0);
            transform.set(1, 2, shiftY, 0);

            matPrev.delete();
            matCurr.delete();
            template.delete();
            result.delete();
            mask.delete();

            return transform;
        } catch (err) {
            console.warn('Translation alignment failed:', err);
            return null;
        }
    }

    function transformPointsBetweenImages(points, prevImageObj, currImageObj) {
        if (!points || points.length === 0 || !prevImageObj || !currImageObj) {
            return points;
        }

        let transform = findImageAlignment(prevImageObj, currImageObj);

        if (!transform) {
            console.log('Feature matching failed, trying translation alignment...');
            transform = findTranslationAlignment(prevImageObj, currImageObj);
        }

        if (!transform) {
            console.warn('Could not find alignment, returning original points');
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
            .catch((err) => console.error('Failed to fetch image list:', err));
    }, []);

    // Save current index
    useEffect(() => {
        if (imageList.length > 0) {
            localStorage.setItem('currentImageIndex', currentIndex.toString());
        }
    }, [currentIndex, imageList.length]);

    // Wait for OpenCV
    useEffect(() => {
        const waitForCV = () => {
            if (window.cv && window.cv.Mat) {
                console.log('✅ OpenCV.js ready');
                setCvReady(true);
            } else {
                console.log('⌛ Waiting for OpenCV...');
                setTimeout(waitForCV, 500);
            }
        };
        waitForCV();
    }, []);

    // Stage scale
    useEffect(() => {
        if (!image) {
            setStageScale(1);
            setStageDimensions({width: 0, height: 0});
            return;
        }

        const calculateStageScale = () => {
            const imgWidth = image.naturalWidth || image.width;
            const imgHeight = image.naturalHeight || image.height;

            const maxWidth = window.innerWidth - 100;
            const maxHeight = window.innerHeight - 200;

            const scaleX = maxWidth / imgWidth;
            const scaleY = maxHeight / imgHeight;
            const scale = Math.min(scaleX, scaleY, 1);

            setStageDimensions({width: imgWidth, height: imgHeight});
            setStageScale(scale);
        };

        calculateStageScale();
        const handleResize = () => calculateStageScale();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [image]);

    // Transform annotations between images
    useEffect(() => {
        if (!image) return;
        if (!prevImageName || !prevImage) {
            setPrevImageName(currentImageName);
            if (image) setPrevImage(image);
            return;
        }

        if (!cvReady) {
            console.warn('Skipping alignment — OpenCV not ready yet');
            setPrevImageName(currentImageName);
            if (image) setPrevImage(image);
            return;
        }

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
        setDidScaleForImage(false);
    }, [didScaleForImage, image]);

    function deletePoint(points, edges, pointIndex) {
        const remainingEdges = edges.filter(([a, b]) => a !== pointIndex && b !== pointIndex);

        const used = new Set();
        remainingEdges.forEach(([a, b]) => {
            used.add(a);
            used.add(b);
        });

        const newPoints = [];
        const remap = {};

        points.forEach((pt, i) => {
            if (i !== pointIndex && used.has(i)) {
                remap[i] = newPoints.length;
                newPoints.push(pt);
            }
        });

        const newEdges = remainingEdges.map(([a, b]) => [remap[a], remap[b]]);

        return {newPoints, newEdges};
    }

    function deleteEdge(points, edges, edgeIndex) {
        const remainingEdges = edges.filter((_, idx) => idx !== edgeIndex);

        const used = new Set();
        remainingEdges.forEach(([a, b]) => {
            used.add(a);
            used.add(b);
        });

        const newPoints = [];
        const remap = {};
        points.forEach((pt, i) => {
            if (used.has(i)) {
                remap[i] = newPoints.length;
                newPoints.push(pt);
            }
        });

        const newEdges = remainingEdges.map(([a, b]) => [remap[a], remap[b]]);
        return {newPoints, newEdges};
    }

    // ==================
    // Handle drawing click
    // ==================
    const handleClick = (e) => {
        if (loadMode && choicePending) {
            return;
        }

        e.evt.preventDefault();
        const stage = e.target.getStage();
        let point = stage.getPointerPosition();

        if (point && stageScale !== 1) {
            point = {
                x: point.x / stageScale,
                y: point.y / stageScale
            };
        }

        if (!point) return;

        const isRightClick = e.evt.button === 2;
        const isCtrlClick = e.evt.ctrlKey || e.evt.metaKey;

        if (isCtrlClick && hoverTarget?.type === 'point') {
            e.evt.stopPropagation();
            pushHistory();
            const {mode, index} = hoverTarget;

            if (mode === 'outer') {
                const {newPoints, newEdges} = deletePoint(outerWallPoints, outerWallEdges, index);
                setOuterWallPoints(newPoints);
                setOuterWallEdges(newEdges);
            } else if (mode === 'inner') {
                const {newPoints, newEdges} = deletePoint(innerWallPoints, innerWallEdges, index);
                setInnerWallPoints(newPoints);
                setInnerWallEdges(newEdges);
            } else {
                const {newPoints, newEdges} = deletePoint(floorPoints, floorEdges, index);
                setFloorPoints(newPoints);
                setFloorEdges(newEdges);
            }

            setHasExported(false);
            return;
        }

        if (isCtrlClick && hoverTarget?.type === 'edge') {
            e.evt.stopPropagation();
            pushHistory();
            const {mode, index} = hoverTarget;

            if (mode === 'outer') {
                const {newPoints, newEdges} = deleteEdge(outerWallPoints, outerWallEdges, index);
                setOuterWallPoints(newPoints);
                setOuterWallEdges(newEdges);
            } else if (mode === 'inner') {
                const {newPoints, newEdges} = deleteEdge(innerWallPoints, innerWallEdges, index);
                setInnerWallPoints(newPoints);
                setInnerWallEdges(newEdges);
            } else {
                const {newPoints, newEdges} = deleteEdge(floorPoints, floorEdges, index);
                setFloorPoints(newPoints);
                setFloorEdges(newEdges);
            }

            setHasExported(false);
            return;
        }

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

        setHasExported(false);
    };

    // ==================
    // Export JSON
    // ==================
    const exportData = async () => {
        if (!image) {
            alert('❌ No image loaded — cannot export yet.');
            return;
        }

        const imgWidth = image.naturalWidth || image.width;
        const imgHeight = image.naturalHeight || image.height;

        const output = {
            image_name: currentImageName,
            size: {width: imgWidth, height: imgHeight},
            outer_walls: {points: outerWallPoints, edges: outerWallEdges},
            inner_walls: {points: innerWallPoints, edges: innerWallEdges},
            floor: {points: floorPoints, edges: floorEdges},
        };

        try {
            const res = await fetch('http://localhost:3001/api/save-json', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    imageName: currentImageName,
                    data: output
                })
            });

            if (!res.ok) throw new Error(await res.text());
            const result = await res.json();
            console.log(`✅ Saved ${result.path}`);
            setHasExported(true);
        } catch (err) {
            console.error('❌ Error saving JSON:', err);
            alert('Failed to save JSON file.');
        }
    };

    // ==================
    // Navigation
    // ==================
    const goToImage = async (delta) => {
        const newIndex = currentIndex + delta;
        if (newIndex < 0 || newIndex >= imageList.length) {
            window.alert('No more images in this direction.');
            return;
        }

        if (
            !hasExported &&
            (outerWallPoints.length > 0 || innerWallPoints.length > 0 || floorPoints.length > 0)
        ) {
            const confirmed = window.confirm(
                '⚠️ You have unsaved annotations. Are you sure you want to continue without saving?'
            );
            if (!confirmed) {
                return;
            }
        }

        if (image) setPrevImage(image);
        setPrevImageName(currentImageName);
        setDidScaleForImage(false);
        setCurrentIndex(newIndex);
        setHasExported(false);
        setPreviewedImage(null);
        setChoicePending(false);
    };

    // ==================
    // Undo (Ctrl+Z)
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
                setHasExported(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, []);

    // ==================
    // Load Mode: Dual Preview Logic
    // ==================
    useEffect(() => {
        if (!image || !loadMode) {
            setChoicePending(false);
            setPreviewedImage(null);
            return;
        }

        if (previewedImage === currentImageName && !choicePending) {
            return;
        }

        // 1. Take current (previous-image) annotations
        const rawPrevAnn = getCurrentSnapshot();

        // 2. Apply carry-over transform HERE, manually
        const alignedAnn = {
            outer: {
                points: transformPointsBetweenImages(rawPrevAnn.outer.points, prevImage, image),
                edges: rawPrevAnn.outer.edges
            },
            inner: {
                points: transformPointsBetweenImages(rawPrevAnn.inner.points, prevImage, image),
                edges: rawPrevAnn.inner.edges
            },
            floor: {
                points: transformPointsBetweenImages(rawPrevAnn.floor.points, prevImage, image),
                edges: rawPrevAnn.floor.edges
            }
        };

        // 3. Save *correct* preview
        setTransformedPreview(alignedAnn);
        setLoadingJson(true);
        setJsonError(null);

        fetch(`http://localhost:3001/api/json/${currentImageName}`)
            .then((res) => res.json())
            .then((payload) => {
                if (payload.exists && payload.data) {
                    const d = payload.data;
                    setLoadedPreview({
                        outer: d.outer_walls || {points: [], edges: []},
                        inner: d.inner_walls || {points: [], edges: []},
                        floor: d.floor || {points: [], edges: []},
                    });
                } else {
                    setLoadedPreview(null);
                }
            })
            .catch((err) => {
                console.error('Error loading JSON:', err);
                setJsonError(String(err));
                setLoadedPreview(null);
            })
            .finally(() => {
                setLoadingJson(false);
                setChoicePending(true);
                setPreviewedImage(currentImageName);
            });
    }, [image, loadMode, currentImageName, prevImage]);

    const handleChooseTransformed = () => {
        pushHistory();
        applySnapshot(transformedPreview || emptyAnn);
        setChoicePending(false);
    };

    const handleChooseLoaded = () => {
        pushHistory();
        applySnapshot(loadedPreview || emptyAnn);
        setChoicePending(false);
    };

    // ==================
    // Rendering
    // ==================
    const currentFileLabel = currentImageName || '(no image)';

    const renderAnnotations = (ann, hover, modeLabel) => {
        const outer = ann.outer || {points: [], edges: []};
        const inner = ann.inner || {points: [], edges: []};
        const floor = ann.floor || {points: [], edges: []};

        return (
            <>
                {/* Outer */}
                {outer.edges.map(([i1, i2], idx) => (
                    <Line
                        key={`${modeLabel}-outer-${idx}`}
                        points={[
                            outer.points[i1].x,
                            outer.points[i1].y,
                            outer.points[i2].x,
                            outer.points[i2].y,
                        ]}
                        stroke="red"
                        strokeWidth={
                            hover?.type === 'edge' && hover?.mode === 'outer' && hover?.index === idx ? 3 : 2
                        }
                    />
                ))}
                {outer.points.map((pt, idx) => (
                    <Circle
                        key={`${modeLabel}-opt-${idx}`}
                        x={pt.x}
                        y={pt.y}
                        radius={
                            hover?.type === 'point' && hover?.mode === 'outer' && hover?.index === idx ? 6 : 4
                        }
                        fill="red"
                    />
                ))}

                {/* Inner */}
                {inner.edges.map(([i1, i2], idx) => (
                    <Line
                        key={`${modeLabel}-inner-${idx}`}
                        points={[
                            inner.points[i1].x,
                            inner.points[i1].y,
                            inner.points[i2].x,
                            inner.points[i2].y,
                        ]}
                        stroke="orange"
                        strokeWidth={
                            hover?.type === 'edge' && hover?.mode === 'inner' && hover?.index === idx ? 3 : 2
                        }
                    />
                ))}
                {inner.points.map((pt, idx) => (
                    <Circle
                        key={`${modeLabel}-ipt-${idx}`}
                        x={pt.x}
                        y={pt.y}
                        radius={
                            hover?.type === 'point' && hover?.mode === 'inner' && hover?.index === idx ? 6 : 4
                        }
                        fill="orange"
                    />
                ))}

                {/* Floor */}
                {floor.edges.map(([i1, i2], idx) => (
                    <Line
                        key={`${modeLabel}-floor-${idx}`}
                        points={[
                            floor.points[i1].x,
                            floor.points[i1].y,
                            floor.points[i2].x,
                            floor.points[i2].y,
                        ]}
                        stroke="green"
                        strokeWidth={
                            hover?.type === 'edge' && hover?.mode === 'floor' && hover?.index === idx ? 3 : 2
                        }
                    />
                ))}
                {floor.points.map((pt, idx) => (
                    <Circle
                        key={`${modeLabel}-fpt-${idx}`}
                        x={pt.x}
                        y={pt.y}
                        radius={
                            hover?.type === 'point' && hover?.mode === 'floor' && hover?.index === idx ? 6 : 4
                        }
                        fill="green"
                    />
                ))}
            </>
        );
    };

    return (
        <div className="p-4 space-y-4">
            {/* === Toolbar === */}
            <div className="flex gap-4 items-center" style={{marginBottom: 12}}>
                <Button
                    onClick={() => {
                        const next =
                            annotationMode === 'outer'
                                ? 'inner'
                                : annotationMode === 'inner'
                                    ? 'floor'
                                    : 'outer';
                        setAnnotationMode(next);
                    }}
                    color={annotationMode === 'outer' ? 'red' : annotationMode === 'inner' ? 'orange' : 'green'}
                    inactive={loadMode && choicePending}
                >
                    Mode:{' '}
                    {annotationMode === 'outer'
                        ? 'Outer Walls'
                        : annotationMode === 'inner'
                            ? 'Inner Walls'
                            : 'Floor'}
                </Button>

                <Button onClick={exportData} color="green" inactive={loadMode && choicePending}>
                    Save
                </Button>

                <Button
                    onClick={() => {
                        pushHistory();
                        setOuterWallPoints([]);
                        setOuterWallEdges([]);
                        setInnerWallPoints([]);
                        setInnerWallEdges([]);
                        setFloorPoints([]);
                        setFloorEdges([]);
                        setHasExported(false);
                    }}
                    inactive={loadMode && choicePending}
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

                <label style={{marginLeft: 16}}>
                    <input
                        type="checkbox"
                        checked={loadMode}
                        onChange={(e) => {
                            const val = e.target.checked;
                            setLoadMode(val);
                            if (!val) {
                                setChoicePending(false);
                                setPreviewedImage(null);
                            }
                        }}
                        style={{marginRight: 4}}
                    />
                    Load mode
                </label>

                <span style={{fontWeight: 'bold', color: hasExported ? 'green' : 'red', marginLeft: 16}}>
          {hasExported ? 'Saved' : 'Not Saved'}
        </span>

                <span style={{marginLeft: 10, fontStyle: 'italic', color: '#555'}}>
          Left-click = connect, Right-click = free node
        </span>

                <span style={{marginLeft: 10}}>{currentFileLabel}</span>
            </div>

            {loadMode && choicePending && image ? (
                <div>
                    {loadingJson && <p style={{padding: 10}}>Loading JSON…</p>}
                    {jsonError && <p style={{padding: 10, color: 'red'}}>Error: {jsonError}</p>}
                    <div
                        style={{
                            display: 'flex',
                            gap: '16px',
                            alignItems: 'flex-start',
                            justifyContent: 'center',
                        }}
                    >
                        {/* Left: Transformed preview */}
                        <div>
                            <div style={{marginBottom: 4, textAlign: 'center', fontWeight: 'bold'}}>
                                Carry-over (transformed)
                            </div>
                            <Stage
                                width={stageDimensions.width}
                                height={stageDimensions.height}
                                scaleX={stageScale}
                                scaleY={stageScale}
                            >
                                <Layer>
                                    <KonvaImage
                                        image={image}
                                        width={image.naturalWidth || image.width}
                                        height={image.naturalHeight || image.height}
                                    />
                                    {renderAnnotations(transformedPreview || emptyAnn, null, 'left')}
                                </Layer>
                            </Stage>
                            <div style={{textAlign: 'center', marginTop: 8}}>
                                <Button onClick={handleChooseTransformed} color="blue">
                                    Choose this
                                </Button>
                            </div>
                        </div>

                        {/* Right: Loaded JSON preview */}
                        <div>
                            <div style={{marginBottom: 4, textAlign: 'center', fontWeight: 'bold'}}>
                                Loaded from JSON
                            </div>
                            <Stage
                                width={stageDimensions.width}
                                height={stageDimensions.height}
                                scaleX={stageScale}
                                scaleY={stageScale}
                            >
                                <Layer>
                                    <KonvaImage
                                        image={image}
                                        width={image.naturalWidth || image.width}
                                        height={image.naturalHeight || image.height}
                                    />
                                    {renderAnnotations(loadedPreview || emptyAnn, null, 'right')}
                                </Layer>
                            </Stage>
                            <div style={{textAlign: 'center', marginTop: 8}}>
                                <Button onClick={handleChooseLoaded} color="green">
                                    Choose this
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div
                    className="border border-gray-300 inline-block"
                    style={{
                        overflow: 'auto',
                        maxWidth: '100vw',
                        maxHeight: '90vh',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'flex-start',
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
                                            outerWallPoints[i1].x,
                                            outerWallPoints[i1].y,
                                            outerWallPoints[i2].x,
                                            outerWallPoints[i2].y,
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
                                    <Circle
                                        key={`opt-${idx}`}
                                        x={pt.x}
                                        y={pt.y}
                                        radius={
                                            hoverTarget?.type === 'point' &&
                                            hoverTarget?.mode === 'outer' &&
                                            hoverTarget?.index === idx
                                                ? 6
                                                : 4
                                        }
                                        fill="red"
                                    />
                                ))}

                                {/* Inner Walls (orange) */}
                                {innerWallEdges.map(([i1, i2], idx) => (
                                    <Line
                                        key={`inner-${idx}`}
                                        points={[
                                            innerWallPoints[i1].x,
                                            innerWallPoints[i1].y,
                                            innerWallPoints[i2].x,
                                            innerWallPoints[i2].y,
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
                                    <Circle
                                        key={`ipt-${idx}`}
                                        x={pt.x}
                                        y={pt.y}
                                        radius={
                                            hoverTarget?.type === 'point' &&
                                            hoverTarget?.mode === 'inner' &&
                                            hoverTarget?.index === idx
                                                ? 6
                                                : 4
                                        }
                                        fill="orange"
                                    />
                                ))}

                                {/* Floor (green) */}
                                {floorEdges.map(([i1, i2], idx) => (
                                    <Line
                                        key={`floor-${idx}`}
                                        points={[
                                            floorPoints[i1].x,
                                            floorPoints[i1].y,
                                            floorPoints[i2].x,
                                            floorPoints[i2].y,
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
                                    <Circle
                                        key={`fpt-${idx}`}
                                        x={pt.x}
                                        y={pt.y}
                                        radius={
                                            hoverTarget?.type === 'point' &&
                                            hoverTarget?.mode === 'floor' &&
                                            hoverTarget?.index === idx
                                                ? 6
                                                : 4
                                        }
                                        fill="green"
                                    />
                                ))}
                            </Layer>
                        </Stage>
                    ) : (
                        <p style={{padding: 10}}>Loading image...</p>
                    )}
                </div>
            )}
        </div>
    );
}
