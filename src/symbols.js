/** Declarative symbol primitives. Pins are local-space connection anchors, not net IDs. */
const pin = (key, x, y, type = 'passive', label = key, required = true) => ({ key, x, y, type, label, required });
const L = (...v) => ({ type: 'line', points: v });
const R = (x, y, w, h) => ({ type: 'rect', x, y, w, h });
const C = (x, y, r) => ({ type: 'circle', x, y, r });
const T = (x, y, text, size = 14) => ({ type: 'text', x, y, text, size });
const contact = (closed, button = false) => [L(0,-45,0,-17), L(0,17,0,45), C(0,-17,2),C(0,17,2),L(0,-17,closed ? 0 : 17,17), ...(button ? [L(-27,-8,-12,-8,-12,8,-27,8),L(-12,0,7,0)] : [])];
const three = (trip = false) => [-90,0,90].flatMap(x => [L(x,-55,x,-20), L(x,20,x,55),C(x,-20,2),C(x,20,2), L(x,-20,x+18,20), ...(trip ? [R(x-12,-12,24,24)] : [])]);
const threePins = ['1','3','5'].flatMap((n,i) => [pin(n,(i-1)*90,-55),pin(String(+n+1),(i-1)*90,55)]);
export const BUILTIN_SYMBOLS = Object.freeze({
  breaker3: { id:'breaker3', name:'Circuit breaker · 3 pole', category:'Protection', prefix:'Q', bounds:[-120,-58,120,58], pins:threePins, shapes:[...three(true),L(-92,0,108,0)], part:'CB-3P-16A', description:'3-pole circuit breaker', rating:'16 A' },
  contactor3: { id:'contactor3', name:'Power contactor · 3 pole', category:'Switching', prefix:'K', bounds:[-120,-58,120,58], pins:threePins, shapes:[...three(),L(-72,0,108,0)], part:'CONTACTOR-3P-24DC', description:'Motor contactor', rating:'9 A / 24 V DC' },
  overload3: { id:'overload3', name:'Thermal overload · 3 pole', category:'Protection', prefix:'F', bounds:[-120,-45,120,45], pins:['1','3','5'].flatMap((n,i)=>[pin(n,(i-1)*90,-45),pin(String(+n+1),(i-1)*90,45)]), shapes:[R(-112,-23,224,46),...[-90,0,90].flatMap(x=>[L(x,-45,x,45),L(x-12,12,x-12,-8,x+12,-8,x+12,12)])], part:'OVERLOAD-4-6A', description:'Thermal overload relay', rating:'4–6 A' },
  breaker: { id:'breaker', name:'Circuit breaker · 1 pole', category:'Protection', prefix:'Q', bounds:[-28,-45,28,45], pins:[pin('1',0,-45),pin('2',0,45)], shapes:[...contact(false),R(-11,-11,22,22)], part:'CB-1P-6A', description:'Miniature circuit breaker', rating:'6 A' },
  fuse: { id:'fuse', name:'Fuse', category:'Protection', prefix:'F', bounds:[-20,-45,20,45], pins:[pin('1',0,-45),pin('2',0,45)], shapes:[L(0,-45,0,45),R(-12,-23,24,46)], part:'FUSE-2A', description:'Fuse cartridge', rating:'2 A' },
  coil: { id:'coil', name:'Relay / contactor coil', category:'Switching', prefix:'K', bounds:[-32,-45,32,45], pins:[pin('A1',0,-45),pin('A2',0,45)], shapes:[L(0,-45,0,-24),R(-30,-24,60,48),L(0,24,0,45),L(-23,18,23,-18)], part:'RELAY-24DC', description:'Control relay', rating:'24 V DC' },
  contactNO: { id:'contactNO', name:'Normally open contact', category:'Switching', prefix:'K', bounds:[-22,-45,22,45], pins:[pin('13',0,-45),pin('14',0,45)], shapes:contact(false), part:'RELAY-24DC', description:'Auxiliary contact NO' },
  contactNC: { id:'contactNC', name:'Normally closed contact', category:'Switching', prefix:'K', bounds:[-22,-45,22,45], pins:[pin('21',0,-45),pin('22',0,45)], shapes:[...contact(true),L(-12,10,12,10)], part:'RELAY-24DC', description:'Auxiliary contact NC' },
  pushNO: { id:'pushNO', name:'Push button · NO', category:'Switching', prefix:'S', bounds:[-34,-45,24,45], pins:[pin('13',0,-45),pin('14',0,45)], shapes:contact(false,true), part:'PB-NO-GREEN', description:'Start push button', rating:'24 V DC' },
  pushNC: { id:'pushNC', name:'Push button · NC', category:'Switching', prefix:'S', bounds:[-34,-45,24,45], pins:[pin('21',0,-45),pin('22',0,45)], shapes:[...contact(true,true),L(-12,10,12,10)], part:'PB-NC-RED', description:'Stop push button', rating:'24 V DC' },
  estop: { id:'estop', name:'Emergency stop · NC', category:'Switching', prefix:'S', bounds:[-42,-45,24,45], pins:[pin('11',0,-45),pin('12',0,45)], shapes:[...contact(true),L(-12,10,12,10),L(-14,0,-34,0),L(-34,-20,-42,-20,-42,20,-34,20),L(-34,-20,-34,20)], part:'E-STOP-NC', description:'Emergency stop contact' },
  lamp: { id:'lamp', name:'Pilot light', category:'Loads', prefix:'H', bounds:[-27,-45,27,45], pins:[pin('X1',0,-45),pin('X2',0,45)], shapes:[C(0,0,25),L(0,-45,0,-25),L(0,25,0,45),L(-17,-17,17,17),L(-17,17,17,-17)], part:'PILOT-24V-GN', description:'Green pilot light', rating:'24 V DC' },
  motor3: { id:'motor3', name:'Motor · three phase', category:'Loads', prefix:'M', bounds:[-115,-55,115,60], pins:[pin('U',-90,-55),pin('V',0,-55),pin('W',90,-55),pin('PE',112,20,'earth')], shapes:[C(0,8,47),L(-90,-55,-90,-25,-34,-25),L(0,-55,0,-39),L(90,-55,90,-25,34,-25),L(47,20,112,20),T(0,5,'M',29),T(0,31,'3~',17)], part:'MOTOR-3PH-2.2KW', description:'Conveyor drive motor', rating:'2.2 kW / 400 V' },
  resistor: { id:'resistor', name:'Resistor', category:'Loads', prefix:'R', bounds:[-20,-45,20,45], pins:[pin('1',0,-45),pin('2',0,45)], shapes:[L(0,-45,0,-26),R(-13,-26,26,52),L(0,26,0,45)], part:'RESISTOR', description:'Resistor', rating:'1 kΩ' },
  diode: { id:'diode', name:'Diode', category:'Electronics', prefix:'V', bounds:[-23,-45,23,45], pins:[pin('A',0,-45),pin('K',0,45)], shapes:[L(0,-45,0,-18),L(-21,-18,21,-18,0,18,-21,-18),L(-21,18,21,18),L(0,18,0,45)], part:'DIODE', description:'Rectifier diode' },
  supply: { id:'supply', name:'DC power supply', category:'Power', prefix:'G', bounds:[-100,-60,100,60], pins:[pin('L',-45,-60,'power'),pin('N',45,-60,'power'),pin('+',-45,60,'output'),pin('-',45,60,'output')], shapes:[R(-95,-42,190,84),L(-45,-60,-45,-42),L(45,-60,45,-42),L(-45,42,-45,60),L(45,42,45,60),L(-85,32,85,-32),T(-49,-6,'AC',17),T(49,20,'DC',17)], part:'PSU-24V-5A', description:'DIN rail power supply', rating:'230 V AC / 24 V DC · 5 A' },
  terminal: { id:'terminal', name:'Feed-through terminal', category:'Terminals', prefix:'X', bounds:[-18,-28,18,28], pins:[pin('1',0,-28),pin('2',0,28)], internal:[['1','2']], shapes:[L(0,-28,0,-8),C(0,0,8),L(0,8,0,28),L(-16,-18,-16,18),L(16,-18,16,18)], part:'TERMINAL-2.5', description:'Feed-through terminal', rating:'2.5 mm²' },
  earth: { id:'earth', name:'Protective earth', category:'Power', prefix:null, bounds:[-24,-26,24,18], pins:[pin('PE',0,-26,'earth')], shapes:[L(0,-26,0,0),L(-22,0,22,0),L(-15,7,15,7),L(-7,14,7,14)], defaults:{net:'PE',scope:'project'} },
  potential: { id:'potential', name:'Potential / interruption point', category:'Power', prefix:null, bounds:[-16,-22,16,25], pins:[pin('P',0,25)], shapes:[L(0,25,0,-18),L(-9,-7,0,-19,9,-7)], defaults:{net:'+24V',scope:'project'} },
  junction: { id:'junction', name:'Connection junction', category:'Connections', prefix:null, bounds:[-5,-5,5,5], pins:[pin('J',0,0,'passive','',false)], shapes:[{type:'dot',x:0,y:0,r:4}], defaults:{} },
  plc: { id:'plc', name:'PLC · 4 DI / 4 DO', category:'Automation', prefix:'A', bounds:[-145,-150,145,150], pins:[pin('L+',-45,-150,'power'),pin('M',45,-150,'power'),...Array.from({length:4},(_,i)=>pin(`I${i}`,-145,-85+i*50,'input')), ...Array.from({length:4},(_,i)=>pin(`Q${i}`,145,-85+i*50,'output'))], shapes:[R(-115,-125,230,250),L(-45,-150,-45,-125),L(45,-150,45,-125),T(0,-88,'PLC',25),T(0,-63,'4 DI / 4 DO',12),L(0,-42,0,112),...Array.from({length:4},(_,i)=>[L(-145,-85+i*50,-115,-85+i*50),T(-85,-80+i*50,`I${i}`,12),L(115,-85+i*50,145,-85+i*50),T(85,-80+i*50,`Q${i}`,12)]).flat()], part:'PLC-8IO-24DC', description:'Compact programmable controller', rating:'24 V DC' },
  sensor: { id:'sensor', name:'Proximity sensor · PNP', category:'Automation', prefix:'B', bounds:[-38,-45,38,45], pins:[pin('+',-20,-45,'power'),pin('-',20,-45,'power'),pin('Q',0,45,'output')], shapes:[R(-35,-25,70,50),L(-20,-45,-20,-25),L(20,-45,20,-25),L(0,25,0,45),L(-20,10,17,-10),L(5,-10,17,-10,17,2)], part:'SENSOR-PNP-NO', description:'Inductive proximity sensor', rating:'24 V DC' }
});
export function symbols(project) { return {...BUILTIN_SYMBOLS, ...project?.symbols}; }
export function getSymbol(project, id) { const s = project?.symbols?.[id] || BUILTIN_SYMBOLS[id]; if (!s) throw new Error(`Unknown symbol: ${id}`); return s; }
export function validateSymbol(s) {
  if (!s || !/^[a-zA-Z][\w-]{0,63}$/.test(s.id || '') || !s.name || typeof s.name !== 'string') throw new Error('Symbol needs a safe ID and a name.');
  if (!Array.isArray(s.bounds) || s.bounds.length !== 4 || !s.bounds.every(n=>Number.isFinite(n)&&Math.abs(n)<=10000) || s.bounds[0]>=s.bounds[2] || s.bounds[1]>=s.bounds[3]) throw new Error('Invalid symbol bounds.');
  if (!Array.isArray(s.pins) || s.pins.length > 256 || !Array.isArray(s.shapes) || s.shapes.length > 2000) throw new Error('Invalid pin / primitive list.');
  const keys = new Set();
  for (const p of s.pins) {
    if (!p.key || typeof p.key !== 'string' || keys.has(p.key) || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x)>10000 || Math.abs(p.y)>10000 || !['input','output','power','passive','earth'].includes(p.type || 'passive')) throw new Error('Invalid or duplicate symbol pin.');
    keys.add(p.key);
  }
  for (const sh of s.shapes) {
    if (!['line','rect','circle','dot','text'].includes(sh.type)) throw new Error('Unknown symbol primitive.');
    if (sh.type==='line' && (!Array.isArray(sh.points) || sh.points.length<4 || sh.points.length%2 || sh.points.length>10000 || !sh.points.every(n=>Number.isFinite(n)&&Math.abs(n)<=10000))) throw new Error('Invalid line points.');
    if (sh.type!=='line' && (!Number.isFinite(sh.x) || !Number.isFinite(sh.y) || Math.abs(sh.x)>10000 || Math.abs(sh.y)>10000)) throw new Error('Invalid primitive coordinates.');
    if (sh.type==='rect' && (!Number.isFinite(sh.w)||!Number.isFinite(sh.h)||sh.w<=0||sh.h<=0||sh.w>10000||sh.h>10000)) throw new Error('Invalid rectangle.');
    if (['circle','dot'].includes(sh.type) && (!Number.isFinite(sh.r)||sh.r<=0||sh.r>10000)) throw new Error('Invalid radius.');
    if (sh.type==='text' && (typeof sh.text!=='string'||!Number.isFinite(sh.size)||sh.size<=0||sh.size>512||sh.text.length>5000)) throw new Error('Invalid symbol text.');
  }
  for (const group of s.internal || []) if (!Array.isArray(group)||group.length<2||group.some(k=>!keys.has(k))) throw new Error('Invalid internal pin connection.');
  return s;
}
export function transformPoint(p, x, y) {
  const a=(p.rotation || 0)*Math.PI/180, c=Math.cos(a), s=Math.sin(a);
  return {x:p.x+x*c-y*s, y:p.y+x*s+y*c};
}
export function pinPoint(project, placement, key) {
  const f=project.functions[placement.functionId], pin=getSymbol(project,f.symbolId).pins.find(p=>p.key===key);
  if (!pin) throw new Error(`Missing pin ${key}`); return transformPoint(placement,pin.x,pin.y);
}
export function placementBounds(project,p,margin=0) {
  const b=getSymbol(project,project.functions[p.functionId].symbolId).bounds;
  const points=[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]].map(([x,y])=>transformPoint(p,x,y));
  return {x1:Math.min(...points.map(p=>p.x))-margin,y1:Math.min(...points.map(p=>p.y))-margin,x2:Math.max(...points.map(p=>p.x))+margin,y2:Math.max(...points.map(p=>p.y))+margin};
}
