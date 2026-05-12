export enum TrafficSubSignalType {
    UNKNOWN = 1,
    CIRCLE,
    ARROW_LEFT,
    ARROW_FORWARD,
    ARROW_RIGHT,
    ARROW_U_TURN = 8,
}
export enum Type {
    UNKNOWN = 1,
    MIX_2_HORIZONTAL,
    MIX_2_VERTICAL,
    MIX_3_HORIZONTAL,
    MIX_3_VERTICAL,
    SINGLE,
}
export interface TrafficSubSignal {
    id: string;
    type: TrafficSubSignalType;
}
export interface TrafficSignal {
    id: string;
    stopLineId: string;
    heading: number;
    height: number;
    type: Type;
    center: THREE.Vector3;
    subSignals: TrafficSubSignal[];
}
