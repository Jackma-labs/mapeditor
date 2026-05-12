import Stats from 'stats.js';

// 0: fps, 1: ms, 2: mb, 3+: custom
const stats = new Stats();
stats.showPanel(0);
stats.showPanel(1);
stats.showPanel(2);
document.body.appendChild(stats.dom);

export default stats;
