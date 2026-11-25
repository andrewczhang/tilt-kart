type Anchor = [x: number, y: number, z: number];
export type BoostPad = { s: number; lane: number };
export type TrackSpec = {
  name: string;
  width: number;
  bank: number;
  anchors: Anchor[];
  checkpoints: [number, number, number];
  pads: BoostPad[];
  sky: string;
  fog: string;
  fogDensity: number;
  sun: string;
  ambient: string;
  ground: string;
  road: string;
  wall: string;
  curb: string;
  trim: string;
  pad: string;
  sign: [background: string, ink: string];
};

export const TRACKS = {
  'red-basin': {
    name: 'Red Basin', width: 15, bank: 1,
    anchors: [[-35,1,100],[-83,1,92],[-124,3,59],[-125,7,9],[-93,9,-25],[-48,6,-25],[-20,3,-47],[-32,2,-86],[0,4,-122],[63,11,-129],[111,10,-96],[115,6,-48],[80,6,-17],[57,4,5],[74,2,39],[60,1,84],[13,1,101]],
    checkpoints: [.25,.5,.75], pads: [{s:.18,lane:2.9},{s:.55,lane:-3},{s:.79,lane:2.9}],
    sky: '#a3d6d5', fog: '#aed9ce', fogDensity: .0049, sun: '#fff0d4', ambient: '#fff3d2',
    ground: '#c98457', road: '#424c53', wall: '#864934', curb: '#ef5c3b', trim: '#fff0d8', pad: '#25949a',
    sign: ['#ef5437','#fff2d0']
  },
  frostline: {
    name: 'Frostline Pass', width: 16.8, bank: .8,
    anchors: [[-48,3,105],[-104,7,94],[-131,14,58],[-122,24,2],[-92,35,-60],[-48,39,-106],[17,32,-111],[85,23,-99],[128,14,-64],[123,7,-8],[76,4,10],[27,3,38],[24,4,77],[0,3,108]],
    checkpoints: [.24,.52,.76], pads: [{s:.20,lane:-3.6},{s:.48,lane:3.1},{s:.68,lane:0},{s:.91,lane:3.8}],
    sky: '#b4d8ee', fog: '#d6e6ee', fogDensity: .0042, sun: '#f1f6ff', ambient: '#d9efff',
    ground: '#d9e8f1', road: '#556b7b', wall: '#748ca1', curb: '#e95d3f', trim: '#f8ffff', pad: '#1b8bab',
    sign: ['#edfaff','#34556f']
  },
  switchyard: {
    name: 'Midnight Switchyard', width: 17.7, bank: .54,
    anchors: [[-60,2,112],[-112,2,103],[-137,2,66],[-137,2,-20],[-112,6,-53],[-58,10,-54],[-18,11,-76],[10,13,-118],[58,14,-135],[109,12,-108],[120,8,-51],[97,5,0],[47,3,34],[58,2,74],[25,2,112]],
    checkpoints: [.23,.48,.78], pads: [{s:.12,lane:3.5},{s:.32,lane:-4},{s:.63,lane:3.4},{s:.88,lane:-3.3}],
    sky: '#192a49', fog: '#243952', fogDensity: .0037, sun: '#9cbefa', ambient: '#a9d6f4',
    ground: '#35415d', road: '#333e58', wall: '#374256', curb: '#ec9c3c', trim: '#a4f4ec', pad: '#2dffcb',
    sign: ['#172a40','#9afde3']
  },
  saltwater: {
    name: 'Saltwater Keys', width: 14.2, bank: .89,
    anchors: [[-50,1.2,87],[-99,1.6,77],[-135,2.4,39],[-132,3,-4],[-102,2,-33],[-48,2,-34],[2,4,-61],[18,6,-109],[54,10,-135],[96,8,-110],[119,5,-61],[114,3,-13],[77,2,15],[29,2,23],[6,2.4,56],[0,1.2,87]],
    checkpoints: [.26,.55,.79], pads: [{s:.15,lane:2.7},{s:.41,lane:-2.7},{s:.64,lane:3.1},{s:.84,lane:0}],
    sky: '#a9e9ed', fog: '#b1e9ea', fogDensity: .0044, sun: '#fff0bf', ambient: '#dcfff1',
    ground: '#37b8b4', road: '#53616a', wall: '#546f70', curb: '#ff9b40', trim: '#fff6d2', pad: '#21c697',
    sign: ['#14877d','#fff5c3']
  },
  cinder: {
    name: 'Cinder Crown', width: 15.6, bank: 1.15,
    anchors: [[-27,6,116],[-85,7,109],[-128,10,72],[-141,16,11],[-125,22,-50],[-82,30,-91],[-32,35,-124],[26,29,-119],[68,24,-82],[94,22,-41],[147,17,-30],[165,11,17],[134,6,57],[76,5,60],[38,5,103]],
    checkpoints: [.28,.51,.73], pads: [{s:.17,lane:-3.7},{s:.46,lane:3.2},{s:.60,lane:-3.3},{s:.86,lane:3.5}],
    sky: '#bd766c', fog: '#a96861', fogDensity: .0053, sun: '#ffbd81', ambient: '#efd7ca',
    ground: '#51454b', road: '#4b464b', wall: '#69464b', curb: '#ff6533', trim: '#ffe09f', pad: '#fd963b',
    sign: ['#372d3b','#ffa85f']
  },
  cedar: {
    name: 'Cedar Run', width: 13.4, bank: .98,
    anchors: [[-48,2,104],[-106,3,86],[-131,6,49],[-112,11,6],[-61,15,-18],[-59,19,-65],[-84,21,-107],[-57,16,-142],[-4,10,-138],[52,8,-115],[115,7,-96],[137,7,-48],[118,6,-1],[78,3,30],[49,2,79],[8,2,107]],
    checkpoints: [.22,.51,.77], pads: [{s:.22,lane:2.7},{s:.48,lane:0},{s:.67,lane:-2.9},{s:.89,lane:2.8}],
    sky: '#bed9aa', fog: '#aec7a0', fogDensity: .0056, sun: '#fff2ba', ambient: '#e9edc7',
    ground: '#6e8d55', road: '#565d57', wall: '#6d4b39', curb: '#d75a36', trim: '#efe8ad', pad: '#72c9a3',
    sign: ['#375f43','#fff1b0']
  },
  mesa: {
    name: 'Twin Mesa', width: 18.1, bank: 1.25,
    anchors: [[-41,3,116],[-92,4,114],[-151,10,81],[-157,20,24],[-129,28,-21],[-78,29,-51],[-46,24,-91],[-8,17,-131],[56,12,-143],[122,10,-120],[154,8,-67],[140,6,-8],[93,5,13],[55,5,40],[61,3,90],[23,3,117]],
    checkpoints: [.22,.49,.75], pads: [{s:.12,lane:-4.5},{s:.37,lane:3.4},{s:.64,lane:-4.2},{s:.92,lane:4.1}],
    sky: '#efbe91', fog: '#e9aa82', fogDensity: .0041, sun: '#fff0b1', ambient: '#ffe5be',
    ground: '#ae674d', road: '#5d4e4b', wall: '#865344', curb: '#c55132', trim: '#ffe8b1', pad: '#6fc7a9',
    sign: ['#80392a','#ffe0a3']
  },
  arena: {
    name: 'Apex Arena', width: 18.8, bank: .72,
    anchors: [[-64,3,73],[-110,3,79],[-150,4,44],[-155,5,-9],[-121,6,-62],[-70,6,-68],[-34,6,-42],[0,5,0],[42,6,47],[91,8,78],[139,12,64],[158,17,16],[142,22,-37],[104,26,-68],[57,27,-56],[0,27,0],[-34,15,48]],
    checkpoints: [.25,.53,.78], pads: [{s:.18,lane:3.8},{s:.40,lane:-3.2},{s:.69,lane:4.1},{s:.90,lane:-4}],
    sky: '#aecddd', fog: '#bdccd6', fogDensity: .0037, sun: '#fff1d0', ambient: '#e6f1ff',
    ground: '#78988b', road: '#4e5466', wall: '#46546c', curb: '#da4055', trim: '#fff5dc', pad: '#39cbcc',
    sign: ['#c83150','#fff7d6']
  }
} satisfies Record<string, TrackSpec>;

export type TrackId = keyof typeof TRACKS;
export const DEFAULT_TRACK: TrackId = 'red-basin';
export const TRACK_IDS = Object.keys(TRACKS) as TrackId[];
export const isTrackId = (value: string): value is TrackId => Object.prototype.hasOwnProperty.call(TRACKS, value);
