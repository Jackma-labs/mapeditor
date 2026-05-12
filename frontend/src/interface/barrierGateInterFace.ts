export enum BarrierGateType {
    Rod = 1,
    Fence,
    Advertising,
    Telescopic,
    Other,
}
export interface BarrierGate {
    id: string;
    type: BarrierGateType;
    stopLineId: string;
    height: number;
    width: number;
    length: number;
    boundaryId: string;
    groudId: string;
}

export interface BarrierGateAttr {
    id: string;
    type: BarrierGateType;
    width: number;
    length: number;
    height: number;
}
