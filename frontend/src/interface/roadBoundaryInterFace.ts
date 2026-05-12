export interface RoadBoundary {
    id: string;
    pointIds: string[];
    laneBoundaryIds: string[];
    controlsPosition?: THREE.Vector3[];
}
