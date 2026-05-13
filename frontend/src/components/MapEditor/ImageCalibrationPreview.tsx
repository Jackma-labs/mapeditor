import React, { useEffect, useRef, useState } from 'react';

interface ImageCalibrationPreviewProps {
    src: string;
    item: any;
    mode: 'raw' | 'undistort';
}

const MAX_CANVAS_SIZE = 760;

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function sampleBilinear(data: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
    const x0 = clamp(Math.floor(x), 0, width - 1);
    const y0 = clamp(Math.floor(y), 0, height - 1);
    const x1 = clamp(x0 + 1, 0, width - 1);
    const y1 = clamp(y0 + 1, 0, height - 1);
    const dx = x - x0;
    const dy = y - y0;
    const i00 = (y0 * width + x0) * 4;
    const i10 = (y0 * width + x1) * 4;
    const i01 = (y1 * width + x0) * 4;
    const i11 = (y1 * width + x1) * 4;
    const result = [0, 0, 0, 255];
    for (let channel = 0; channel < 3; channel += 1) {
        const top = data[i00 + channel] * (1 - dx) + data[i10 + channel] * dx;
        const bottom = data[i01 + channel] * (1 - dx) + data[i11 + channel] * dx;
        result[channel] = top * (1 - dy) + bottom * dy;
    }
    return result;
}

function drawUndistortedImage(canvas: HTMLCanvasElement, image: HTMLImageElement, calibration: any) {
    const targetCanvas = canvas;
    const sourceWidth = image.naturalWidth;
    const sourceHeight = image.naturalHeight;
    const scale = Math.min(1, MAX_CANVAS_SIZE / Math.max(sourceWidth, sourceHeight));
    const outputWidth = Math.max(1, Math.round(sourceWidth * scale));
    const outputHeight = Math.max(1, Math.round(sourceHeight * scale));
    targetCanvas.width = outputWidth;
    targetCanvas.height = outputHeight;
    const context = targetCanvas.getContext('2d');
    if (!context) {
        return;
    }

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = sourceWidth;
    sourceCanvas.height = sourceHeight;
    const sourceContext = sourceCanvas.getContext('2d');
    if (!sourceContext) {
        context.drawImage(image, 0, 0, outputWidth, outputHeight);
        return;
    }
    sourceContext.drawImage(image, 0, 0, sourceWidth, sourceHeight);
    let sourceImageData: ImageData;
    try {
        sourceImageData = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight);
    } catch (error) {
        context.drawImage(image, 0, 0, outputWidth, outputHeight);
        return;
    }

    const cameraWidth = calibration?.imageSize?.width || sourceWidth;
    const cameraHeight = calibration?.imageSize?.height || sourceHeight;
    const intrinsics = calibration?.intrinsics || {};
    const distortion = calibration?.distortion || {};
    const fx = Number(intrinsics.fx || cameraWidth);
    const fy = Number(intrinsics.fy || cameraHeight);
    const cx = Number(intrinsics.cx || cameraWidth / 2);
    const cy = Number(intrinsics.cy || cameraHeight / 2);
    const [k1 = 0, k2 = 0, k3 = 0] = distortion.k || [];
    const [p1 = 0, p2 = 0] = distortion.p || [];
    const outputData = context.createImageData(outputWidth, outputHeight);

    for (let y = 0; y < outputHeight; y += 1) {
        for (let x = 0; x < outputWidth; x += 1) {
            const cameraX = x / scale / (sourceWidth / cameraWidth);
            const cameraY = y / scale / (sourceHeight / cameraHeight);
            const nx = (cameraX - cx) / fx;
            const ny = (cameraY - cy) / fy;
            const r2 = nx * nx + ny * ny;
            const radial = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2;
            const distortedX = nx * radial + 2 * p1 * nx * ny + p2 * (r2 + 2 * nx * nx);
            const distortedY = ny * radial + p1 * (r2 + 2 * ny * ny) + 2 * p2 * nx * ny;
            const sourceCameraX = fx * distortedX + cx;
            const sourceCameraY = fy * distortedY + cy;
            const sourceX = sourceCameraX * (sourceWidth / cameraWidth);
            const sourceY = sourceCameraY * (sourceHeight / cameraHeight);
            const outputIndex = (y * outputWidth + x) * 4;
            if (sourceX < 0 || sourceX >= sourceWidth || sourceY < 0 || sourceY >= sourceHeight) {
                outputData.data[outputIndex + 3] = 255;
            } else {
                const pixel = sampleBilinear(sourceImageData.data, sourceWidth, sourceHeight, sourceX, sourceY);
                outputData.data[outputIndex] = pixel[0];
                outputData.data[outputIndex + 1] = pixel[1];
                outputData.data[outputIndex + 2] = pixel[2];
                outputData.data[outputIndex + 3] = 255;
            }
        }
    }
    context.putImageData(outputData, 0, 0);
}

export default function ImageCalibrationPreview({ src, item, mode }: ImageCalibrationPreviewProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (mode !== 'undistort' || !canvasRef.current) {
            return undefined;
        }
        let disposed = false;
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
            if (disposed || !canvasRef.current) {
                return;
            }
            drawUndistortedImage(canvasRef.current, image, item?.calibration);
        };
        image.onerror = () => setFailed(true);
        image.src = src;
        return () => {
            disposed = true;
        };
    }, [src, item, mode]);

    if (failed || mode === 'raw' || !item?.calibration) {
        return <img src={src} alt={item?.imageName || ''} />;
    }

    return <canvas ref={canvasRef} className="image-calibration-canvas" />;
}
