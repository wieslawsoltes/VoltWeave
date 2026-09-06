import { getSymbol } from './symbols.js';
import { orderedPages } from './model.js';
/** Disjoint sets contain persistent connection-point IDs only. No coordinate enters this class. */
export class DisjointSet {
  constructor(ids) {this.parent=new Map(ids.map(id=>[id,id]));}
  find(id) {let r=id;while(this.parent.get(r)!==r){r=this.parent.get(r);if(r===undefined)throw new Error(`Unknown graph vertex ${id}`);}let n=id;while(n!==r){const p=this.parent.get(n);this.parent.set(n,r);n=p;}return r;}
  union(a,b) {a=this.find(a);b=this.find(b);if(a!==b)this.parent.set(a<b?b:a,a<b?a:b);}
}
export function endpointName(p,id) {
  const pin=p.pins[id],f=p.functions[pin?.functionId],d=p.devices[f?.deviceId];
  return pin ? `${d?.tag || f?.properties.net || (f?.symbolId==='junction'?'Junction':f?.symbolId)}:${pin.label}` : '?';
}
export function buildGraph(p) {
  const ids=Object.keys(p.pins).sort(),dsu=new DisjointSet(ids),adjacency=new Map(ids.map(id=>[id,[]]));
  for(const w of Object.values(p.connections)) {dsu.union(w.from,w.to);adjacency.get(w.from).push(w.id);adjacency.get(w.to).push(w.id);}
  const labels=new Map();
  for(const f of Object.values(p.functions)) {
    const symbol=getSymbol(p,f.symbolId);
    for(const group of symbol.internal || [])for(let i=1;i<group.length;i++)dsu.union(f.pins[group[0]],f.pins[group[i]]);
    if(f.properties.net && ['potential','earth'].includes(f.symbolId)) {
      const scope=f.properties.scope==='location'?(p.devices[f.deviceId]?.location || f.properties.location || '+CP1'):'project';
      const label=`${scope}:${f.properties.net.trim()}`,id=Object.values(f.pins)[0];
      if(labels.has(label))dsu.union(id,labels.get(label));else labels.set(label,id);
    }
  }
  const netOf={},groups=new Map();
  for(const id of ids) {const root=dsu.find(id);netOf[id]=root;if(!groups.has(root))groups.set(root,{id:root,pins:[],connections:[],labels:[],numbers:[]});groups.get(root).pins.push(id);}
  for(const w of Object.values(p.connections)) {const n=groups.get(netOf[w.from]);n.connections.push(w.id);if(w.number&&!n.numbers.includes(w.number))n.numbers.push(w.number);}
  for(const f of Object.values(p.functions))if(f.properties.net&&['potential','earth'].includes(f.symbolId)) {
    const net=groups.get(netOf[Object.values(f.pins)[0]]);if(!net.labels.includes(f.properties.net))net.labels.push(f.properties.net);
  }
  const nets=[...groups.values()].sort((a,b)=>a.id.localeCompare(b.id));
  for(const n of nets){n.connections.sort();n.labels.sort();n.numbers.sort();}
  return {netOf,nets,adjacency};
}
/** Existing numbers are reused once. Net merges and splits never duplicate an unlocked number. */
export function numberConnections(p,{prefix=p.settings.wirePrefix || 'W',start=p.settings.wireStart || 1,mode='net',renumber=false}={}) {
  if(typeof prefix!=='string'||prefix.length>20||!Number.isInteger(start)||start<0||start>99999999)throw new Error('Invalid numbering settings.');
  p.settings.wirePrefix=prefix;p.settings.wireStart=start;
  const graph=buildGraph(p),used=new Set(Object.values(p.connections).filter(w=>w.locked&&w.number).map(w=>w.number));let next=start;
  const fresh=()=>{let s;do{s=`${prefix}${String(next++).padStart(4,'0')}`;}while(used.has(s));used.add(s);return s;};
  const pageRank=new Map(orderedPages(p).map((page,i)=>[page.id,i]));
  const rank=w=>{const s=p.placements[w.route.fromPlacementId];return (pageRank.get(w.route.pageId)||0)*1e9+s.x*10000+s.y;};
  if(mode==='connection') {
    for(const w of Object.values(p.connections).sort((a,b)=>rank(a)-rank(b)||a.id.localeCompare(b.id))) {
      if(w.locked&&w.number)continue;
      if(!renumber&&w.number&&!used.has(w.number)){used.add(w.number);continue;}w.number=fresh();
    }
  } else {
    const nets=graph.nets.filter(n=>n.connections.length).sort((a,b)=>Math.min(...a.connections.map(id=>rank(p.connections[id])))-Math.min(...b.connections.map(id=>rank(p.connections[id])))||a.id.localeCompare(b.id));
    for(const net of nets) {
      const wires=net.connections.map(id=>p.connections[id]);let number=wires.find(w=>w.locked&&w.number)?.number;
      if(!number&&!renumber)number=wires.map(w=>w.number).filter(n=>n&&!used.has(n)).sort()[0];
      if(!number)number=fresh();else used.add(number);
      for(const w of wires)if(!w.locked)w.number=number;
    }
  }
  return graph;
}
export function analyzeProject(p) {
  const graph=buildGraph(p),issues=[],firstPlacement=new Map(),functionPlacements=new Map();
  for(const s of Object.values(p.placements)){if(!firstPlacement.has(s.functionId))firstPlacement.set(s.functionId,s);if(!functionPlacements.has(s.functionId))functionPlacements.set(s.functionId,[]);functionPlacements.get(s.functionId).push(s);}
  const add=(severity,code,message,objectId,pageId)=>issues.push({id:`${code}:${objectId}:${issues.length}`,severity,code,message,objectId,pageId});
  const locateFunction=(f)=>firstPlacement.get(f.id);
  const tags=new Map();
  for(const d of Object.values(p.devices)) {
    const key=d.tag.trim().toUpperCase(),f=Object.values(p.functions).find(f=>f.deviceId===d.id),s=f&&locateFunction(f);
    if(!key)add('error','DEVICE_TAG','Device tag is empty.',s?.id,s?.pageId);
    else if(tags.has(key)&&tags.get(key)!==d.id)add('error','DUPLICATE_TAG',`Two physical identities use ${d.tag}. Link functions to one device or use unique tags.`,s?.id,s?.pageId);else tags.set(key,d.id);
    if(!d.part)add('warning','MISSING_PART',`${d.tag}: no article / part assigned.`,s?.id,s?.pageId);
  }
  const physicalPinLabels=new Map();
  for(const f of Object.values(p.functions)) {
    const s=locateFunction(f),symbol=getSymbol(p,f.symbolId),device=p.devices[f.deviceId];
    if(!s)add('warning','UNPLACED_FUNCTION',`${device?.tag||symbol.name} has no graphical representation.`,f.id,null);
    for(const def of symbol.pins) {
      const pin=p.pins[f.pins[def.key]],edges=graph.adjacency.get(pin.id);
      if(def.required!==false&&!f.properties.unusedPins?.includes(def.key)&&!edges.length)add('warning','OPEN_PIN',`${endpointName(p,pin.id)} is not wired.`,s?.id,s?.pageId);
      if(device) {const k=`${device.id}:${pin.label}`;if(physicalPinLabels.has(k)&&physicalPinLabels.get(k)!==pin.id)add('error','DUPLICATE_TERMINAL',`${device.tag}: terminal ${pin.label} is defined by more than one function. Reuse a representation or renumber the terminal.`,s?.id,s?.pageId);else physicalPinLabels.set(k,pin.id);}
    }
  }
  for(const net of graph.nets) {
    const wires=net.connections.map(id=>p.connections[id]),w=wires[0],outputs=net.pins.filter(id=>p.pins[id].type==='output');
    if(net.labels.length>1)add('error','POTENTIAL_CONFLICT',`Conflicting potential names: ${net.labels.join(' ↔ ')}.`,w?.id,w?.route.pageId);
    if(outputs.length>1)add('error','MULTIPLE_DRIVERS',`Multiple outputs connected: ${outputs.map(id=>endpointName(p,id)).join(', ')}.`,w?.id,w?.route.pageId);
    const locked=[...new Set(wires.filter(w=>w.locked&&w.number).map(w=>w.number))];
    if(locked.length>1)add('error','NUMBER_CONFLICT',`Conflicting locked numbers on one net: ${locked.join(', ')}.`,w?.id,w?.route.pageId);
  }
  const duplicateWireNumbers=new Map();
  for(const w of Object.values(p.connections)) {
    if(!w.number)add('info','UNNUMBERED',`Connection ${endpointName(p,w.from)} → ${endpointName(p,w.to)} is unnumbered.`,w.id,w.route.pageId);
    else {const prev=duplicateWireNumbers.get(w.number);if(prev&&prev!==graph.netOf[w.from])add('warning','NUMBER_REUSED',`Wire number ${w.number} appears on different nets.`,w.id,w.route.pageId);else duplicateWireNumbers.set(w.number,graph.netOf[w.from]);}
    if(!Number.isFinite(+w.crossSection)||+w.crossSection<=0)add('warning','CROSS_SECTION',`${w.number||'Wire'} has an invalid cross-section.`,w.id,w.route.pageId);
  }
  const plc=[],addresses=new Map();
  for(const f of Object.values(p.functions).filter(f=>f.symbolId==='plc')) {
    const d=p.devices[f.deviceId],s=locateFunction(f);
    for(const pin of getSymbol(p,f.symbolId).pins.filter(pin=>['input','output'].includes(pin.type))) {
      const data=f.properties.channels?.[pin.key]||{},address=(data.address||'').trim().toUpperCase(),id=f.pins[pin.key];
      const row={functionId:f.id,placementId:s?.id,pageId:s?.pageId,device:d?.tag||'',channel:pin.key,direction:pin.type,address,signal:data.signal||'',description:data.description||'',net:graph.nets.find(n=>n.id===graph.netOf[id])?.numbers[0]||'',connected:graph.adjacency.get(id).length>0};plc.push(row);
      if(!/^%[IQ](?:[XBWDL])?\d+(?:\.\d+)?$/.test(address))add('warning','PLC_ADDRESS',`${d?.tag}:${pin.key} has an empty or invalid PLC address.`,s?.id,s?.pageId);
      else if(addresses.has(address))add('error','PLC_DUPLICATE',`PLC address ${address} is assigned more than once.`,s?.id,s?.pageId);else addresses.set(address,id);
      if(address&&address[1]!==(pin.type==='input'?'I':'Q'))add('error','PLC_DIRECTION',`${address} does not match ${pin.type} channel ${pin.key}.`,s?.id,s?.pageId);
    }
  }
  const terminalRows=[],positions=new Map();
  const neighbors=id=>(graph.adjacency.get(id)||[]).map(wid=>{const w=p.connections[wid];return endpointName(p,w.from===id?w.to:w.from);}).join(', ');
  for(const f of Object.values(p.functions).filter(f=>f.symbolId==='terminal')) {
    const d=p.devices[f.deviceId],s=locateFunction(f),strip=p.strips[d?.stripId],position=String(d?.terminalPosition||'');
    terminalRows.push({deviceId:d?.id,functionId:f.id,placementId:s?.id,pageId:s?.pageId,strip:strip?.tag||'Unassigned',position,tag:d?.tag||'',from:neighbors(f.pins['1']),to:neighbors(f.pins['2']),net:graph.nets.find(n=>n.id===graph.netOf[f.pins['1']])?.numbers[0]||'',part:d?.part||''});
    if(!strip)add('warning','TERMINAL_STRIP',`${d?.tag}: terminal strip not assigned.`,s?.id,s?.pageId);
    else {const key=`${strip.id}:${position}`;if(!position)add('warning','TERMINAL_POSITION',`${d.tag}: terminal position is empty.`,s?.id,s?.pageId);else if(positions.has(key))add('error','TERMINAL_DUPLICATE',`${strip.tag}:${position} is assigned more than once.`,s?.id,s?.pageId);else positions.set(key,f.id);}
  }
  terminalRows.sort((a,b)=>a.strip.localeCompare(b.strip)||a.position.localeCompare(b.position,undefined,{numeric:true}));
  const cableRows=[];
  for(const c of Object.values(p.cables)) {
    const wires=Object.values(p.connections).filter(w=>w.cableId===c.id),cores=new Set();
    for(const w of wires) {
      if(!w.core||!/^\d+$/.test(w.core)||+w.core>c.cores||+w.core<1)add('error','CABLE_CORE',`${c.tag}: choose a core number between 1 and ${c.cores}.`,w.id,w.route.pageId);
      else if(cores.has(w.core))add('error','CABLE_DUPLICATE',`${c.tag}: core ${w.core} is assigned to more than one connection.`,w.id,w.route.pageId);else cores.add(w.core);
      cableRows.push({id:c.id,connectionId:w.id,pageId:w.route.pageId,tag:c.tag,cores:c.cores,core:w.core,number:w.number,from:endpointName(p,w.from),to:endpointName(p,w.to),part:c.part||'',length:c.length||'',description:c.description||''});
    }
    if(!wires.length)cableRows.push({id:c.id,tag:c.tag,cores:c.cores,core:'—',number:'',from:'Unassigned',to:'',part:c.part||'',length:c.length||'',description:c.description||''});
  }
  const articles=new Map();
  const article=(key,row)=>{if(!articles.has(key))articles.set(key,{...row,quantity:0,tags:[]});const a=articles.get(key);a.quantity+=row.quantity;a.tags.push(...row.tags);};
  for(const d of Object.values(p.devices))article(`device:${d.manufacturer}:${d.part}:${d.rating}`,{part:d.part||'(not assigned)',manufacturer:d.manufacturer||'',description:d.description||'',rating:d.rating||'',quantity:1,unit:'pcs',tags:[d.tag]});
  for(const c of Object.values(p.cables))article(`cable:${c.part}`,{part:c.part||'(cable not assigned)',manufacturer:c.manufacturer||'Generic',description:c.description||`${c.cores}-core cable`,rating:c.crossSection?`${c.cores} × ${c.crossSection} mm²`:'',quantity:+c.length||1,unit:+c.length?'m':'pcs',tags:[c.tag]});
  const bom=[...articles.values()].sort((a,b)=>a.part.localeCompare(b.part));
  for(const a of bom)a.tags.sort();
  const severity={error:0,warning:1,info:2};issues.sort((a,b)=>severity[a.severity]-severity[b.severity]||a.code.localeCompare(b.code));
  return {nets:graph.nets,netOf:graph.netOf,issues,plc,terminals:terminalRows,cables:cableRows,bom,stats:{devices:Object.keys(p.devices).length,pages:Object.keys(p.pages).length,pins:Object.keys(p.pins).length,wires:Object.keys(p.connections).length,nets:graph.nets.filter(n=>n.connections.length).length,errors:issues.filter(i=>i.severity==='error').length,warnings:issues.filter(i=>i.severity==='warning').length}};
}
