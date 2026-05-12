import React, { useEffect, useState } from 'react';
import './index.less';
import noDataImg from 'src/assets/images/no_attr.png';
import { MapElementType, ThreeElementType } from 'src/interface/commonInterFace';
import { useManagerStore } from 'src/store';
import { searchCrosswalkByGroudId } from 'src/utils/search/crosswalkSearch';
import { searchSpeedBumpFromGroudId } from 'src/utils/search/speedBumpSearch';
import { searchStopLineFromBoundaryId } from 'src/utils/search/stopLineSearch';
import TrafficLightAttr from './trafficLightAttr';
import ParkingSpaceAttr from './parkingSpaceAttr';
import BoundaryAttr from './laneBoundaryAttr';
import JunctionAttr from './JunctionAttr';
import AreaAttr from './areaAttr';
import LaneAttr from './LaneAttr';
import SignAttr from './signAttr';
import BarrierGateAttr from './barrierGateAttr';

export default function Index() {
    const [viewstate] = useManagerStore((state) => [state.mapState, state.setMapState]);
    const [isCrossWalkRelated, setIsCrossWalkRelated] = useState(false);
    const [isSpeedBumpRelated, setIsSpeedBumpRelated] = useState(false);
    const [isStopLineRelated, setIsStopLineRelated] = useState(false);
    const [elementId, setElementId] = useState(null);

    useEffect(() => {
        const { currentDrawData, currentPickElement } = viewstate;
        const { currentDrawingElementId, drawElementType } = currentDrawData;

        if (!currentDrawData.drawElementType && currentPickElement?.length === 0) {
            setIsCrossWalkRelated(false);
            setIsSpeedBumpRelated(false);
            setIsStopLineRelated(false);
            setElementId(null);
            return;
        }
        if (drawElementType) {
            setIsCrossWalkRelated(drawElementType === MapElementType.Crosswalk);
            setIsSpeedBumpRelated(drawElementType === MapElementType.SpeedBump);
            setIsStopLineRelated(drawElementType === MapElementType.StopLine);
            setElementId(currentDrawingElementId);
            return;
        }
        if (currentPickElement?.length) {
            const { type, id } = currentPickElement[0] || {};
            setIsCrossWalkRelated(type === ThreeElementType.CrosswalkGroud);
            setIsSpeedBumpRelated(type === ThreeElementType.SpeedBumpGroud);
            setIsStopLineRelated(type === ThreeElementType.StopLineBoundary);
            if (type === ThreeElementType.CrosswalkGroud) {
                const linkCrosswalk = searchCrosswalkByGroudId(id);
                setElementId(linkCrosswalk?.id);
            } else if (type === ThreeElementType.SpeedBumpGroud) {
                const linkSpeedBump = searchSpeedBumpFromGroudId(id);
                setElementId(linkSpeedBump?.id);
            } else if (type === ThreeElementType.StopLineBoundary) {
                const linkStopLine = searchStopLineFromBoundaryId(id);
                setElementId(linkStopLine?.id);
            } else {
                setElementId(null);
            }
        }
    }, [viewstate.currentDrawData, viewstate.currentPickElement, viewstate.currentPickElement.length]);

    return (
        <div id="attr-container">
            {!viewstate.currentPickElement?.length && !viewstate.currentDrawData.drawElementType && (
                <>
                    <img src={noDataImg} alt="" className="no-data-img" />
                    <div className="no-data-txt">未选中内容</div>
                </>
            )}
            <LaneAttr />
            <BoundaryAttr />
            <JunctionAttr />
            <AreaAttr />
            <SignAttr />
            <BarrierGateAttr />
            {(isSpeedBumpRelated || isStopLineRelated || isCrossWalkRelated) && (
                <>
                    <div className="title">
                        <div className="text">属性</div>
                    </div>
                    <div className="type">
                        <span className="line" />
                        {isSpeedBumpRelated && <span className="text">{`SpeedBump ${elementId || ''}`}</span>}
                        {isStopLineRelated && <span className="text">{`StopLine ${elementId || ''}`}</span>}
                        {isCrossWalkRelated && <span className="text">{`Crosswalk ${elementId || ''}`}</span>}
                    </div>
                </>
            )}
            <TrafficLightAttr />
            <ParkingSpaceAttr />
        </div>
    );
}
