import { Boundary } from './laneInterFace';

export enum JunctionType {
    CROSS = 2,
    T,
}
export interface JunctionAttr {
    type: JunctionType;
}

export interface JunctionBoundary extends Boundary {
    mesh: THREE.Line;
}
export interface Junction {
    id: string;
    attr: JunctionAttr;
    boundaryId: string;
    groudId: string | null;
}
