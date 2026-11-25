type Anchor = [x: number, y: number, z: number];
export type BoostPad = { s: number; lane: number };
export type Section = { start: number; end: number };
export type Surface = Section & { grip: number; color: string; edge?: true };
export type Branch = Section & { side: -1 | 1; spread: number; width: number; color: string; name: string };
export type Jump = Section & { ramp: number; rise: number; arc: number };
export type Feature = Section & { kind: 'tunnel' | 'logs' | 'truss' | 'bowl' | 'pit' | 'gondola' | 'mesa' | 'pier'; label: string };
export type TrackSpec = {
  name: string;
  layoutVersion: number;
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
  branch?: Branch;
  jumps?: readonly Jump[];
  surfaces?: readonly Surface[];
  feature: Feature;
  profile?: readonly (Section & { width?: number; bank?: number })[];
};

export const TRACKS = {
  'red-basin': {
    name: 'Red Basin', layoutVersion: 2, width: 15, bank: 1,
    anchors: [[-35,3,100],[-88,4,98],[-133,12,64],[-139,22,8],[-109,29,-42],[-58,26,-45],[-25,17,-66],[-19,10,-115],[19,7,-142],[80,12,-137],[126,20,-107],[136,27,-58],[109,25,-13],[70,18,18],[81,11,56],[54,5,96],[10,3,104]],
    checkpoints: [.25,.5,.75], pads: [{s:.18,lane:2.9},{s:.55,lane:-3},{s:.79,lane:2.9}],
    branch: {start:.027,end:.169,side:1,width:7.5,spread:14,color:'#756858',name:'Service Lane'},
    feature: {start:.086,end:.127,kind:'pit',label:'SERVICE LANE'},
    sky: '#a3d6d5', fog: '#aed9ce', fogDensity: .0049, sun: '#fff0d4', ambient: '#fff3d2',
    ground: '#c98457', road: '#424c53', wall: '#864934', curb: '#ef5c3b', trim: '#fff0d8', pad: '#25949a',
    sign: ['#ef5437','#fff2d0']
  },
  frostline: {
    name: 'Frostline Pass', layoutVersion: 2, width: 16.8, bank: .8,
    anchors: [[-48,6,105],[-104,15,99],[-140,26,65],[-133,43,9],[-113,61,-51],[-76,76,-105],[-17,79,-128],[55,74,-122],[114,58,-101],[148,40,-63],[125,23,-18],[79,10,4],[42,5,44],[34,4,87],[2,5,108]],
    checkpoints: [.24,.52,.76], pads: [{s:.20,lane:-3.6},{s:.48,lane:3.1},{s:.68,lane:0},{s:.91,lane:3.8}],
    surfaces: [{start:.22,end:.42,grip:.39,color:'#abd9ed'}],
    jumps: [{start:.455,end:.472,ramp:.021,rise:1.8,arc:3.9}],
    feature: {start:.257,end:.363,kind:'gondola',label:'GLACIER LIFT'},
    sky: '#b4d8ee', fog: '#d6e6ee', fogDensity: .0042, sun: '#f1f6ff', ambient: '#d9efff',
    ground: '#d9e8f1', road: '#556b7b', wall: '#748ca1', curb: '#e95d3f', trim: '#f8ffff', pad: '#1b8bab',
    sign: ['#edfaff','#34556f']
  },
  switchyard: {
    name: 'Midnight Switchyard', layoutVersion: 2, width: 14.8, bank: .32,
    anchors: [[-45,4,118],[-107,4,118],[-129,4,109],[-138,4,86],[-138,4,10],[-129,4,-13],[-106,4,-22],[-51,4,-22],[-29,3,-31],[-20,2,-54],[-20,1,-113],[-10,1,-137],[14,1,-147],[106,3,-147],[131,5,-135],[142,6,-111],[142,5,85],[126,4,107],[94,4,118],[22,4,118]],
    checkpoints: [.23,.48,.78], pads: [{s:.105,lane:3.5},{s:.338,lane:-4},{s:.61,lane:3.4},{s:.88,lane:-3.3}],
    branch: {start:.70,end:.862,side:-1,width:7.6,spread:20,color:'#586079',name:'Express Lane'},
    feature: {start:.421,end:.491,kind:'tunnel',label:'UNDERCITY'},
    sky: '#192a49', fog: '#243952', fogDensity: .0037, sun: '#9cbefa', ambient: '#a9d6f4',
    ground: '#35415d', road: '#333e58', wall: '#374256', curb: '#ec9c3c', trim: '#a4f4ec', pad: '#2dffcb',
    sign: ['#172a40','#9afde3']
  },
  saltwater: {
    name: 'Saltwater Keys', layoutVersion: 2, width: 17.7, bank: .68,
    anchors: [[-45,2,92],[-108,2,89],[-152,2,51],[-143,2,-5],[-102,2,-32],[-46,3,-37],[17,3,-37],[84,3,-37],[141,3,-48],[182,6,-85],[224,8,-92],[253,5,-64],[252,3,-20],[213,3,22],[149,3,30],[83,3,55],[30,2,87],[-3,2,94]],
    checkpoints: [.26,.55,.79], pads: [{s:.15,lane:2.7},{s:.302,lane:-2.7},{s:.64,lane:3.1},{s:.84,lane:0}],
    branch: {start:.51,end:.689,side:-1,width:8,spread:21,color:'#c9a76c',name:'Beach Cut'},
    jumps: [{start:.332,end:.355,ramp:.022,rise:2.1,arc:4.2}],
    feature: {start:.309,end:.328,kind:'pier',label:'CHANNEL JUMP'},
    sky: '#a9e9ed', fog: '#b1e9ea', fogDensity: .0044, sun: '#fff0bf', ambient: '#dcfff1',
    ground: '#37b8b4', road: '#53616a', wall: '#546f70', curb: '#ff9b40', trim: '#fff6d2', pad: '#21c697',
    sign: ['#14877d','#fff5c3']
  },
  cinder: {
    name: 'Cinder Crown', layoutVersion: 2, width: 15.6, bank: 1.22,
    anchors: [[-27,5,119],[-106,8,106],[-150,15,46],[-151,23,-31],[-116,34,-104],[-39,47,-142],[45,57,-130],[106,64,-75],[116,70,-6],[92,75,59],[45,76,88],[-12,73,85],[-57,66,50],[-67,55,1],[-46,43,-48],[-3,31,-66],[48,21,-51],[70,13,-9],[72,8,52],[37,5,106]],
    checkpoints: [.28,.51,.73], pads: [{s:.17,lane:-3.7},{s:.46,lane:3.2},{s:.60,lane:-3.3},{s:.935,lane:3.5}],
    surfaces: [{start:.47,end:.76,grip:.64,color:'#ad4e38',edge:true}],
    feature: {start:.63,end:.69,kind:'truss',label:'CALDERA SPAN'},
    sky: '#bd766c', fog: '#a96861', fogDensity: .0053, sun: '#ffbd81', ambient: '#efd7ca',
    ground: '#51454b', road: '#4b464b', wall: '#69464b', curb: '#ff6533', trim: '#ffe09f', pad: '#fd963b',
    sign: ['#372d3b','#ffa85f']
  },
  cedar: {
    name: 'Cedar Run', layoutVersion: 2, width: 11.8, bank: .74,
    anchors: [[-32,2,82],[-81,2,76],[-113,5,50],[-103,9,10],[-69,13,-14],[-65,18,-48],[-94,21,-79],[-81,18,-111],[-43,13,-116],[-8,8,-90],[28,6,-90],[58,8,-111],[94,6,-90],[103,5,-49],[89,4,-8],[56,5,13],[39,4,40],[24,3,72],[-2,2,84]],
    checkpoints: [.22,.51,.77], pads: [{s:.22,lane:2.7},{s:.48,lane:0},{s:.67,lane:-2.9},{s:.89,lane:2.8}],
    branch: {start:.305,end:.458,side:-1,width:6.5,spread:13,color:'#82704c',name:'Timber Cut'},
    profile: [{start:.255,end:.45,width:-1.1}],
    feature: {start:.259,end:.302,kind:'logs',label:'TIMBER TUBE'},
    sky: '#bed9aa', fog: '#aec7a0', fogDensity: .0056, sun: '#fff2ba', ambient: '#e9edc7',
    ground: '#6e8d55', road: '#565d57', wall: '#6d4b39', curb: '#d75a36', trim: '#efe8ad', pad: '#72c9a3',
    sign: ['#375f43','#fff1b0']
  },
  mesa: {
    name: 'Twin Mesa', layoutVersion: 2, width: 21, bank: 1.25,
    anchors: [[-48,13,140],[-140,17,133],[-213,25,93],[-237,39,24],[-214,50,-52],[-151,53,-106],[-67,53,-120],[18,53,-126],[105,49,-135],[191,40,-139],[253,31,-105],[283,23,-47],[273,18,24],[225,13,86],[143,12,126],[58,12,142]],
    checkpoints: [.22,.49,.75], pads: [{s:.12,lane:-4.5},{s:.37,lane:3.4},{s:.64,lane:-4.2},{s:.92,lane:4.1}],
    jumps: [{start:.465,end:.489,ramp:.025,rise:2.8,arc:5.8}],
    feature: {start:.433,end:.457,kind:'mesa',label:'THE DIVIDE'},
    sky: '#efbe91', fog: '#e9aa82', fogDensity: .0041, sun: '#fff0b1', ambient: '#ffe5be',
    ground: '#ae674d', road: '#5d4e4b', wall: '#865344', curb: '#c55132', trim: '#ffe8b1', pad: '#6fc7a9',
    sign: ['#80392a','#ffe0a3']
  },
  arena: {
    name: 'Apex Arena', layoutVersion: 2, width: 23.6, bank: .85,
    anchors: [[-64,3,73],[-110,3,79],[-150,4,44],[-155,5,-9],[-121,6,-62],[-70,6,-68],[-34,6,-42],[0,5,0],[42,6,47],[91,8,78],[139,12,64],[158,17,16],[142,22,-37],[104,26,-68],[57,27,-56],[0,27,0],[-34,15,48]],
    checkpoints: [.25,.53,.78], pads: [{s:.18,lane:3.8},{s:.40,lane:-3.2},{s:.69,lane:4.1},{s:.90,lane:-4}],
    profile: [{start:.49,end:.78,width:8,bank:-.54}],
    surfaces: [{start:.53,end:.75,grip:1.18,color:'#535ca6',edge:true}],
    feature: {start:.528,end:.742,kind:'bowl',label:'APEX BOWL'},
    sky: '#aecddd', fog: '#bdccd6', fogDensity: .0037, sun: '#fff1d0', ambient: '#e6f1ff',
    ground: '#78988b', road: '#4e5466', wall: '#46546c', curb: '#da4055', trim: '#fff5dc', pad: '#39cbcc',
    sign: ['#c83150','#fff7d6']
  }
} satisfies Record<string, TrackSpec>;

export type TrackId = keyof typeof TRACKS;
export const DEFAULT_TRACK: TrackId = 'red-basin';
export const TRACK_IDS = Object.keys(TRACKS) as TrackId[];
export const isTrackId = (value: string): value is TrackId => Object.prototype.hasOwnProperty.call(TRACKS, value);
export const courseLayoutKey = (id: TrackId) => `${id}-v${TRACKS[id].layoutVersion}`;
