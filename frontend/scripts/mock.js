const WebSocketServer = require('ws').WebSocketServer;

const wss = new WebSocketServer({ port: 8888, path: '/websocket' });

/**
 * WebSocket 服务端的连接事件处理函数的简写形式。
 *
 * @param {WebSocketServer} wss - WebSocket 服务端对象。
 */
wss.on('connection', function connection(ws) {
    ws.on('message', function message(data) {
        data = JSON.parse(data);
        switch (data.type) {
            case 'GetBaseMapDir':
                ws.send(JSON.stringify({
                    'type': 'GetBaseMapDir',
                    'action': 'response',
                    'data': {
                        'info': {
                            'code': 0,
                            'data': [
                                '20290908172807',
                                '20290909175406',
                                '20240304130302',
                            ],
                            'message': 'success',
                        },
                        'requestId': data.data.requestId
                    }
                }));
                break;
            case 'GetMapFileList':
                ws.send(JSON.stringify({
                    'type': 'GetMapFileList',
                    'action': 'response',
                    'data': {
                        'info': {
                            'code': 0,
                            'data': {
                                'map_list': [
                                    '20290908172807',
                                    '20290909175406',
                                    '20240304130302',
                                ]
                            },
                            'message': 'success',
                        },
                        'requestId': data.data.requestId
                    }
                }));
                break;
            case 'SaveMapFile':
                ws.send(JSON.stringify({
                    'type': 'SaveMapFile',
                    'action': 'response',
                    'data': {
                        'info': {
                            'code': 0,
                            'message': 'success',
                        },
                        'requestId': data.data.requestId,
                        'source': 'dreamview',
                        'targetType': 'module'
                    }
                }));
                break;
            case 'ReleaseMapFile':
                ws.send(JSON.stringify({
                    'type': 'ReleaseMapFile',
                    'action': 'response',
                    'data': {
                        'info': {
                            'code': 0,
                            'message': 'success',
                        },
                        'requestId': data.data.requestId,
                        'source': 'dreamview',
                        'targetType': 'module'
                    }
                }));
                break;
            case 'OpenMapFile':
                ws.send(JSON.stringify({
                    'type': 'OpenMapFile',
                    'action': 'response',
                    'data': {
                        'info': {
                            'code': 0,
                            'message': 'success',
                            'data': {
                                'map': {
                                    point: [], boundary: [], lane: [], junction: [], crosswalk: [], speedBump: []
                                }
                            },
                        },
                        'requestId': data.data.requestId,
                        'source': 'dreamview',
                        'targetType': 'module'
                    }
                }));
                break;
            default:
                ws.send('error');
        }
    });

    ws.send('{}');
});
