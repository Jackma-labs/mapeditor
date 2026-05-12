import { OperationType, PickElementInfo } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';

export class SetOperationTypeCommand {
    private operationType: OperationType;

    private originOperationType: OperationType;

    private originCurrentpickElement: PickElementInfo[];

    constructor(operationType: OperationType) {
        this.operationType = operationType;
    }

    execute() {
        const { mapState, setMapState } = useManagerStore.getState();

        this.originOperationType = mapState.operationType;
        this.originCurrentpickElement = [...mapState.currentPickElement];

        mapState.operationType = this.operationType;
        setMapState(mapState);
    }

    undo() {
        const { mapState, setMapState } = useManagerStore.getState();
        mapState.currentPickElement = [...this.originCurrentpickElement];
        mapState.operationType = this.originOperationType;
        setMapState(mapState);
    }
}
