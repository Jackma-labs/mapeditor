import { EditorLayerConfig, EditorLayerMap } from 'src/interface/layerInterface';

export const editorLayerConfigs: EditorLayerConfig[] = [
    {
        id: 'reference',
        label: '参考底图',
        description: '点云、瓦片和采图底图',
    },
    {
        id: 'lane',
        label: '车道网络',
        description: '车道面、中心方向、车道边界和端点',
    },
    {
        id: 'boundary',
        label: '道路边界',
        description: '道路外沿和道路边界点',
    },
    {
        id: 'junction',
        label: '路口连接',
        description: '路口、人行横道、减速带和道闸',
    },
    {
        id: 'traffic',
        label: '交通控制',
        description: '停止线、信号灯和标志牌',
    },
    {
        id: 'area',
        label: '区域车位',
        description: '区域面、禁行区和停车位',
    },
    {
        id: 'quality',
        label: '质检问题',
        description: '质量检查定位和高亮覆盖层',
    },
];

export function createDefaultEditorLayers(): EditorLayerMap {
    const layers = {} as EditorLayerMap;
    editorLayerConfigs.forEach((layer) => {
        layers[layer.id] = {
            visible: true,
            locked: false,
        };
    });
    return layers;
}

export function mergeEditorLayers(layers?: Partial<EditorLayerMap> | null): EditorLayerMap {
    const defaults = createDefaultEditorLayers();
    if (!layers) {
        return defaults;
    }
    editorLayerConfigs.forEach((config) => {
        defaults[config.id] = {
            ...defaults[config.id],
            ...layers[config.id],
        };
    });
    return defaults;
}
