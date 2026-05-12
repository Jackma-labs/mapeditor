import { ThreeObject } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';

export function objectSearchByName(propertyName: string, value: string) {
    const scene = useManagerStore.getState().mapState.scene;
    const objects = scene.getObjectsByProperty(propertyName, value);
    return objects;
}

export function objectSearch(threeObject: ThreeObject, id: string) {
    if (!id || !threeObject) {
        return null;
    }
    const objects = objectSearchByName('name', `${threeObject}`);
    if (objects.length === 0) {
        return null;
    }
    const object = objects.find((item) => item.userData.id === id);
    return object;
}
export function contrlPointSearch(threeObject: ThreeObject, curveId: string, isFirst: boolean) {
    const contrlPoints = objectSearchByName('name', `${threeObject}`);
    let result = null;
    if (!contrlPoints || contrlPoints.length === 0) {
        return result;
    }
    for (let i = 0; i < contrlPoints.length; i += 1) {
        if (contrlPoints[i].userData.curveId === curveId && contrlPoints[i].userData.isFirst === isFirst) {
            result = contrlPoints[i];
            break;
        }
    }
    return result;
}
