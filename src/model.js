import { getSymbol, validateSymbol, BUILTIN_SYMBOLS } from './symbols.js';
export function uid() {
  if(globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  const bytes=globalThis.crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const h=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export const clone = value => structuredClone(value);
export const COLLECTIONS = ['pages','devices','functions','pins','placements','connections','strips','cables','symbols','macros'];
const isText=(value,max=5000)=>typeof value==='string'&&value.length<=max;
const dangerous = new Set(['__proto__','constructor','prototype']);
const own = (obj,key) => Object.hasOwn(obj,key);
export function emptyProject(name = 'Untitled electrical project') {
  return { format:'voltweave/project', version:1, id:uid(), name, author:'Engineering', revision:'A', description:'', created:new Date().toISOString(), settings:{grid:10,wirePrefix:'W',wireStart:1}, ...Object.fromEntries(COLLECTIONS.map(c=>[c,{}])) };
}
export function addPage(p, name='New schematic', number) {
  const id=uid(); p.pages[id]={id,number:String(number ?? Math.max(0,...Object.values(p.pages).map(p=>+p.number||0))+1),name,structure:'=MCC+CP1',width:1600,height:1000,order:Object.keys(p.pages).length,notes:[]}; return id;
}
export function orderedPages(p) { return Object.values(p.pages).sort((a,b)=>a.order-b.order || a.number.localeCompare(b.number,undefined,{numeric:true})); }
export function nextTag(p, prefix='K') {
  let n=1; const used=new Set(Object.values(p.devices).map(d=>d.tag)); while(used.has(`-${prefix}${n}`)) n++; return `-${prefix}${n}`;
}
export function addDevice(p,symbolId,options={}) {
  const s=getSymbol(p,symbolId), id=uid();
  p.devices[id]={id,tag:options.tag || nextTag(p,s.prefix || 'D'),description:s.description || s.name,part:s.part || '',manufacturer:'Generic',rating:s.rating || '',location:'+CP1',...options,id}; return id;
}
export function addFunction(p,pageId,symbolId,x,y,options={}) {
  if(!p.pages[pageId]) throw new Error('Page does not exist.');
  const s=getSymbol(p,symbolId); let deviceId=options.deviceId;
  if(deviceId === undefined) deviceId=s.prefix ? addDevice(p,symbolId,options.device || {}) : null;
  if(deviceId && !p.devices[deviceId]) throw new Error('Device identity does not exist.');
  const id=uid(), placementId=uid();
  const f={id,deviceId,symbolId,pins:{},properties:{...clone(s.defaults || {}),...options.properties}};
  if(symbolId==='plc' && !f.properties.channels) f.properties.channels=Object.fromEntries(s.pins.filter(p=>p.type==='input'||p.type==='output').map(pin=>[pin.key,{address:`%${pin.key[0]}0.${pin.key.slice(1)}`,signal:pin.key,description:''}]));
  for(const def of s.pins) {const pid=uid(); p.pins[pid]={id:pid,functionId:id,key:def.key,label:def.label || def.key,type:def.type||'passive'}; f.pins[def.key]=pid;}
  p.functions[id]=f; p.placements[placementId]={id:placementId,functionId:id,pageId,x,y,rotation:options.rotation || 0};
  return {functionId:id,placementId,deviceId,pins:f.pins};
}
export function connect(p,a,keyA,b,keyB,options={}) {
  const pa=p.placements[typeof a==='string'?a:a.placementId], pb=p.placements[typeof b==='string'?b:b.placementId];
  if(!pa||!pb||pa.pageId!==pb.pageId) throw new Error('Drawn connections need two placements on the same page. Use matching potential points across pages.');
  const fa=p.functions[pa.functionId],fb=p.functions[pb.functionId],from=fa.pins[keyA],to=fb.pins[keyB];
  if(!from||!to||from===to) throw new Error('Choose two different valid connection points.');
  if(Object.values(p.connections).some(w=>(w.from===from&&w.to===to)||(w.from===to&&w.to===from))) throw new Error('These connection points are already connected.');
  const id=uid(); p.connections[id]={id,from,to,number:'',locked:false,color:'#245c77',crossSection:'1.5',cableId:null,core:'',...options,route:{pageId:pa.pageId,fromPlacementId:pa.id,toPlacementId:pb.id,waypoints:clone(options.waypoints || [])}};
  delete p.connections[id].waypoints; return id;
}
export function rebindDevice(p,functionId,deviceId) {
  const f=p.functions[functionId]; if(!f || !p.devices[deviceId]) throw new Error('Invalid device link.');
  const old=f.deviceId; f.deviceId=deviceId;
  if(old && !Object.values(p.functions).some(f=>f.deviceId===old)) delete p.devices[old];
}
export function deleteSelection(p,ids) {
  const functions=new Set();
  for(const id of ids) {if(p.connections[id]) delete p.connections[id]; if(p.placements[id]) {functions.add(p.placements[id].functionId);delete p.placements[id];}}
  for(const fid of functions) {
    if(Object.values(p.placements).some(s=>s.functionId===fid)) continue;
    const f=p.functions[fid]; if(!f)continue;
    const removed=new Set(Object.values(f.pins)); for(const pin of removed) delete p.pins[pin];
    for(const w of Object.values(p.connections)) if(removed.has(w.from)||removed.has(w.to)) delete p.connections[w.id];
    delete p.functions[fid];
    if(f.deviceId&&!Object.values(p.functions).some(other=>other.deviceId===f.deviceId)) delete p.devices[f.deviceId];
  }
  // A route cannot refer to a deleted representation, even when its function survives.
  for(const w of Object.values(p.connections)) if(!p.placements[w.route.fromPlacementId]||!p.placements[w.route.toPlacementId]) delete p.connections[w.id];
}
export function removePage(p,pageId) {
  if(Object.keys(p.pages).length<=1) throw new Error('A project must keep at least one page.');
  deleteSelection(p,Object.values(p.placements).filter(s=>s.pageId===pageId).map(s=>s.id)); delete p.pages[pageId];
}
export function captureBundle(p,ids) {
  const placements=Object.values(p.placements).filter(s=>ids.includes(s.id)); if(!placements.length) throw new Error('Select at least one symbol.');
  const minX=Math.min(...placements.map(s=>s.x)),minY=Math.min(...placements.map(s=>s.y));
  const fs=new Set(placements.map(s=>s.functionId)),ds=new Set([...fs].map(id=>p.functions[id].deviceId).filter(Boolean));
  const endpoints=new Set(placements.map(s=>s.id));
  return { pins:Object.values(p.pins).filter(pin=>fs.has(pin.functionId)).map(clone),strips:Object.values(p.strips).filter(strip=>[...ds].some(id=>p.devices[id].stripId===strip.id)).map(clone),cables:Object.values(p.cables).filter(c=>Object.values(p.connections).some(w=>w.cableId===c.id&&endpoints.has(w.route.fromPlacementId)&&endpoints.has(w.route.toPlacementId))).map(clone), placements:placements.map(s=>({...clone(s),x:s.x-minX,y:s.y-minY})), functions:Object.values(p.functions).filter(f=>fs.has(f.id)).map(clone),devices:Object.values(p.devices).filter(d=>ds.has(d.id)).map(clone),connections:Object.values(p.connections).filter(w=>endpoints.has(w.route.fromPlacementId)&&endpoints.has(w.route.toPlacementId)).map(w=>({...clone(w),route:{...clone(w.route),waypoints:w.route.waypoints.map(pt=>({x:pt.x-minX,y:pt.y-minY}))}})) };
}
export function insertBundle(p,pageId,bundle,x,y) {
  const dm=new Map(), fm=new Map(),pm=new Map(),sm=new Map(),cm=new Map();
  const nextDefinitionTag=(collection,prefix)=>{let n=1;const used=new Set(Object.values(collection).map(x=>x.tag));while(used.has(`-${prefix}${n}`))n++;return `-${prefix}${n}`;};
  for(const strip of bundle.strips||[]){const id=uid();p.strips[id]={...clone(strip),id,tag:nextDefinitionTag(p.strips,'X')};sm.set(strip.id,id);}
  for(const cable of bundle.cables||[]){const id=uid();p.cables[id]={...clone(cable),id,tag:nextDefinitionTag(p.cables,'W')};cm.set(cable.id,id);}
  for(const d of bundle.devices) {const id=uid(),prefix=(d.tag.match(/[A-Za-z]+/)||['D'])[0],stripId=sm.get(d.stripId)||d.stripId;const tag=stripId&&p.strips[stripId]?`${p.strips[stripId].tag}:${d.terminalPosition}`:nextTag(p,prefix);p.devices[id]={...clone(d),id,tag};if(stripId)p.devices[id].stripId=stripId;dm.set(d.id,id);}
  for(const old of bundle.placements) {
    const f=bundle.functions.find(f=>f.id===old.functionId); if(!f) throw new Error('Macro has a missing function.');
    if(!fm.has(f.id)) {const n=addFunction(p,pageId,f.symbolId,old.x+x,old.y+y,{deviceId:f.deviceId?dm.get(f.deviceId):null,properties:clone(f.properties),rotation:old.rotation}); for(const [key,oldId]of Object.entries(f.pins)){const oldPin=bundle.pins?.find(pin=>pin.id===oldId);if(oldPin)p.pins[n.pins[key]].label=oldPin.label;}fm.set(f.id,n);pm.set(old.id,n.placementId);}
    else {const id=uid();p.placements[id]={...clone(old),id,functionId:fm.get(f.id).functionId,pageId,x:old.x+x,y:old.y+y};pm.set(old.id,id);}
  }
  const oldPinKey=new Map(); for(const f of bundle.functions)for(const [key,id]of Object.entries(f.pins))oldPinKey.set(id,key);
  for(const w of bundle.connections) connect(p,pm.get(w.route.fromPlacementId),oldPinKey.get(w.from),pm.get(w.route.toPlacementId),oldPinKey.get(w.to),{color:w.color,crossSection:w.crossSection,cableId:cm.get(w.cableId)||null,core:cm.has(w.cableId)?w.core:'',waypoints:w.route.waypoints.map(pt=>({x:pt.x+x,y:pt.y+y}))});
  return [...pm.values()];
}
export function splitConnection(p,wireId,point,routePoints) {
  const w=p.connections[wireId]; if(!w)throw new Error('Connection not found.');
  const j=addFunction(p,w.route.pageId,'junction',point.x,point.y), fromKey=p.pins[w.from].key,toKey=p.pins[w.to].key;
  let cut=0,best=Infinity;
  for(let i=0;i<routePoints.length-1;i++) {
    const a=routePoints[i],b=routePoints[i+1], dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1)));
    const d=Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy); if(d<best){best=d;cut=i;}
  }
  const opts={number:w.number,locked:w.locked,color:w.color,crossSection:w.crossSection}; delete p.connections[wireId];
  const first=connect(p,w.route.fromPlacementId,fromKey,j,'J',{...opts,cableId:w.cableId,core:w.core,waypoints:routePoints.slice(1,cut+1)});
  connect(p,j,'J',w.route.toPlacementId,toKey,{...opts,waypoints:routePoints.slice(cut+1,-1)});
  return {...j,firstConnection:first};
}
/** Validate all referential invariants before publishing a transaction or accepting an import. */
export function validateProject(p) {
  if(!p||p.format!=='voltweave/project'||p.version!==1)throw new Error('Unsupported project format or version.');
  if(typeof p.id!=='string'||typeof p.name!=='string'||p.name.length>500)throw new Error('Invalid project identity.');
  for(const col of COLLECTIONS) {
    if(!p[col]||Array.isArray(p[col])||typeof p[col]!=='object')throw new Error(`Invalid ${col} collection.`);
    if(Object.keys(p[col]).length>100000)throw new Error(`${col} exceeds the import limit.`);
    for(const [key,entity]of Object.entries(p[col])) if(dangerous.has(key)||!entity||entity.id!==key)throw new Error(`Invalid identity in ${col}.`);
  }
  for(const s of Object.values(p.symbols)) {if(BUILTIN_SYMBOLS[s.id])throw new Error('Built-in symbol IDs cannot be overridden.');validateSymbol(s);}
  if(!Object.keys(p.pages).length)throw new Error('Project has no pages.');
  const pageNumbers=new Set();for(const page of Object.values(p.pages)){if(pageNumbers.has(page.number))throw new Error('Page numbers must be unique.');pageNumbers.add(page.number);}
  for(const page of Object.values(p.pages)) if(typeof page.name!=='string'||typeof page.number!=='string'||!Number.isFinite(page.width)||!Number.isFinite(page.height)||page.width<200||page.height<200||page.width>50000||page.height>50000||!Array.isArray(page.notes))throw new Error('Invalid page.');
  for(const page of Object.values(p.pages)){if(page.notes.length>5000)throw new Error('Too many page annotations.');for(const note of page.notes)if(!note||![note.x,note.y].every(n=>Number.isFinite(n)&&Math.abs(n)<=100000)||(note.type==='divider'?(!Number.isFinite(note.height)||note.height<0||note.height>50000):!isText(note.text)))throw new Error('Invalid page annotation.');}
  for(const d of Object.values(p.devices)) if(typeof d.tag!=='string'||typeof d.part!=='string'||(d.stripId&&!own(p.strips,d.stripId)))throw new Error('Invalid device / terminal strip.');
  for(const f of Object.values(p.functions)) {
    const s=getSymbol(p,f.symbolId); if(f.deviceId&&!own(p.devices,f.deviceId))throw new Error('Missing physical device.');
    if(!f.properties||!f.pins||typeof f.properties!=='object'||Array.isArray(f.properties))throw new Error('Invalid function properties.');
    for(const key of ['net','scope','location','description'])if(f.properties[key]!==undefined&&!isText(f.properties[key]))throw new Error('Function text property must be a string.');
    if(f.properties.unusedPins!==undefined&&(!Array.isArray(f.properties.unusedPins)||f.properties.unusedPins.some(k=>!s.pins.some(pin=>pin.key===k))))throw new Error('Invalid unused-pin declaration.');
    if(f.properties.channels!==undefined){if(typeof f.properties.channels!=='object'||Array.isArray(f.properties.channels)||!f.properties.channels)throw new Error('Invalid PLC channels.');for(const [key,ch]of Object.entries(f.properties.channels)){if(!s.pins.some(pin=>pin.key===key)||!ch||typeof ch!=='object')throw new Error('Invalid PLC channel.');for(const field of ['address','signal','description'])if(ch[field]!==undefined&&!isText(ch[field]))throw new Error('Invalid PLC channel text.');}}
    const expected=new Set(s.pins.map(pin=>pin.key));
    if(Object.keys(f.pins).length!==expected.size)throw new Error('Symbol / function pin count mismatch.');
    for(const [key,id]of Object.entries(f.pins))if(!expected.has(key)||!own(p.pins,id)||p.pins[id].functionId!==f.id||p.pins[id].key!==key)throw new Error('Broken function pin identity.');
  }
  for(const pin of Object.values(p.pins)) if(!isText(pin.label,200)||!['input','output','power','passive','earth'].includes(pin.type)||!p.functions[pin.functionId]||p.functions[pin.functionId].pins[pin.key]!==pin.id)throw new Error('Orphan connection point.');
  for(const s of Object.values(p.placements)) if(!own(p.pages,s.pageId)||!own(p.functions,s.functionId)||![s.x,s.y,s.rotation].every(Number.isFinite)||Math.abs(s.x)>100000||Math.abs(s.y)>100000||s.rotation%90!==0)throw new Error('Invalid symbol placement.');
  for(const w of Object.values(p.connections)) {
    if(!own(p.pins,w.from)||!own(p.pins,w.to)||w.from===w.to)throw new Error('Broken connection endpoint.');
    const r=w.route,a=p.placements[r?.fromPlacementId],b=p.placements[r?.toPlacementId];
    if(!a||!b||a.pageId!==r.pageId||b.pageId!==r.pageId||p.pins[w.from].functionId!==a.functionId||p.pins[w.to].functionId!==b.functionId)throw new Error('Connection route does not represent its semantic endpoints.');
    if(!Array.isArray(r.waypoints)||r.waypoints.length>10000||r.waypoints.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw new Error('Invalid route waypoints.');
    if(w.cableId&&!own(p.cables,w.cableId))throw new Error('Missing cable definition.');
    if(typeof w.number!=='string'||typeof w.color!=='string'||!/^#[0-9a-f]{6}$/i.test(w.color))throw new Error('Invalid connection appearance / number.');
  }
  for(const c of Object.values(p.cables)) if(typeof c.tag!=='string'||!Number.isInteger(c.cores)||c.cores<1||c.cores>1000||(c.length!==undefined&&(!Number.isFinite(+c.length)||+c.length<0||+c.length>1e9)))throw new Error('Invalid cable.');
  if(!p.settings||!Number.isFinite(p.settings.grid)||p.settings.grid<1||p.settings.grid>100)throw new Error('Invalid grid.');
  return p;
}
export function parseProject(text) {
  if(text.length>30*1024*1024)throw new Error('Project is larger than the 30 MB import limit.');
  return validateProject(JSON.parse(text,(key,value)=>{if(dangerous.has(key))throw new Error('Unsafe object key in import.');return value;}));
}
function patchesBetween(a,b) {
  const patches=[];
  for(const col of COLLECTIONS)for(const id of new Set([...Object.keys(a[col]),...Object.keys(b[col])])) {
    if(JSON.stringify(a[col][id])!==JSON.stringify(b[col][id]))patches.push({col,id,before:clone(a[col][id]),after:clone(b[col][id])});
  }
  for(const key of ['name','author','revision','description','settings']) if(JSON.stringify(a[key])!==JSON.stringify(b[key]))patches.push({col:'$',id:key,before:clone(a[key]),after:clone(b[key])});
  return patches;
}
/** Cached physical-device cross references; a geometry edit updates only its device's entries. */
export class CrossReferenceIndex {
  constructor(project) {this.byDevice=new Map();this.functionPlacements=new Map();this.rebuild(project);this.updatedDevices=0;}
  rebuild(p) {
    this.byDevice.clear();this.functionPlacements.clear();
    for(const s of Object.values(p.placements)){if(!this.functionPlacements.has(s.functionId))this.functionPlacements.set(s.functionId,new Set());this.functionPlacements.get(s.functionId).add(s.id);}
    for(const id of Object.keys(p.devices))this.refreshDevice(p,id);
  }
  refreshDevice(p,id) {
    const entries=[];
    for(const f of Object.values(p.functions))if(f.deviceId===id)for(const pid of this.functionPlacements.get(f.id)||[]) {
      const s=p.placements[pid],page=p.pages[s?.pageId];if(!page)continue;
      const column=Math.max(1,Math.min(10,Math.floor((s.x-60)/148)+1));
      entries.push({placementId:s.id,functionId:f.id,pageId:page.id,page:page.number,column,symbol:f.symbolId,text:`/${page.number}.${column}`});
    }
    if(entries.length)this.byDevice.set(id,entries.sort((a,b)=>a.page.localeCompare(b.page,undefined,{numeric:true})||a.column-b.column));else this.byDevice.delete(id);
  }
  update(p,patches) {
    const dirty=new Set();
    for(const patch of patches) {
      if(patch.col==='devices'){dirty.add(patch.id);}
      if(patch.col==='functions')for(const f of [patch.before,patch.after])if(f?.deviceId)dirty.add(f.deviceId);
      if(patch.col==='placements') {
        const before=patch.before,after=patch.after;
        if(before){this.functionPlacements.get(before.functionId)?.delete(before.id);const d=p.functions[before.functionId]?.deviceId;if(d)dirty.add(d);}
        if(after){if(!this.functionPlacements.has(after.functionId))this.functionPlacements.set(after.functionId,new Set());this.functionPlacements.get(after.functionId).add(after.id);const d=p.functions[after.functionId]?.deviceId;if(d)dirty.add(d);}
      }
      if(patch.col==='pages')for(const s of Object.values(p.placements))if(s.pageId===patch.id){const d=p.functions[s.functionId]?.deviceId;if(d)dirty.add(d);}
    }
    for(const id of dirty)this.refreshDevice(p,id);this.updatedDevices=dirty.size;
  }
  get(deviceId) {return this.byDevice.get(deviceId)||[];}
}
/** Atomic validated edits, sparse reversible entity patches, bounded undo memory. */
export class ProjectStore {
  constructor(project) {this.project=validateProject(clone(project));this.revision=0;this.undoStack=[];this.redoStack=[];this.historyBytes=0;this.listeners=new Set();this.xrefs=new CrossReferenceIndex(this.project);}
  subscribe(fn) {this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  notify(label,patches,topology=true) {this.revision++;this.xrefs.update(this.project,patches);for(const fn of this.listeners)fn({label,patches,topology,revision:this.revision});}
  edit(label,fn) {
    const draft=clone(this.project);const result=fn(draft);validateProject(draft);const patches=patchesBetween(this.project,draft);if(!patches.length)return result;
    this.project=draft;const bytes=JSON.stringify(patches).length*2;this.undoStack.push({label,patches,bytes});this.historyBytes+=bytes;this.redoStack=[];
    while(this.undoStack.length>200||this.historyBytes>32*1024*1024){const old=this.undoStack.shift();this.historyBytes-=old.bytes;}
    this.notify(label,patches,patches.some(p=>['functions','pins','connections','symbols'].includes(p.col)));return result;
  }
  apply(entry,direction) {
    const draft=clone(this.project);const patches=[];
    for(const change of entry.patches) {const value=clone(change[direction]);const target=change.col==='$'?draft:draft[change.col];if(value===undefined)delete target[change.id];else target[change.id]=value;patches.push(direction==='before'?{...change,before:change.after,after:change.before}:change);}
    validateProject(draft);this.project=draft;this.notify(`${direction==='before'?'Undo':'Redo'} ${entry.label}`,patches);
  }
  undo() {const e=this.undoStack.pop();if(!e)return;this.historyBytes-=e.bytes;this.apply(e,'before');this.redoStack.push(e);}
  redo() {const e=this.redoStack.pop();if(!e)return;this.historyBytes+=e.bytes;this.apply(e,'after');this.undoStack.push(e);}
  replace(project) {const next=validateProject(clone(project));this.project=next;this.undoStack=[];this.redoStack=[];this.historyBytes=0;this.xrefs.rebuild(next);this.notify('Open project',[],true);}
}
