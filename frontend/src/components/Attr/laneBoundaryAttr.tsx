import React, { useEffect, useState } from 'react';
import { Select } from 'antd';
import { Lane, LaneBoundaryType } from 'src/interface/laneInterFace';
import { useManagerStore } from 'src/store';
import { ThreeElementType } from 'src/interface/commonInterFace';
import { ChangeBoundaryTypeCommand } from 'src/command/BoundaryCommand';
import { searchBoundaryByBoundaryId } from 'src/utils/search/boundarySearch';
import { BoundaryType } from 'src/interface/basicElementInterFace';
import { searchLanesFromBoundaryId } from 'src/utils/search/laneSearch';
import { unionBy } from 'lodash';

interface AttrData {
    id: string;
    boundaryType: LaneBoundaryType;
    relativeLaneBoundaryIds: string[];
    relativeRoadBoundaryIds: string[];
    relativeLaneBoundaryInfo: string;
    type: BoundaryType;
}
/**
 * 该组件只有在选中线的时候才会出现，绘制线的时候不会出现，所以要想获取选中的线元素，则只需要通过currentPickElement即可
 */
export default function Index() {
    const { mapState } = useManagerStore.getState();
    const [attrData, setAttrData] = useState<AttrData>(null);
    const [visible, setVisible] = useState(false);

    const changeLaneBoundary = (boundaryType: LaneBoundaryType) => {
        setAttrData({
            ...attrData,
            boundaryType,
        });
        const { id, type } = mapState.currentPickElement[0] || {};
        if (!id || !type || (type !== ThreeElementType.LaneBoundary && type !== ThreeElementType.LaneCurveBoundary)) {
            return;
        }
        useManagerStore.getState().addCommand([new ChangeBoundaryTypeCommand(id)]);
        PubSub.publish('render');
    };
    useEffect(() => {
        const { currentDrawData, currentPickElement } = mapState;
        const { drawElementType, currentDrawingElementId } = currentDrawData;
        const type = currentPickElement[0]?.type;
        if (
            currentPickElement &&
            currentPickElement.length &&
            (type === ThreeElementType.LaneBoundary ||
                type === ThreeElementType.LaneCurveBoundary ||
                type === ThreeElementType.RoadBoundary)
        ) {
            setVisible(true);
        } else {
            setVisible(false);
            return;
        }
        // 如果是绘制阶段，则不展示右侧的线的属性
        if (currentDrawingElementId || drawElementType) {
            setAttrData(null);
        } else if (currentPickElement[0]) {
            const boundary = searchBoundaryByBoundaryId(currentPickElement[0].id);
            let relativeLaneBoundaryInfo = '';
            if (boundary.type === ThreeElementType.RoadBoundary) {
                const relativeLaneBoundaryIds = boundary.relativeLaneBoundaryIds;
                let relativeLanes: Lane[] = [];
                relativeLaneBoundaryIds.forEach((id) => {
                    const lane = searchLanesFromBoundaryId(id);
                    relativeLanes.push(...lane);
                });
                relativeLanes = unionBy(relativeLanes, 'id');
                relativeLanes.forEach((lane) => {
                    if (relativeLaneBoundaryIds.includes(lane.leftBoundaryId)) {
                        relativeLaneBoundaryInfo += `${lane.id}左，`;
                    }
                    if (relativeLaneBoundaryIds.includes(lane.rightBoundaryId)) {
                        relativeLaneBoundaryInfo += `${lane.id}右，`;
                    }
                });
            }
            setAttrData({
                id: boundary.id,
                type: boundary.type,
                relativeLaneBoundaryIds: boundary.relativeLaneBoundaryIds,
                relativeRoadBoundaryIds: boundary.relativeRoadBoundaryIds,
                boundaryType: boundary?.attr?.type,
                relativeLaneBoundaryInfo,
            });
        } else {
            setAttrData(null);
        }
    }, [mapState.currentDrawData, mapState.currentPickElement, mapState.currentPickElement.length]);
    return (
        visible && (
            <>
                <div className="title">
                    <div className="text">属性</div>
                </div>

                <div className="attr-item">
                    <span className="text">
                        边界ID：
                        {attrData?.id}
                    </span>
                </div>
                {attrData?.type !== ThreeElementType.RoadBoundary && (
                    <div className="attr-item">
                        <span className="text">车道边界：</span>
                        <Select
                            value={attrData?.boundaryType}
                            style={{ width: 180 }}
                            onChange={(boundaryType) => changeLaneBoundary(boundaryType)}
                            popupClassName="my-select-popup"
                            options={[
                                { value: LaneBoundaryType.WHITESOLId, label: '实线' },
                                { value: LaneBoundaryType.WHITEDOTTED, label: '虚线' },
                            ]}
                        />
                    </div>
                )}
                {attrData?.type === ThreeElementType.RoadBoundary && attrData?.relativeLaneBoundaryInfo && (
                    <div className="attr-item">
                        <span className="text">
                            关联车道编号：
                            {attrData?.relativeLaneBoundaryInfo}
                        </span>
                    </div>
                )}
                {attrData.relativeRoadBoundaryIds?.length !== 0 && (
                    <div className="attr-item">
                        <span className="text">
                            关联路沿编号：
                            {attrData?.relativeRoadBoundaryIds.join(',')}
                        </span>
                    </div>
                )}
            </>
        )
    );
}
