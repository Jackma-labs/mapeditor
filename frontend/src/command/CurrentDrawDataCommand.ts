import { MapElementType } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';

export class SetCurrentDrawDataCommand {
    private currentDrawElementId: string;

    private drawElementType: MapElementType;

    private originCurrentDrawElementId: string;

    private originDrawElementType: MapElementType;

    constructor(currentDrawElementId: string, drawElementType: MapElementType) {
        this.currentDrawElementId = currentDrawElementId;
        this.drawElementType = drawElementType;
    }

    execute() {
        const { mapState, setMapState } = useManagerStore.getState();

        this.originCurrentDrawElementId = mapState.currentDrawData.currentDrawingElementId;
        this.originDrawElementType = mapState.currentDrawData.drawElementType;

        mapState.currentDrawData = {
            ...mapState.currentDrawData,
            currentDrawingElementId: this.currentDrawElementId,
            drawElementType: this.drawElementType,
        };

        setMapState(mapState);
    }

    undo() {
        const { mapState, setMapState } = useManagerStore.getState();

        mapState.currentDrawData = {
            ...mapState.currentDrawData,
            currentDrawingElementId: this.originCurrentDrawElementId,
            drawElementType: this.originDrawElementType,
        };

        setMapState(mapState);
    }
}
