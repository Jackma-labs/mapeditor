import EventEmitter from 'events';

export default class EventSystem {
    private readonly eventEmitterClick: EventEmitter;

    private readonly eventEmitterDragStart: EventEmitter;

    private readonly eventEmitterDragEnd: EventEmitter;

    constructor() {
        this.eventEmitterClick = new EventEmitter();
        this.eventEmitterDragStart = new EventEmitter();
        this.eventEmitterDragEnd = new EventEmitter();
    }

    get EventEmitterClick(): EventEmitter {
        return this.eventEmitterClick;
    }

    get EventEmitterDragStart(): EventEmitter {
        return this.eventEmitterDragStart;
    }

    get EventEmitterDragEnd(): EventEmitter {
        return this.eventEmitterDragEnd;
    }
}
