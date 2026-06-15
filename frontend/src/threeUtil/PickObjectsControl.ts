import { elementInteraction } from 'src/handle/interactive/Interaction';
import { InterActiveType, PickElementInfo, ThreeElementType, ThreeObject } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import { searchBoundaryByBoundaryId } from 'src/utils/search/boundarySearch';
import { objectSearch } from 'src/utils/search/objectSearch';

interface PickObject {
    id: string;
    type: ThreeElementType;
    threeObject: ThreeObject;
    object: THREE.Object3D;
}
export class PickObjectsControl {
    private pickObjects: PickObject[];

    private subscriptionToken: string | null = null;

    constructor() {
        this.pickObjects = [];
        this.initEvent();
    }

    initEvent() {
        this.subscriptionToken = PubSub.subscribe('emptyPickObjects', () => {
            this.emptyPickObjects();
        });
    }

    // 解绑订阅，配合编辑器卸载使用，避免重复挂载导致回调叠加。
    dispose() {
        if (this.subscriptionToken) {
            PubSub.unsubscribe(this.subscriptionToken);
            this.subscriptionToken = null;
        }
    }

    // 更新当前选中元素
    updatePickObjects() {
        const { mapState, setMapState } = useManagerStore.getState();
        const { currentPickElement } = mapState;

        // 针对已经移除的three对象，应该移除当前选中元素
        let needRemove = false;
        for (let i = 0; i < currentPickElement.length; i += 1) {
            const { id, threeObject } = currentPickElement[i];
            const object = objectSearch(threeObject, id);
            if (!object) {
                currentPickElement.splice(i, 1);
                i -= 1;
                needRemove = true;
            }
        }
        if (needRemove) {
            console.warn('currentPickElement数据异常，已将异常数据移除');
            setMapState({ ...mapState, currentPickElement, needRender: true });
        }

        const newPick: PickElementInfo[] = [];
        const deletePick: PickObject[] = [];
        this.pickObjects.forEach((item) => {
            const find = currentPickElement.find(({ id, type }) => item.id === id && item.type === type);
            if (!find) {
                deletePick.push({ ...item });
            }
        });
        currentPickElement.forEach((item) => {
            const find = this.pickObjects.find(({ id, type }) => item.id === id && item.type === type);
            if (!find) {
                newPick.push({ ...item });
            }
        });
        newPick.forEach((pickItem) => {
            const { id, threeObject } = pickItem;
            const object = objectSearch(threeObject, id);
            if (object) {
                elementInteraction(object, InterActiveType.Active);
                this.pickObjects = [...this.pickObjects, { ...pickItem, object }];
                if (object && pickItem.type === ThreeElementType.LaneCurveBoundary) {
                    PubSub.publish('enableModify', pickItem.id);
                }
                if (object && pickItem.type === ThreeElementType.RoadBoundary) {
                    const boundary = searchBoundaryByBoundaryId(pickItem.id);
                    if (boundary.controlsPosition?.length === 2) {
                        PubSub.publish('enableModify', pickItem.id);
                    }
                }
            }
        });

        deletePick.forEach((item) => {
            if (item.type === ThreeElementType.LaneCurveBoundary || item.type === ThreeElementType.RoadBoundary) {
                PubSub.publish('disableModify', item.id);
            }
            elementInteraction(item.object, InterActiveType.Default);
            const deletePickObjectIndex = this.pickObjects.findIndex(
                ({ id, type }) => item.id === id && item.type === type,
            );
            if (deletePickObjectIndex !== -1) {
                this.pickObjects.splice(deletePickObjectIndex, 1);
            }
        });
    }

    // 清除选中项
    emptyPickObjects() {
        const { mapState, setMapState } = useManagerStore.getState();
        mapState.currentPickElement = [];
        this.pickObjects.forEach((item) => elementInteraction(item.object, InterActiveType.Default));
        this.pickObjects = [];
        setMapState(mapState);
    }
}
