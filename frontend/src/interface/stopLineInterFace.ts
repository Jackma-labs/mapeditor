export enum StopLineOrigin {
    StopLine,
    TrafficLight,
    Sign,
    BarrierGate,
}
export interface StopLine {
    id: string;
    boundaryId: string;
    origin: StopLineOrigin;
}
