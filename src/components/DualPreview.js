import React from "react";
import { Stage, Layer, Image as KonvaImage, Line, Circle } from "react-konva";

export default function DualPreview({
                                        leftImage,
                                        rightImage,
                                        leftAnnotations,
                                        rightAnnotations,
                                        onChooseLeft,
                                        onChooseRight,
                                    }) {
    const renderAnnotations = (points, edges, color) => (
        <>
            {edges.map(([i1, i2], idx) => (
                <Line
                    key={"edge" + idx}
                    points={[points[i1].x, points[i1].y, points[i2].x, points[i2].y]}
                    stroke={color}
                    strokeWidth={2}
                />
            ))}
            {points.map((pt, idx) => (
                <Circle key={"pt" + idx} x={pt.x} y={pt.y} radius={4} fill={color} />
            ))}
        </>
    );

    const renderCanvas = (img, ann) => {
        if (!img) return null;
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;

        return (
            <Stage width={width} height={height}>
                <Layer>
                    <KonvaImage image={img} width={width} height={height} />
                    {renderAnnotations(ann.outer.points, ann.outer.edges, "red")}
                    {renderAnnotations(ann.inner.points, ann.inner.edges, "orange")}
                    {renderAnnotations(ann.floor.points, ann.floor.edges, "green")}
                </Layer>
            </Stage>
        );
    };

    return (
        <div style={{ display: "flex", gap: 30, padding: 20 }}>
            <div>
                <h3>Transformed Previous</h3>
                {renderCanvas(leftImage, leftAnnotations)}
                <button onClick={onChooseLeft} style={{ marginTop: 10 }}>Use These</button>
            </div>

            <div>
                <h3>Loaded From JSON</h3>
                {renderCanvas(rightImage, rightAnnotations)}
                <button onClick={onChooseRight} style={{ marginTop: 10 }}>Use These</button>
            </div>
        </div>
    );
}