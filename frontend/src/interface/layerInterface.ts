export type EditorLayerId = 'reference' | 'lane' | 'boundary' | 'junction' | 'traffic' | 'area' | 'quality';

export interface EditorLayerState {
    visible: boolean;
    locked: boolean;
}

export type EditorLayerMap = Record<EditorLayerId, EditorLayerState>;

export interface EditorLayerConfig {
    id: EditorLayerId;
    label: string;
    description: string;
}
