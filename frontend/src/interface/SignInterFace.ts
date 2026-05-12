export enum SignType {
    YieldSign = 1,
    StopSign,
}

export interface Sign {
    id: string;
    type: SignType;
    stopLineId: string;
}
