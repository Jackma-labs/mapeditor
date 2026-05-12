// 区域类型 区域相关的需求文档地址
export enum AreaType {
    // 可行驶区域
    Driveable = 1,
    // 不可行驶区域
    UnDriveable,
    // 自定义
    Custom,
}
export interface Area {
    id: string;
    type: AreaType;
    boundaryId: string;
    groudId: string | null;
    name?: string;
}
export interface AreaAttr {
    id: string;
    name: string;
    type: AreaType;
}
