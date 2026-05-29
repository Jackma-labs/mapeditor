import { AddArrowCommand } from 'src/command/ArrowCommand';
import {
    AddBoundaryCommand,
    AddPointToBoundaryCommand,
    RemovePointFromBoundaryCommand,
} from 'src/command/BoundaryCommand';
import { AddGroudCommand, UpdateGroudCommand } from 'src/command/GroudCommand';
import { AddLaneCommand } from 'src/command/LaneCommand';
import { DeletePointCommand } from 'src/command/PointCommand';
import { BoundaryOriginType, PointElement } from 'src/interface/basicElementInterFace';
import { ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { Lane, LaneBoundaryType, LaneTrend, ProssibleDrivingDirection } from 'src/interface/laneInterFace';
import { useManagerStore } from 'src/store';
import { getLaneEndPointIds, getLaneStartPointIds } from 'src/utils/geometryUtil';
import { searchBoundaryPointIdsByBoundaryId } from 'src/utils/search/boundarySearch';
import { searchPointsRelationObjects } from 'src/utils/search/common';
import { searchLaneFirstPeriodPoints, searchLaneLastPeriodPoints } from 'src/utils/search/laneSearch';
import { objectSearch } from 'src/utils/search/objectSearch';
import { getElementMaxIndex } from 'src/utils/threeObjectUtil';
import * as THREE from 'three';

const CURVE_CONNECT_SAMPLE_COUNT = 21;
const CURVE_CONNECT_REJECT_RADIUS = 2.0;
const CURVE_CONNECT_PREFERRED_RADIUS = 4.5;
const CURVE_CONNECT_MIN_WIDTH = 1.8;
const CURVE_CONNECT_MIN_WIDTH_RATIO = 0.72;
const CURVE_CONNECT_WIDTH_TARGET_RATIO = 0.88;
const CURVE_CONNECT_SIDE_ORDER_PENALTY = 12;
const CURVE_CONNECT_MAX_CHORD_ANGLE = THREE.MathUtils.degToRad(135);
const CURVE_CONNECT_MAX_HEADING_CHANGE = THREE.MathUtils.degToRad(150);
const CURVE_CONNECT_DEFAULT_SPEED_KPH = 9;

function pointDistance(left: PointElement, right: PointElement) {
    return left.position.distanceTo(right.position);
}

function midpoint(left: THREE.Vector3, right: THREE.Vector3) {
    return new THREE.Vector3((left.x + right.x) / 2, (left.y + right.y) / 2, (left.z + right.z) / 2);
}

function safeDirection(from: THREE.Vector3, to: THREE.Vector3) {
    const direction = to.clone().sub(from);
    return direction.length() > 0.001 ? direction.normalize() : null;
}

function cubicPoint(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, t: number) {
    const oneMinusT = 1 - t;
    return new THREE.Vector3(
        oneMinusT ** 3 * p0.x + 3 * oneMinusT ** 2 * t * p1.x + 3 * oneMinusT * t ** 2 * p2.x + t ** 3 * p3.x,
        oneMinusT ** 3 * p0.y + 3 * oneMinusT ** 2 * t * p1.y + 3 * oneMinusT * t ** 2 * p2.y + t ** 3 * p3.y,
        oneMinusT ** 3 * p0.z + 3 * oneMinusT ** 2 * t * p1.z + 3 * oneMinusT * t ** 2 * p2.z + t ** 3 * p3.z,
    );
}

function cubicDerivative(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, t: number) {
    const oneMinusT = 1 - t;
    return new THREE.Vector3(
        3 * oneMinusT ** 2 * (p1.x - p0.x) + 6 * oneMinusT * t * (p2.x - p1.x) + 3 * t ** 2 * (p3.x - p2.x),
        3 * oneMinusT ** 2 * (p1.y - p0.y) + 6 * oneMinusT * t * (p2.y - p1.y) + 3 * t ** 2 * (p3.y - p2.y),
        3 * oneMinusT ** 2 * (p1.z - p0.z) + 6 * oneMinusT * t * (p2.z - p1.z) + 3 * t ** 2 * (p3.z - p2.z),
    );
}

function leftNormal(direction: THREE.Vector3) {
    const normal = new THREE.Vector3(-direction.y, direction.x, 0);
    return normal.length() > 0.001 ? normal.normalize() : null;
}

interface CubicFitSample {
    t: number;
    point: THREE.Vector3;
}

function fitCubicControlsFromSamples(p0: THREE.Vector3, p3: THREE.Vector3, samples: CubicFitSample[]) {
    let a = 0;
    let b = 0;
    let c = 0;
    const d = new THREE.Vector3();
    const e = new THREE.Vector3();

    samples.forEach(({ t, point }) => {
        const oneMinusT = 1 - t;
        const b0 = oneMinusT ** 3;
        const b1 = 3 * oneMinusT ** 2 * t;
        const b2 = 3 * oneMinusT * t ** 2;
        const b3 = t ** 3;
        const residual = point.clone().sub(p0.clone().multiplyScalar(b0)).sub(p3.clone().multiplyScalar(b3));

        a += b1 * b1;
        b += b1 * b2;
        c += b2 * b2;
        d.add(residual.clone().multiplyScalar(b1));
        e.add(residual.clone().multiplyScalar(b2));
    });

    const det = a * c - b * b;
    if (Math.abs(det) <= 0.000001) {
        return null;
    }

    return [
        d
            .clone()
            .multiplyScalar(c)
            .sub(e.clone().multiplyScalar(b))
            .multiplyScalar(1 / det),
        e
            .clone()
            .multiplyScalar(a)
            .sub(d.clone().multiplyScalar(b))
            .multiplyScalar(1 / det),
    ];
}

function sampleCubic(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3) {
    return Array.from({ length: CURVE_CONNECT_SAMPLE_COUNT }, (_, index) =>
        cubicPoint(p0, p1, p2, p3, index / (CURVE_CONNECT_SAMPLE_COUNT - 1)),
    );
}

function getPolylineMinRadius(points: THREE.Vector3[]) {
    let minRadius = Infinity;
    for (let index = 1; index < points.length - 1; index += 1) {
        const a = points[index - 1];
        const b = points[index];
        const c = points[index + 1];
        const ab = a.distanceTo(b);
        const bc = b.distanceTo(c);
        const ac = a.distanceTo(c);
        const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
        if (area >= 0.000001 && ab * bc * ac !== 0) {
            minRadius = Math.min(minRadius, (ab * bc * ac) / (4 * area));
        }
    }
    return minRadius;
}

function averageCenter(left: PointElement, right: PointElement) {
    return midpoint(left.position, right.position);
}

function formatMeters(value: number) {
    return Number.isFinite(value) ? `${value.toFixed(2)}m` : '未知';
}

function angleBetween(left: THREE.Vector3, right: THREE.Vector3) {
    if (left.length() <= 0.001 || right.length() <= 0.001) {
        return Math.PI;
    }
    return left.angleTo(right);
}

function getCircularBezierHandleFactor(turnAngle: number) {
    const angle = THREE.MathUtils.clamp(turnAngle, 0.01, Math.PI);
    const denominator = 2 * Math.sin(angle / 2);
    if (Math.abs(denominator) <= 0.001) {
        return 1 / 3;
    }
    const factor = ((4 / 3) * Math.tan(angle / 4)) / denominator;
    return THREE.MathUtils.clamp(factor, 0.28, 0.56);
}

function signedLateralOffset(direction: THREE.Vector3, center: THREE.Vector3, point: THREE.Vector3) {
    return direction.x * (point.y - center.y) - direction.y * (point.x - center.x);
}

function orientation(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
    return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function pointOnSegment(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
    return (
        Math.min(a.x, c.x) - 0.001 <= b.x &&
        b.x <= Math.max(a.x, c.x) + 0.001 &&
        Math.min(a.y, c.y) - 0.001 <= b.y &&
        b.y <= Math.max(a.y, c.y) + 0.001
    );
}

function segmentsIntersect(a1: THREE.Vector3, a2: THREE.Vector3, b1: THREE.Vector3, b2: THREE.Vector3) {
    const o1 = orientation(a1, a2, b1);
    const o2 = orientation(a1, a2, b2);
    const o3 = orientation(b1, b2, a1);
    const o4 = orientation(b1, b2, a2);
    if (o1 * o2 < 0 && o3 * o4 < 0) {
        return true;
    }
    if (Math.abs(o1) <= 0.001 && pointOnSegment(a1, b1, a2)) return true;
    if (Math.abs(o2) <= 0.001 && pointOnSegment(a1, b2, a2)) return true;
    if (Math.abs(o3) <= 0.001 && pointOnSegment(b1, a1, b2)) return true;
    if (Math.abs(o4) <= 0.001 && pointOnSegment(b1, a2, b2)) return true;
    return false;
}

function polylinesIntersect(left: THREE.Vector3[], right: THREE.Vector3[]) {
    for (let leftIndex = 1; leftIndex < left.length; leftIndex += 1) {
        for (let rightIndex = 1; rightIndex < right.length; rightIndex += 1) {
            if (segmentsIntersect(left[leftIndex - 1], left[leftIndex], right[rightIndex - 1], right[rightIndex])) {
                return true;
            }
        }
    }
    return false;
}
/**
 * 根据四个点，计算曲线的控制点，一共返回两个控制点
 */
export function getCurveControlPointPositions(points: PointElement[]) {
    const [p1, p2, p3, p4] = points;
    if (!p1 || !p2 || !p3 || !p4) {
        return null;
    }
    const p1Mesh = objectSearch(ThreeObject.Point, p1.id);
    const p2Mesh = objectSearch(ThreeObject.Point, p2.id);
    const p3Mesh = objectSearch(ThreeObject.Point, p3.id);
    const p4Mesh = objectSearch(ThreeObject.Point, p4.id);
    const p1Position = p1Mesh?.position || p1.position;
    const p2Position = p2Mesh?.position || p2.position;
    const p3Position = p3Mesh?.position || p3.position;
    const p4Position = p4Mesh?.position || p4.position;
    const chordLength = p2Position.distanceTo(p3Position);
    const startDirection = safeDirection(p1Position, p2Position);
    const endDirection = safeDirection(p3Position, p4Position);
    if (!startDirection || !endDirection || chordLength <= 0.001) {
        return null;
    }

    const turnAngle = angleBetween(startDirection, endDirection);
    const handleFactor = getCircularBezierHandleFactor(turnAngle);
    const handleLength = THREE.MathUtils.clamp(
        chordLength * handleFactor,
        Math.max(0.2, chordLength * 0.2),
        Math.max(0.4, chordLength * 0.65),
    );
    const firstControlPointPosition = p2Position.clone().add(startDirection.clone().multiplyScalar(handleLength));
    const secondControlPointPosition = p3Position.clone().sub(endDirection.clone().multiplyScalar(handleLength));
    return [firstControlPointPosition, secondControlPointPosition];
}
/**
 * 获取弯道连接两个车道的曲线的手柄位置
 * 一共返回四个手柄位置，分别为左车道的曲线的两个手柄，以及右车道曲线的两个手柄
 */
export function getCurveConnectLaneControlPointPositions(
    lane1LastPeriodPoints: PointElement[],
    lane2FirstPeriodPoints: PointElement[],
    extraHalfWidth?: number,
) {
    const [sourceLeftPrev, sourceLeftEnd, sourceRightPrev, sourceRightEnd] = lane1LastPeriodPoints;
    const [targetLeftStart, targetLeftNext, targetRightStart, targetRightNext] = lane2FirstPeriodPoints;
    if (
        !sourceLeftPrev ||
        !sourceLeftEnd ||
        !sourceRightPrev ||
        !sourceRightEnd ||
        !targetLeftStart ||
        !targetLeftNext ||
        !targetRightStart ||
        !targetRightNext
    ) {
        return null;
    }
    const sourceCenterPrev = averageCenter(sourceLeftPrev, sourceRightPrev);
    const sourceCenterEnd = averageCenter(sourceLeftEnd, sourceRightEnd);
    const targetCenterStart = averageCenter(targetLeftStart, targetRightStart);
    const targetCenterNext = averageCenter(targetLeftNext, targetRightNext);
    const startDirection = safeDirection(sourceCenterPrev, sourceCenterEnd);
    const endDirection = safeDirection(targetCenterStart, targetCenterNext);
    const chordLength = sourceCenterEnd.distanceTo(targetCenterStart);
    if (!startDirection || !endDirection || chordLength <= 0.001) {
        return null;
    }

    const turnAngle = angleBetween(startDirection, endDirection);
    const handleFactor = getCircularBezierHandleFactor(turnAngle);
    const sourceApproachLength = sourceCenterPrev.distanceTo(sourceCenterEnd);
    const targetApproachLength = targetCenterStart.distanceTo(targetCenterNext);
    const approachLimit = Math.max(0.6, Math.min(sourceApproachLength, targetApproachLength) * 1.4);
    const handleLength = THREE.MathUtils.clamp(
        chordLength * handleFactor,
        Math.max(0.4, chordLength * 0.22),
        Math.max(0.6, Math.min(chordLength * 0.95, approachLimit)),
    );

    const centerControl1 = sourceCenterEnd.clone().add(startDirection.clone().multiplyScalar(handleLength));
    const centerControl2 = targetCenterStart.clone().sub(endDirection.clone().multiplyScalar(handleLength));
    const sourceLeftOffset = sourceLeftEnd.position.clone().sub(sourceCenterEnd);
    const sourceRightOffset = sourceRightEnd.position.clone().sub(sourceCenterEnd);
    const targetLeftOffset = targetLeftStart.position.clone().sub(targetCenterStart);
    const targetRightOffset = targetRightStart.position.clone().sub(targetCenterStart);
    const fallbackControls = [
        centerControl1.clone().add(sourceLeftOffset),
        centerControl2.clone().add(targetLeftOffset),
        centerControl1.clone().add(sourceRightOffset),
        centerControl2.clone().add(targetRightOffset),
    ];
    const sourceHalfWidth = sourceLeftEnd.position.distanceTo(sourceRightEnd.position) / 2;
    const targetHalfWidth = targetLeftStart.position.distanceTo(targetRightStart.position) / 2;
    const turnWidthCompensation =
        extraHalfWidth ?? ((sourceHalfWidth + targetHalfWidth) / 2) * 0.36 * Math.sin(Math.min(turnAngle, Math.PI) / 2);
    const leftSamples: CubicFitSample[] = [];
    const rightSamples: CubicFitSample[] = [];

    for (let index = 1; index < CURVE_CONNECT_SAMPLE_COUNT - 1; index += 1) {
        const t = index / (CURVE_CONNECT_SAMPLE_COUNT - 1);
        const centerPoint = cubicPoint(sourceCenterEnd, centerControl1, centerControl2, targetCenterStart, t);
        const tangent = cubicDerivative(sourceCenterEnd, centerControl1, centerControl2, targetCenterStart, t);
        const normal = leftNormal(tangent) || leftNormal(startDirection);
        if (!normal) {
            return fallbackControls;
        }
        const halfWidth =
            THREE.MathUtils.lerp(sourceHalfWidth, targetHalfWidth, t) + turnWidthCompensation * Math.sin(Math.PI * t);
        leftSamples.push({
            t,
            point: centerPoint.clone().add(normal.clone().multiplyScalar(halfWidth)),
        });
        rightSamples.push({
            t,
            point: centerPoint.clone().sub(normal.clone().multiplyScalar(halfWidth)),
        });
    }

    const leftControls = fitCubicControlsFromSamples(sourceLeftEnd.position, targetLeftStart.position, leftSamples);
    const rightControls = fitCubicControlsFromSamples(sourceRightEnd.position, targetRightStart.position, rightSamples);
    if (!leftControls || !rightControls) {
        return fallbackControls;
    }

    return [leftControls[0], leftControls[1], rightControls[0], rightControls[1]];
}

interface CurveConnectCandidateEvaluation {
    pointIds: string[];
    controlsPosition: THREE.Vector3[];
    score: number;
    diagnostics: string[];
}

interface CurveConnectCandidateRejection {
    rejected: true;
    reason: string;
    score: number;
    diagnostics: string[];
}

interface CurveConnectInfo {
    pointIds: string[];
    controlsPosition: THREE.Vector3[];
    failureReason?: string;
    diagnostics?: string[];
}

type CurveConnectCandidateResult = CurveConnectCandidateEvaluation | CurveConnectCandidateRejection;

function rejectCurveConnectCandidate(
    reason: string,
    score: number = Infinity,
    diagnostics: string[] = [],
): CurveConnectCandidateRejection {
    return {
        rejected: true,
        reason,
        score,
        diagnostics,
    };
}

function isAcceptedCurveConnectCandidate(item: CurveConnectCandidateResult): item is CurveConnectCandidateEvaluation {
    return !('rejected' in item);
}

function evaluateCurveConnectCandidate(item: PointElement[]): CurveConnectCandidateResult {
    if (item.length !== 8 || item.some((point) => !point)) {
        return rejectCurveConnectCandidate('车道端点数据不完整，无法判断弯道连接。');
    }

    const sourceCenterPrev = averageCenter(item[0], item[4]);
    const sourceCenterEnd = averageCenter(item[1], item[5]);
    const targetCenterStart = averageCenter(item[2], item[6]);
    const targetCenterNext = averageCenter(item[3], item[7]);
    const sourceDirection = safeDirection(sourceCenterPrev, sourceCenterEnd);
    const chordDirection = safeDirection(sourceCenterEnd, targetCenterStart);
    const targetDirection = safeDirection(targetCenterStart, targetCenterNext);
    const averageDistance = (pointDistance(item[1], item[2]) + pointDistance(item[5], item[6])) / 2;
    const chordLength = sourceCenterEnd.distanceTo(targetCenterStart);
    const endpointWidth = (pointDistance(item[1], item[5]) + pointDistance(item[2], item[6])) / 2;
    const diagnostics = [
        `端点中心距：${formatMeters(chordLength)}`,
        `端点平均距：${formatMeters(averageDistance)}`,
        `平均宽度：${formatMeters(endpointWidth)}`,
    ];

    if (!sourceDirection || !chordDirection || !targetDirection) {
        return rejectCurveConnectCandidate('车道方向或端点距离过短，无法生成稳定弯道。', averageDistance, diagnostics);
    }

    const controlsPosition = getCurveConnectLaneControlPointPositions(
        item.slice(0, 2).concat(item.slice(4, 6)),
        item.slice(2, 4).concat(item.slice(6)),
    );
    if (!controlsPosition || controlsPosition.length !== 4) {
        return rejectCurveConnectCandidate('无法计算稳定的弯道控制点。', averageDistance, diagnostics);
    }

    const crossedAverageDistance = (pointDistance(item[1], item[6]) + pointDistance(item[5], item[2])) / 2;
    if (crossedAverageDistance + 0.25 < averageDistance) {
        return rejectCurveConnectCandidate(
            '左右边界更像是交叉连接，请先确认车道方向或左右边界顺序。',
            averageDistance,
            diagnostics.concat(`交叉平均距：${formatMeters(crossedAverageDistance)}`),
        );
    }

    const sourceSideMargin = Math.min(0.2, Math.max(0.03, pointDistance(item[1], item[5]) * 0.05));
    const targetSideMargin = Math.min(0.2, Math.max(0.03, pointDistance(item[2], item[6]) * 0.05));
    const sourceLeftOffset = signedLateralOffset(sourceDirection, sourceCenterEnd, item[1].position);
    const sourceRightOffset = signedLateralOffset(sourceDirection, sourceCenterEnd, item[5].position);
    const targetLeftOffset = signedLateralOffset(targetDirection, targetCenterStart, item[2].position);
    const targetRightOffset = signedLateralOffset(targetDirection, targetCenterStart, item[6].position);
    const sideOrderMismatch =
        sourceLeftOffset <= sourceSideMargin ||
        sourceRightOffset >= -sourceSideMargin ||
        targetLeftOffset <= targetSideMargin ||
        targetRightOffset >= -targetSideMargin;

    const sourceChordAngle = angleBetween(sourceDirection, chordDirection);
    const targetChordAngle = angleBetween(chordDirection, targetDirection);
    const headingChange = angleBetween(sourceDirection, targetDirection);
    if (sourceChordAngle > CURVE_CONNECT_MAX_CHORD_ANGLE || targetChordAngle > CURVE_CONNECT_MAX_CHORD_ANGLE) {
        return rejectCurveConnectCandidate(
            '端点位置在车道行驶方向的后方或侧后方，弯道连接会产生反折。',
            averageDistance,
            diagnostics.concat(
                `入口夹角：${THREE.MathUtils.radToDeg(sourceChordAngle).toFixed(1)}°`,
                `出口夹角：${THREE.MathUtils.radToDeg(targetChordAngle).toFixed(1)}°`,
            ),
        );
    }
    if (headingChange > CURVE_CONNECT_MAX_HEADING_CHANGE) {
        return rejectCurveConnectCandidate(
            '两条车道方向变化过大，当前工具不自动生成接近掉头的弯道。',
            averageDistance,
            diagnostics.concat(`方向变化：${THREE.MathUtils.radToDeg(headingChange).toFixed(1)}°`),
        );
    }

    const leftCurveSamples = sampleCubic(item[1].position, controlsPosition[0], controlsPosition[1], item[2].position);
    const rightCurveSamples = sampleCubic(item[5].position, controlsPosition[2], controlsPosition[3], item[6].position);
    if (polylinesIntersect(leftCurveSamples, rightCurveSamples)) {
        return rejectCurveConnectCandidate('弯道左右边界会发生交叉，已阻止生成。', averageDistance, diagnostics);
    }
    const minAllowedWidth = Math.min(
        endpointWidth * 0.92,
        Math.max(CURVE_CONNECT_MIN_WIDTH, endpointWidth * CURVE_CONNECT_MIN_WIDTH_RATIO),
    );
    const minCurveWidth = Math.min(
        ...leftCurveSamples.map((leftPoint, index) => leftPoint.distanceTo(rightCurveSamples[index])),
    );
    if (minCurveWidth < minAllowedWidth) {
        return rejectCurveConnectCandidate(
            `弯道最窄处只有 ${formatMeters(minCurveWidth)}，低于稳定通行宽度 ${formatMeters(minAllowedWidth)}。`,
            averageDistance,
            diagnostics.concat(`最小宽度：${formatMeters(minCurveWidth)}`),
        );
    }

    const centerSamples = leftCurveSamples.map((leftPoint, index) => midpoint(leftPoint, rightCurveSamples[index]));
    const minRadius = getPolylineMinRadius(centerSamples);
    if (minRadius < CURVE_CONNECT_REJECT_RADIUS) {
        return rejectCurveConnectCandidate(
            `弯道半径只有 ${formatMeters(minRadius)}，低于 ${formatMeters(CURVE_CONNECT_REJECT_RADIUS)} 的硬性安全阈值。`,
            averageDistance,
            diagnostics.concat(`最小半径：${formatMeters(minRadius)}`),
        );
    }

    const headingPenalty = sourceChordAngle + targetChordAngle + headingChange * 0.35;
    const targetCurveWidth = Math.min(
        endpointWidth,
        Math.max(minAllowedWidth, endpointWidth * CURVE_CONNECT_WIDTH_TARGET_RATIO),
    );
    const widthPenalty = Math.max(0, targetCurveWidth - minCurveWidth) * 8;
    const sideOrderPenalty = sideOrderMismatch ? CURVE_CONNECT_SIDE_ORDER_PENALTY : 0;
    const radiusPenalty = minRadius === Infinity ? 0 : Math.max(0, CURVE_CONNECT_PREFERRED_RADIUS - minRadius) * 3;
    return {
        pointIds: [item[1].id, item[2].id, item[5].id, item[6].id],
        controlsPosition,
        score: averageDistance + headingPenalty * 3 + radiusPenalty + widthPenalty + sideOrderPenalty,
        diagnostics: diagnostics
            .concat(
                `最小半径：${formatMeters(minRadius)}`,
                `最小宽度：${formatMeters(minCurveWidth)}`,
                `目标宽度：${formatMeters(targetCurveWidth)}`,
            )
            .concat(sideOrderMismatch ? ['左右边界方向不完全标准，已按双向/反向候选降级评分处理。'] : []),
    };
}

/**
 * 获取连接lane的四个点以及，lane连接的顺序，即谁的终点连接谁的起点
 * 返回{
 *  connectLanes: [lane2,lane1]
 * }
 */
export function getStraightConnectInfo(lane1: Lane, lane2: Lane) {
    if (!lane1 || !lane2) {
        return [];
    }
    let pointIds: string[] = [];
    const state = useManagerStore.getState().mapState;
    const { points } = state;

    // 分别获取两个lane的起点和终点,一共8个点
    const [lane1LeftFirst, lane1RightFirst] = getLaneStartPointIds(lane1);
    const [lane1LeftEnd, lane1RightEnd] = getLaneEndPointIds(lane1);
    const [lane2LeftFirst, lane2RightFirst] = getLaneStartPointIds(lane2);
    const [lane2LeftEnd, lane2RightEnd] = getLaneEndPointIds(lane2);
    // 需要获取到新的lane的四个点
    /**
     * 如果是单向车道，则计算lane1终点到lane2起点的距离，和lane2终点到lane1起点的距离,哪个短取哪个
     */
    let combinations: any[] = [];
    let laneDistance = Infinity;
    // 如果都不为双向，则判断第一个车道的头连第二个车道的尾，或者第一个车道的尾连第二个车道的头，去判断距离，左车道连左车道，右连右
    if (
        lane1.attr.prossibleDrivingDirection !== ProssibleDrivingDirection.RELATIVEDIRECTION &&
        lane2.attr.prossibleDrivingDirection !== ProssibleDrivingDirection.RELATIVEDIRECTION
    ) {
        combinations = [
            [lane1LeftEnd, lane2LeftFirst, lane1RightEnd, lane2RightFirst],
            [lane2LeftEnd, lane1LeftFirst, lane2RightEnd, lane1RightFirst],
        ];
    } else if (lane2.attr.prossibleDrivingDirection === ProssibleDrivingDirection.RELATIVEDIRECTION) {
        // 如果第二个车道的方向是双向，则选取第一个车道的左右车道信息去获取连接点位
        combinations = [
            [lane2LeftFirst, lane1LeftFirst, lane2RightFirst, lane1RightFirst],
            [lane2LeftEnd, lane1LeftFirst, lane2RightEnd, lane1RightFirst],
            [lane2RightFirst, lane1LeftFirst, lane2LeftFirst, lane1RightFirst],
            [lane2RightEnd, lane1LeftFirst, lane2LeftEnd, lane1RightFirst],

            [lane1LeftEnd, lane2LeftFirst, lane1RightEnd, lane2RightFirst],
            [lane1LeftEnd, lane2LeftEnd, lane1RightEnd, lane2RightEnd],
            [lane1LeftEnd, lane2RightFirst, lane1RightEnd, lane2LeftFirst],
            [lane1LeftEnd, lane2RightEnd, lane1RightEnd, lane2LeftEnd],
        ];
    } else {
        // 否则都用第二个车道的左右车道信息去获取连接点位
        combinations = [
            [lane1LeftEnd, lane2LeftFirst, lane1RightEnd, lane2RightFirst],
            [lane2LeftEnd, lane1LeftEnd, lane2RightEnd, lane1RightEnd],
            [lane1RightEnd, lane2LeftFirst, lane1LeftEnd, lane2RightFirst],
            [lane2LeftEnd, lane1RightEnd, lane2RightEnd, lane1LeftEnd],

            [lane1LeftFirst, lane2LeftFirst, lane1RightFirst, lane2RightFirst],
            [lane2LeftEnd, lane1LeftFirst, lane2RightEnd, lane1RightFirst],
            [lane1RightFirst, lane2LeftFirst, lane1LeftFirst, lane2RightFirst],
            [lane2LeftEnd, lane1RightFirst, lane2RightEnd, lane1LeftFirst],
        ];
    }
    combinations.forEach((item) => {
        const curLaneDistance =
            points[item[0]].position.distanceTo(points[item[1]].position) +
            points[item[2]].position.distanceTo(points[item[3]].position);
        if (curLaneDistance < laneDistance) {
            laneDistance = curLaneDistance;
            pointIds = item;
        }
    });
    return pointIds;
}

export function connectLane(lane1: Lane, lane2: Lane) {
    const state = useManagerStore.getState().mapState;
    const { boundarys, lanes, grouds, prossibleDrivingDirections } = state;
    const connectPointIds = getStraightConnectInfo(lane1, lane2);
    if (connectPointIds?.length === 0) {
        return;
    }
    if (connectPointIds[0] === connectPointIds[1]) {
        const { boundarys: linkBoundarys, grouds: linkGrouds } = searchPointsRelationObjects([connectPointIds[2]]);
        const actions: any = [];
        linkBoundarys.forEach((item) => {
            actions.push(new AddPointToBoundaryCommand(connectPointIds[3], item.id, false, false));
            actions.push(new RemovePointFromBoundaryCommand(connectPointIds[2], item.id));
        });
        linkGrouds.forEach((item) => {
            actions.push(new UpdateGroudCommand(item.id));
        });
        actions.push(new DeletePointCommand(connectPointIds[2]));
        useManagerStore.getState().addCommand(actions);
        PubSub.publishSync('emptyPickObjects');
        return;
    }
    if (connectPointIds[2] === connectPointIds[3]) {
        const { boundarys: linkBoundarys, grouds: linkGrouds } = searchPointsRelationObjects([connectPointIds[0]]);
        const actions: any = [];
        linkBoundarys.forEach((item) => {
            actions.push(new AddPointToBoundaryCommand(connectPointIds[1], item.id, false, false));
            actions.push(new RemovePointFromBoundaryCommand(connectPointIds[0], item.id));
        });
        linkGrouds.forEach((item) => {
            actions.push(new UpdateGroudCommand(item.id));
        });
        actions.push(new DeletePointCommand(connectPointIds[0]));
        useManagerStore.getState().addCommand(actions);
        PubSub.publishSync('emptyPickObjects');
        return;
    }
    const newLaneId = `${getElementMaxIndex(lanes) + 1}`;
    const newLeftBoundaryId = `${getElementMaxIndex(boundarys) + 1}`;
    const newRighBoundaryId = `${getElementMaxIndex(boundarys) + 2}`;
    const newGroudId = `${getElementMaxIndex(grouds) + 1}`;
    const newArrowId = `${getElementMaxIndex(prossibleDrivingDirections) + 1}`;
    const actions = [];
    const newprossibleDrivingDirection =
        lane1.attr.prossibleDrivingDirection === ProssibleDrivingDirection.RELATIVEDIRECTION &&
        lane2.attr.prossibleDrivingDirection === ProssibleDrivingDirection.RELATIVEDIRECTION
            ? ProssibleDrivingDirection.RELATIVEDIRECTION
            : ProssibleDrivingDirection.FORWARD;
    actions.push(
        new AddLaneCommand(
            newLaneId,
            newLeftBoundaryId,
            newRighBoundaryId,
            newGroudId,
            newArrowId,
            { ...lane1.attr, prossibleDrivingDirection: newprossibleDrivingDirection },
            false,
            false,
            LaneTrend.Straight,
        ),
    );
    actions.push(
        new AddBoundaryCommand(newLeftBoundaryId, ThreeElementType.LaneBoundary, BoundaryOriginType.Lane, [], [], {
            ...boundarys[lane1.leftBoundaryId].attr,
        }),
    );
    actions.push(
        new AddBoundaryCommand(newRighBoundaryId, ThreeElementType.LaneBoundary, BoundaryOriginType.Lane, [], [], {
            ...boundarys[lane1.rightBoundaryId].attr,
        }),
    );
    actions.push(new AddGroudCommand(newGroudId, ThreeElementType.LaneGroud));
    actions.push(new AddPointToBoundaryCommand(connectPointIds[0], newLeftBoundaryId, true, false));
    actions.push(new AddPointToBoundaryCommand(connectPointIds[1], newLeftBoundaryId, true, false));
    actions.push(new AddPointToBoundaryCommand(connectPointIds[2], newRighBoundaryId, true, false));
    actions.push(new AddPointToBoundaryCommand(connectPointIds[3], newRighBoundaryId, true, false));
    actions.push(new AddArrowCommand(newArrowId, ThreeElementType.LaneRelativeDirection));
    useManagerStore.getState().addCommand(actions);
    PubSub.publishSync('emptyPickObjects');
}
export function getCurveConnectInfo(lane1: Lane, lane2: Lane): CurveConnectInfo {
    const result: CurveConnectInfo = {
        pointIds: [],
        controlsPosition: [],
    };
    if (!lane1 || !lane2) {
        return result;
    }

    // 分别获取两个lane的起点和终点,一共8个点
    const [lane1LeftFirst1, lane1LeftFirst2, lane1RightFirst1, lane1RightFirst2] = searchLaneFirstPeriodPoints(
        lane1.id,
    );
    const [lane1LeftEnd1, lane1LeftEnd2, lane1RightEnd1, lane1RightEnd2] = searchLaneLastPeriodPoints(lane1.id);
    const [lane2LeftFirst1, lane2LeftFirst2, lane2RightFirst1, lane2RightFirst2] = searchLaneFirstPeriodPoints(
        lane2.id,
    );
    const [lane2LeftEnd1, lane2LeftEnd2, lane2RightEnd1, lane2RightEnd2] = searchLaneLastPeriodPoints(lane2.id);
    // 需要获取到新的lane的四个点
    /**
     * 如果都是单向车道，则计算lane1的起点和lane2的终点的距离，和lane2的起点和lane1的终点的距离,哪个短取哪个
     */
    /**
     * combinations 每一条数据一共8个数据，分别是
     * 连接车道的左边界点1、点2、连接车道的右边界点1、点2点，新车道由车道1发起、连接到车道2、车道1连接点是否是起点、车道2连接点是否是起点,是否是左连右这种交叉组合
     */
    let combinations: any[] = [];
    // 如果都不为双向，则判断第一个车道的头连第二个车道的尾，或者第一个车道的尾连第二个车道的头，去判断距离，左车道连左车道，右连右
    if (
        lane1.attr.prossibleDrivingDirection !== ProssibleDrivingDirection.RELATIVEDIRECTION &&
        lane2.attr.prossibleDrivingDirection !== ProssibleDrivingDirection.RELATIVEDIRECTION
    ) {
        combinations = [
            // 第二个车道的最后一节去连接第一个车道的第一节
            [
                lane2LeftEnd1,
                lane2LeftEnd2,
                lane1LeftFirst1,
                lane1LeftFirst2,
                lane2RightEnd1,
                lane2RightEnd2,
                lane1RightFirst1,
                lane1RightFirst2,
            ],
            // 第一个车道的最后一节去连接第二个车道的第一节
            [
                lane1LeftEnd1,
                lane1LeftEnd2,
                lane2LeftFirst1,
                lane2LeftFirst2,
                lane1RightEnd1,
                lane1RightEnd2,
                lane2RightFirst1,
                lane2RightFirst2,
            ],
        ];
    } else if (lane1.attr.prossibleDrivingDirection === ProssibleDrivingDirection.RELATIVEDIRECTION) {
        // 如果第一个是双向的，第二个随意的时候
        combinations = [
            // 第二个车道的最后一节去连接第一个车道的第一节,且左连左，右连右
            [
                lane2LeftEnd1,
                lane2LeftEnd2,
                lane1LeftFirst1,
                lane1LeftFirst2,
                lane2RightEnd1,
                lane2RightEnd2,
                lane1RightFirst1,
                lane1RightFirst2,
            ],
            // 第二个车道的最后一节去连接第一个车道的第一节,且左连右，右连左
            [
                lane2LeftEnd1,
                lane2LeftEnd2,
                lane1RightFirst1,
                lane1RightFirst2,
                lane2RightEnd1,
                lane2RightEnd2,
                lane1LeftFirst1,
                lane1LeftFirst2,
            ],
            // 第二个车道的最后一节去连接第一个车道的最后一节,且左连左，右连右
            [
                lane2LeftEnd1,
                lane2LeftEnd2,
                lane1LeftEnd2,
                lane1LeftEnd1,
                lane2RightEnd1,
                lane2RightEnd2,
                lane1RightEnd2,
                lane1RightEnd1,
            ],
            // 第二个车道的最后一节去连接第一个车道的最后一节,且左连右，右连左
            [
                lane2LeftEnd1,
                lane2LeftEnd2,
                lane1RightEnd2,
                lane1RightEnd1,
                lane2RightEnd1,
                lane2RightEnd2,
                lane1LeftEnd2,
                lane1LeftEnd1,
            ],
            // 第二个车道的第一节去连接第一个车道的第一节,且左连左，右连右,头连接头则将双向车道的点位反过来
            [
                lane1LeftFirst2,
                lane1LeftFirst1,
                lane2LeftFirst1,
                lane2LeftFirst2,
                lane1RightFirst2,
                lane1RightFirst1,
                lane2RightFirst1,
                lane2RightFirst2,
            ],
            // 第二个车道的第一节去连接第一个车道的第一节,且左连右，右连左,头连接头则将双向车道的点位反过来
            [
                lane1LeftFirst2,
                lane1LeftFirst1,
                lane2RightFirst1,
                lane2RightFirst2,
                lane1RightFirst2,
                lane1RightFirst1,
                lane2LeftFirst1,
                lane2LeftFirst2,
            ],
            // 第二个车道的第一节去连接第一个车道的最后一节,且左连左，右连右
            [
                lane1LeftEnd1,
                lane1LeftEnd2,
                lane2LeftFirst1,
                lane2LeftFirst2,
                lane1RightEnd1,
                lane1RightEnd2,
                lane2RightFirst1,
                lane2RightFirst2,
            ],
            // 第二个车道的第一节去连接第一个车道的最后一节,且左连右，右连左
            [
                lane1LeftEnd1,
                lane1LeftEnd2,
                lane2RightFirst1,
                lane2RightFirst2,
                lane1RightEnd1,
                lane1RightEnd2,
                lane2LeftFirst1,
                lane2LeftFirst2,
            ],
        ];
    } else {
        // 如果第二个是双向的，第一个随意的时候
        combinations = [
            // 第一个车道的最后一节去连接第二个车道的第一节,且左连左，右连右
            [
                lane1LeftEnd1,
                lane1LeftEnd2,
                lane2LeftFirst1,
                lane2LeftFirst2,
                lane1RightEnd1,
                lane1RightEnd2,
                lane2RightFirst1,
                lane2RightFirst2,
            ],
            // 第一个车道的最后一节去连接第二个车道的第一节,且左连右，右连左
            [
                lane1LeftEnd1,
                lane1LeftEnd2,
                lane2RightFirst1,
                lane2RightFirst2,
                lane1RightEnd1,
                lane1RightEnd2,
                lane2LeftFirst1,
                lane2LeftFirst2,
            ],
            // 第一个车道的最后一节去连接第二个车道的最后一节,且左连左，右连右
            [
                lane1LeftEnd1,
                lane1LeftEnd2,
                lane2LeftEnd2,
                lane2LeftEnd1,
                lane1RightEnd1,
                lane1RightEnd2,
                lane2RightEnd2,
                lane2RightEnd1,
            ],
            // 第一个车道的最后一节去连接第二个车道的最后一节,且左连右，右连左
            [
                lane1LeftEnd1,
                lane1LeftEnd2,
                lane2RightEnd2,
                lane2RightEnd1,
                lane1RightEnd1,
                lane1RightEnd2,
                lane2LeftEnd2,
                lane2LeftEnd1,
            ],
            // 第一个车道的第一节去连接第二个车道的第一节,且左连左，右连右,头连接头则将双向车道的点位反过来
            [
                lane2LeftFirst2,
                lane2LeftFirst1,
                lane1LeftFirst1,
                lane1LeftFirst2,
                lane2RightFirst2,
                lane2RightFirst1,
                lane1RightFirst1,
                lane1RightFirst2,
            ],
            // 第一个车道的第一节去连接第二个车道的第一节,且左连右，右连左,头连接头则将双向车道的点位反过来
            [
                lane2LeftFirst2,
                lane2LeftFirst1,
                lane1RightFirst1,
                lane1RightFirst2,
                lane2RightFirst2,
                lane2RightFirst1,
                lane1LeftFirst1,
                lane1LeftFirst2,
            ],
            // 第一个车道的第一节去连接第二个车道的最后一节,且左连左，右连右
            [
                lane2LeftEnd1,
                lane2LeftEnd2,
                lane1LeftFirst1,
                lane1LeftFirst2,
                lane2RightEnd1,
                lane2RightEnd2,
                lane1RightFirst1,
                lane1RightFirst2,
            ],
            // 第一个车道的第一节去连接第二个车道的最后一节,且左连右，右连左
            [
                lane2LeftEnd1,
                lane2LeftEnd2,
                lane1RightFirst1,
                lane1RightFirst2,
                lane2RightEnd1,
                lane2RightEnd2,
                lane1LeftFirst1,
                lane1LeftFirst2,
            ],
        ];
    }
    const evaluatedCandidates = combinations
        .map((item) => evaluateCurveConnectCandidate(item))
        .filter((item): item is CurveConnectCandidateResult => Boolean(item));
    const bestCandidate = evaluatedCandidates
        .filter(isAcceptedCurveConnectCandidate)
        .sort((left, right) => left.score - right.score)[0];
    if (!bestCandidate) {
        const bestRejection = evaluatedCandidates
            .filter((item): item is CurveConnectCandidateRejection => !isAcceptedCurveConnectCandidate(item))
            .sort((left, right) => left.score - right.score)[0];
        result.failureReason = bestRejection?.reason || '没有找到符合方向、宽度和半径要求的弯道连接。';
        result.diagnostics = bestRejection?.diagnostics || [];
        return result;
    }

    result.pointIds = bestCandidate.pointIds;
    result.controlsPosition = bestCandidate.controlsPosition;
    result.diagnostics = bestCandidate.diagnostics;
    return result;
}

export interface CurveConnectLaneResult {
    connected: boolean;
    message?: string;
    diagnostics?: string[];
}

export function curveConnectLane(lane1: Lane, lane2: Lane): CurveConnectLaneResult {
    const state = useManagerStore.getState().mapState;
    const { lanes, grouds, boundarys, prossibleDrivingDirections } = state;
    if (!lane1 || !lane2) {
        return {
            connected: false,
            message: '未找到选中的车道。',
        };
    }
    const leftBoundaryPointIds2 = searchBoundaryPointIdsByBoundaryId(lane2.leftBoundaryId);
    const rightBoundaryPointIds2 = searchBoundaryPointIdsByBoundaryId(lane2.rightBoundaryId);
    if (leftBoundaryPointIds2.length === 0 && rightBoundaryPointIds2.length === 0) {
        return {
            connected: false,
            message: '目标车道边界点不完整，无法连接。',
        };
    }

    const {
        pointIds: connectPointIds,
        controlsPosition,
        failureReason,
        diagnostics,
    } = getCurveConnectInfo(lane1, lane2);
    if (connectPointIds.length !== 4 || controlsPosition.length !== 4) {
        return {
            connected: false,
            message: failureReason || '无法生成稳定的弯道连接，请检查车道方向、端点距离，或先手动调整端点后重试。',
            diagnostics,
        };
    }

    const [leftCurveControl1, leftCurveControl2, rightCurveControl1, rightCurveControl2] = controlsPosition;
    const actions = [];
    const leftCurveId = `${getElementMaxIndex(boundarys) + 1}`;
    const rightCurveId = `${getElementMaxIndex(boundarys) + 2}`;
    const laneId = `${getElementMaxIndex(lanes) + 1}`;
    const groudId = `${getElementMaxIndex(grouds) + 1}`;
    const arrowId = `${getElementMaxIndex(prossibleDrivingDirections) + 1}`;
    const newprossibleDrivingDirection =
        lane1.attr.prossibleDrivingDirection === ProssibleDrivingDirection.RELATIVEDIRECTION &&
        lane2.attr.prossibleDrivingDirection === ProssibleDrivingDirection.RELATIVEDIRECTION
            ? ProssibleDrivingDirection.RELATIVEDIRECTION
            : ProssibleDrivingDirection.FORWARD;
    const curveLaneAttr = {
        ...lane1.attr,
        speed: CURVE_CONNECT_DEFAULT_SPEED_KPH,
        speedKph: CURVE_CONNECT_DEFAULT_SPEED_KPH,
        prossibleDrivingDirection: newprossibleDrivingDirection,
    };
    actions.push(
        new AddBoundaryCommand(
            leftCurveId,
            ThreeElementType.LaneCurveBoundary,
            BoundaryOriginType.Lane,
            [connectPointIds[0], connectPointIds[1]],
            [leftCurveControl1, leftCurveControl2],
            { type: LaneBoundaryType.WHITESOLId },
        ),
    );
    actions.push(
        new AddBoundaryCommand(
            rightCurveId,
            ThreeElementType.LaneCurveBoundary,
            BoundaryOriginType.Lane,
            [connectPointIds[2], connectPointIds[3]],
            [rightCurveControl1, rightCurveControl2],
            { type: LaneBoundaryType.WHITESOLId },
        ),
    );
    actions.push(
        new AddLaneCommand(
            laneId,
            leftCurveId,
            rightCurveId,
            groudId,
            arrowId,
            curveLaneAttr,
            false,
            false,
            LaneTrend.Curve,
        ),
    );
    actions.push(new AddGroudCommand(groudId, ThreeElementType.LaneCurveGroud));
    actions.push(new AddArrowCommand(arrowId, ThreeElementType.LaneRelativeDirection));
    useManagerStore.getState().addCommand(actions);
    PubSub.publishSync('emptyPickObjects');
    return {
        connected: true,
        diagnostics,
    };
}
