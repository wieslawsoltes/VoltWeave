import {ProjectStore,uid,clone,emptyProject,addPage,orderedPages,addFunction,connect,deleteSelection,removePage,captureBundle,insertBundle,splitConnection,rebindDevice,parseProject} from './model.js';
import {symbols,getSymbol,validateSymbol,pinPoint} from './symbols.js';
import {createDemo} from './demo.js';
import {analyzeProject,numberConnections,endpointName} from './graph.js';
import {buildScene,DrawList,symbolPrimitives,sceneToSVG,escapeXML as e} from './scene.js';
import {SchematicRenderer} from './renderer.js';
import {snap,distanceToSegment,closestOnSegment} from './routing.js';
import {loadWorkspace,persistWorkspace,checkpointWorkspace,createWorkspaceRecord,downloadFile,csv} from './persistence.js';
import {REPORT_COLUMNS,reportRows,generateDocumentation} from './reports.js';

const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)],icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const params=new URLSearchParams(location.search),restored=params.has('demo')?null:await loadWorkspace();
const store=new ProjectStore(restored||createDemo());
const state={pageId:orderedPages(store.project)[0].id,selection:new Set(),tool:'select',symbolId:'coil',rotation:0,overrides:{},wireStart:null,waypoints:[],pointer:{x:800,y:450},snap:true,showNumbers:true,showRefs:true,nav:'pages',ribbon:'home',dock:'issues',drag:null,space:false,clipboard:null,macro:null,analysis:analyzeProject(store.project),analysisMs:0,analysisRevision:0};
let toastTimer,saveTimer,analysisTimer,worker=null,inflight=false,analysisPending=false,saveQueue=Promise.resolve(),dirtySave=false,dialogHandler=null;
function toast(text,error=false){const node=$('#toast');node.textContent=text;node.classList.toggle('error',error);node.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.hidden=true,error?6500:3200);}
const renderer=new SchematicRenderer($('#stage'),{
  onStatus:(backend,reason)=>{$('#renderStatus').title=reason;document.body.dataset.backend=backend;if(backend==='Canvas 2D')toast(`Canvas fallback active. ${reason}`);},
  onFrame:({backend,segments,cpuMs,zoom})=>{$('#zoomLabel').textContent=`${Math.round(zoom*100)}%`;$('#renderStatus').textContent=`${backend} · ${segments} segments · ${cpuMs.toFixed(1)} ms CPU`;}
});renderer.resize();
const currentPage=()=>store.project.pages[state.pageId];
const currentPlacement=()=>[...state.selection].map(id=>store.project.placements[id]).find(Boolean);
const currentWire=()=>[...state.selection].map(id=>store.project.connections[id]).find(Boolean);
const snapPoint=point=>state.snap?{x:snap(point.x,store.project.settings.grid),y:snap(point.y,store.project.settings.grid)}:point;
const safeFile=name=>(name||'project').replace(/[^\p{L}\p{N}._-]+/gu,'-').slice(0,100);
function selectedNet(){const w=currentWire();if(!w)return null;const n=state.analysis.nets.find(n=>n.id===state.analysis.netOf[w.from]);return n?new Set(n.pins):null;}
function rebuildScene(){renderer.selection=state.selection;renderer.setScene(buildScene(store.project,state.pageId,store.xrefs,{overrides:state.overrides,selection:state.selection,highlightNet:selectedNet(),showNumbers:state.showNumbers,showRefs:state.showRefs}));}
function selectionChanged(){rebuildScene();renderInspector();updateControls();}
function setPage(id,{fit=true}={}){if(!store.project.pages[id])return;state.pageId=id;state.selection.clear();cancelWire();state.overrides={};renderNavigation();renderPageTabs();rebuildScene();renderInspector();if(fit)renderer.fit();$('#statusMessage').textContent=`Page ${currentPage().number} · ${currentPage().name}`;}
function jumpTo(id,pageId){
  const p=store.project;
  if(!p.placements[id]&&!p.connections[id]){const placement=Object.values(p.placements).find(s=>p.functions[s.functionId].deviceId===id||s.functionId===id);if(placement){id=placement.id;pageId=placement.pageId;}}
  if(pageId&&pageId!==state.pageId)setPage(pageId,{fit:false});
  if(p.placements[id]||p.connections[id]){state.selection=new Set([id]);selectionChanged();const s=p.placements[id];let point=s;
    if(!point){const route=renderer.scene.routes.get(id);if(route?.length)point=route[Math.floor(route.length/2)];}if(point){renderer.zoom=Math.max(renderer.zoom,.7);renderer.centerAt(point);}}
}
function setTool(tool){state.tool=tool;if(tool!=='wire')cancelWire();state.macro=tool==='macro'?state.macro:null;renderer.overlay.ghost=null;renderer.overlay.hover=null;renderer.overlay.preview=null;$('#stage').className=`stage ${['symbol','macro'].includes(tool)?'placing':tool}`;updateControls();updateHint();renderer.requestDraw();}
function cancelWire(){state.wireStart=null;state.waypoints=[];renderer.overlay.preview=null;renderer.requestDraw();}
function updateHint(){let hint='Select / drag · Wheel to zoom · Space to pan';if(state.tool==='wire')hint=state.wireStart?'Click a pin or wire to connect · Blank click adds a bend · Esc cancels':'Click a connection point or an existing wire';if(state.tool==='symbol')hint=`Place ${getSymbol(store.project,state.symbolId).name} · R rotates · Esc exits`;if(state.tool==='macro')hint='Place reusable circuit · New physical identities are generated';if(state.tool==='pan')hint='Drag to pan · Wheel or pinch to zoom';$('#toolHint').innerHTML=`<span class="hint-dot"></span><span>${e(hint)}</span>`;}
function updateControls(){
  $$('[data-action="select"],[data-action="wire"],[data-action="pan"]').forEach(b=>b.classList.toggle('active',b.dataset.action===state.tool));
  for(const [action,enabled]of [['grid',renderer.showGrid],['snap',state.snap],['showNumbers',state.showNumbers],['showRefs',state.showRefs]])$$(`[data-action="${action}"]`).forEach(b=>b.classList.toggle('active',enabled));
  $$('[data-action="undo"]').forEach(b=>b.disabled=!store.undoStack.length);$$('[data-action="redo"]').forEach(b=>b.disabled=!store.redoStack.length);
  $('#snapStatus').textContent=`SNAP ${store.project.settings.grid}`;$('#snapStatus').classList.toggle('on',state.snap);$('#gridStatus').classList.toggle('on',renderer.showGrid);
  $$('.symbol-tile[data-symbol]').forEach(b=>b.classList.toggle('active',state.tool==='symbol'&&state.symbolId===b.dataset.symbol));
}
function scheduleSave(){dirtySave=true;$('#saveState').textContent='Unsaved changes';$('#saveState').dataset.state='pending';clearTimeout(saveTimer);saveTimer=setTimeout(saveNow,350);}
function saveNow(){clearTimeout(saveTimer);const project=store.project,revision=store.revision,record=createWorkspaceRecord(project);$('#saveState').textContent='Saving locally…';$('#saveState').dataset.state='pending';saveQueue=saveQueue.catch(()=>{}).then(()=>persistWorkspace(project,record)).then(backend=>{if(store.revision===revision){dirtySave=false;$('#saveState').dataset.state='saved';$('#saveState').textContent=`Saved locally · ${backend}`;}return backend;}).catch(err=>{$('#saveState').textContent='Storage unavailable · export project';$('#saveState').dataset.state='error';toast(`Local save failed: ${err.message}`,true);});return saveQueue;}
window.addEventListener('pagehide',()=>{if(dirtySave){try{checkpointWorkspace(store.project);}catch{}}});
function applyAnalysis(result,revision,elapsed){if(revision!==store.revision)return;state.analysis=result;state.analysisRevision=revision;state.analysisMs=elapsed;renderDock();if(!$('#inspectorContent').contains(document.activeElement))renderInspector();rebuildScene();$('#graphStatus').textContent=`${result.stats.nets} nets · live`;}
function dispatchAnalysis(){
  analysisPending=true;if(inflight)return;analysisPending=false;
  if(worker){inflight=true;worker.postMessage({project:store.project,revision:store.revision});}
  else{const start=performance.now();applyAnalysis(analyzeProject(store.project),store.revision,performance.now()-start);}
}
try{worker=new Worker(new URL('./analysis-worker.js',import.meta.url),{type:'module'});worker.onmessage=({data})=>{inflight=false;if(data.error)toast(`Rule analysis failed: ${data.error}`,true);else applyAnalysis(data.result,data.revision,data.elapsed);if(analysisPending)dispatchAnalysis();};worker.onerror=event=>{event.preventDefault();worker?.terminate();worker=null;inflight=false;dispatchAnalysis();toast('Worker unavailable; analysis is running on the main thread.');};}catch{worker=null;}
function ensureAnalysis(){if(state.analysisRevision!==store.revision){const start=performance.now();state.analysis=analyzeProject(store.project);state.analysisRevision=store.revision;state.analysisMs=performance.now()-start;}return state.analysis;}
store.subscribe(event=>{
  if(!store.project.pages[state.pageId])state.pageId=orderedPages(store.project)[0].id;
  state.selection=new Set([...state.selection].filter(id=>store.project.placements[id]||store.project.connections[id]));
  renderNavigation();renderPageTabs();renderInspector();rebuildScene();updateControls();if(event.patches.some(p=>['symbols','macros'].includes(p.col))||event.label==='Open project')renderLibrary();
  $('#titleProject').textContent=store.project.name;document.title=`${store.project.name} · VoltWeave`;
  $('#statusMessage').textContent=`${event.label} · revision ${event.revision}`;
  scheduleSave();clearTimeout(analysisTimer);analysisTimer=setTimeout(dispatchAnalysis,40);
});

const commandInfo={
  new:['new','New project','Ctrl+N'],open:['folder','Open project','Ctrl+O'],save:['save','Save project file','Ctrl+S'],addPage:['page','Add schematic page',''],duplicatePage:['copy','Duplicate current page',''],deletePage:['trash','Delete current page',''],demo:['folder','Load conveyor example',''],
  undo:['undo','Undo','Ctrl+Z'],redo:['redo','Redo','Ctrl+Shift+Z'],select:['cursor','Select','V'],wire:['wire','Draw connection','W'],pan:['pan','Pan','H'],symbol:['symbol','Insert symbol',''],rotate:['rotate','Rotate 90°','R'],delete:['trash','Delete selection','Del'],copy:['copy','Copy circuit','Ctrl+C'],paste:['copy','Paste circuit','Ctrl+V'],duplicate:['copy','Duplicate selection','Ctrl+D'],selectAll:['cursor','Select all on page','Ctrl+A'],properties:['device','Edit properties','Enter'],
  fit:['fit','Fit page','F'],zoomIn:['plus','Zoom in','+'],zoomOut:['minus','Zoom out','−'],grid:['grid','Toggle grid','G'],snap:['magnet','Toggle snapping','X'],focus:['expand','Focus workspace',''],showNumbers:['number','Toggle wire labels',''],showRefs:['link','Toggle cross-references',''],
  number:['number','Number connections',''],erc:['check','Run electrical rule check','Ctrl+Shift+E'],bom:['table','Bill of materials',''],terminals:['terminal','Terminal strip navigator',''],plc:['device','PLC I/O assignments',''],cables:['cable','Cable navigator',''],newStrip:['terminal','Create terminal strip',''],newCable:['cable','Define cable',''],assignCable:['cable','Assign selected wires to cable',''],route:['wire','Edit wire route',''],autoRoute:['wire','Reset automatic route',''],
  macro:['copy','Create reusable circuit macro',''],customSymbol:['symbol','Create / edit symbol JSON',''],importSymbols:['folder','Import symbol library',''],exportSymbols:['export','Export custom symbols',''],reference:['link','Place linked function representation',''],exportSVG:['export','Export current sheet as SVG',''],exportCSV:['export','Export active report as CSV',''],documentation:['report','Generate engineering documentation',''],help:['help','Help & shortcuts',''],command:['search','Search commands','Ctrl+K']
};
const menus={project:['new','open','save',null,'addPage','duplicatePage','deletePage',null,'demo'],edit:['undo','redo',null,'copy','paste','duplicate','delete','selectAll','properties'],view:['fit','zoomIn','zoomOut','grid','snap','showNumbers','showRefs','focus'],insert:['symbol','wire','newStrip','newCable',null,'macro','customSymbol','importSymbols','reference'],engineering:['number','erc','autoRoute','route',null,'assignCable','terminals','cables','plc','bom'],reports:['documentation','exportSVG','exportCSV','exportSymbols']};
function ribbonButton(action,label,small=false,accent=false){const [i,title,key]=commandInfo[action];return `<button class="ribbon-button${small?' small':''}${accent?' accent':''}" data-action="${action}" title="${e(title+(key?' · '+key:''))}">${icon(i)}<span>${e(label||title)}</span></button>`;}
function ribbonGroup(title,content){return `<div class="ribbon-group">${content}<span class="ribbon-group-label">${title}</span></div>`;}
function renderRibbon(){
  let content='';const b=ribbonButton,g=ribbonGroup;
  if(state.ribbon==='home')content=g('PROJECT',b('new','New')+b('open','Open')+b('save','Save',false,true))+g('HISTORY',`<div class="ribbon-small-stack">${b('undo','Undo',true)}${b('redo','Redo',true)}</div>`)+g('EDIT',b('select','Select')+b('wire','Connection',false,true)+b('symbol','Symbol')+b('rotate','Rotate'))+g('WORKSPACE',b('fit','Fit page')+`<div class="ribbon-small-stack">${b('grid','Grid',true)}${b('snap','Snap',true)}</div>`)+g('ENGINEERING',b('number','Number wires',false,true)+b('erc','Check project',false,true))+g('DOCUMENTATION',b('bom','Parts list')+b('documentation','Reports'));
  if(state.ribbon==='insert')content=g('SCHEMATIC',b('symbol','Symbol',false,true)+b('wire','Connection')+b('addPage','New page'))+g('DEVICES',b('newStrip','Terminal strip')+b('newCable','Cable')+b('reference','Reference view'))+g('REUSABLE CONTENT',b('macro','Circuit macro')+b('customSymbol','Symbol editor')+b('importSymbols','Import library'))+g('EDIT',b('rotate','Rotate')+b('duplicate','Duplicate')+b('delete','Delete'));
  if(state.ribbon==='data')content=g('DEVICE NAVIGATORS',b('terminals','Terminals',false,true)+b('cables','Cables')+b('plc','PLC I/O')+b('bom','Parts list'))+g('CONNECTIONS',b('number','Number wires')+b('assignCable','Assign cable')+b('autoRoute','Auto route')+b('route','Edit route'))+g('DISPLAY',b('showNumbers','Wire labels')+b('showRefs','Cross-references'));
  if(state.ribbon==='review')content=g('VALIDATE',b('erc','Check project',false,true)+b('properties','Properties'))+g('EXPORT',b('documentation','Documentation',false,true)+b('exportSVG','Sheet SVG')+b('exportCSV','Report CSV')+b('save','Project JSON')+b('exportSymbols','Symbol JSON'))+g('WORKSPACE',b('focus','Focus')+b('help','Help'));
  $('#ribbonCommands').innerHTML=content;$$('[data-ribbon]').forEach(b=>b.classList.toggle('active',b.dataset.ribbon===state.ribbon));updateControls();
}
function renderNavigation(){
  const p=store.project,query=$('#navSearch').value.trim().toLowerCase();
  $$('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===state.nav));
  let content=`<div class="tree-project">${icon('folder')}<span>${e(p.name)}</span></div>`;
  if(state.nav==='pages'){
    content+=`<div class="tree-group">${icon('chevron')} =MCC · MAIN CONTROL CABINET</div>`;
    content+=orderedPages(p).filter(page=>`${page.number} ${page.name} ${page.structure}`.toLowerCase().includes(query)).map(page=>`<button class="page-row ${page.id===state.pageId?'active':''}" data-page="${page.id}" title="Open schematic page ${e(page.number)}"><span class="page-number">${e(page.number)}</span><span><strong>${e(page.name)}</strong><small>SCHEMATIC · ${e(page.structure)}</small></span><span class="row-dots">···</span></button>`).join('');
  }else{
    content+=`<div class="tree-group">${Object.keys(p.devices).length} PHYSICAL DEVICES · UUID IDENTITIES</div>`;
    content+=Object.values(p.devices).filter(d=>`${d.tag} ${d.description} ${d.part}`.toLowerCase().includes(query)).sort((a,b)=>a.tag.localeCompare(b.tag,undefined,{numeric:true})).map(d=>`<button class="device-row" data-device="${d.id}">${icon('device')}<span><strong>${e(d.tag)}</strong><small>${e(d.description)}</small></span><em>${store.xrefs.get(d.id).length}↗</em></button>`).join('');
  }
  $('#projectTree').innerHTML=content;
}
function renderPageTabs(){
  $('#pageTabs').innerHTML=orderedPages(store.project).map(page=>`<button class="page-tab ${page.id===state.pageId?'active':''}" data-page="${page.id}">${icon('page')}<small>${e(page.number)}</small>${e(page.name)}</button>`).join('')+`<button class="add-tab" data-action="addPage" title="New page">${icon('plus')}</button>`;
  $('#pageStructure').textContent=currentPage().structure;$('#pageBreadcrumb').textContent=currentPage().name;
}
const thumbs=new Map();
function thumbnail(def){
  const fingerprint=JSON.stringify(def);if(thumbs.has(fingerprint))return thumbs.get(fingerprint);
  const scene=new DrawList();symbolPrimitives(scene,def,{x:0,y:0,rotation:0});const b=def.bounds,pad=10;
  const lines=scene.segments.map(s=>`<path d="M${s.x1} ${s.y1}L${s.x2} ${s.y2}"/>`).join('');
  const text=scene.texts.map(t=>`<text x="${t.x}" y="${t.y}" font-size="${t.size}" text-anchor="middle" fill="#698594" stroke="none">${e(t.text)}</text>`).join('');
  const out=`<svg viewBox="${b[0]-pad} ${b[1]-pad} ${b[2]-b[0]+pad*2} ${b[3]-b[1]+pad*2}" fill="none" stroke="#638695" stroke-width="2.3" stroke-linecap="round">${lines}${text}</svg>`;thumbs.set(fingerprint,out);return out;
}
function renderLibrary(){
  const library=Object.values(symbols(store.project)),selected=$('#symbolCategory').value;
  $('#symbolCategory').innerHTML='<option value="">All categories</option>'+[...new Set(library.map(s=>s.category||'Custom'))].sort().map(c=>`<option value="${e(c)}">${e(c)}</option>`).join('')+'<option value="Macros">Circuit macros</option>';
  $('#symbolCategory').value=selected;const query=$('#symbolSearch').value.toLowerCase(),category=$('#symbolCategory').value;
  $('#symbolCount').textContent=library.length;
  const names={breaker3:'Breaker 3P',contactor3:'Contactor 3P',overload3:'Overload',breaker:'Breaker 1P',contactNO:'Contact NO',contactNC:'Contact NC',pushNO:'Push NO',pushNC:'Push NC',motor3:'Motor 3~',potential:'Potential',supply:'Power supply',plc:'PLC 4+4 I/O',terminal:'Terminal',earth:'Earth',junction:'Junction',estop:'E-stop',coil:'Relay coil',lamp:'Pilot light'};
  let html=library.filter(s=>(!category||s.category===category)&&`${s.name} ${s.category}`.toLowerCase().includes(query)).map(s=>`<button class="symbol-tile" data-symbol="${e(s.id)}" title="Insert ${e(s.name)}">${thumbnail(s)}<span>${e(names[s.id]||s.name)}</span></button>`).join('');
  if(!category||category==='Macros')html+=Object.values(store.project.macros).filter(m=>m.name.toLowerCase().includes(query)).map(m=>`<button class="symbol-tile" data-macro="${m.id}" title="Place ${e(m.name)}">${icon('copy')}<span>${e(m.name)}</span></button>`).join('');
  $('#symbolLibrary').innerHTML=html||'<div class="empty-list">No matching symbols.</div>';updateControls();
}
function field(label,bind,value,type='text',options={}){
  let input='';const attrs=`data-bind="${bind}"`;
  if(type==='select')input=`<select ${attrs}>${(options.items||[]).map(o=>`<option value="${e(o.value)}" ${String(o.value)===String(value)?'selected':''}>${e(o.label)}</option>`).join('')}</select>`;
  else if(type==='textarea')input=`<textarea ${attrs}>${e(value)}</textarea>`;
  else if(type==='checkbox')input=`<input type="checkbox" ${attrs} ${value?'checked':''}>`;
  else input=`<input type="${type}" ${attrs} value="${e(value)}" ${options.step?`step="${options.step}"`:''}>`;
  return `<label class="property-field"><span>${e(label)}</span>${input}</label>`;
}
function section(title,content){return `<section class="property-section"><h3>${title}</h3>${content}</section>`;}
function physicalSummary(d,symbol){return `<div class="property-hero"><div class="property-type">${icon('device')}${e(symbol.name)}</div><h2>${e(d?.tag||symbol.name)}</h2><p>${e(d?.description||'Semantic connection function')}</p>${d?`<div class="identity">${icon('link')}UUID ${d.id.slice(0,18)}…</div>`:''}</div>`;}
function renderInspector(){
  const p=store.project,s=currentPlacement(),w=currentWire();let html='';
  if(state.selection.size>1)html=`<div class="property-hero"><div class="property-type">${icon('cursor')}MULTIPLE SELECTION</div><h2>${state.selection.size} objects</h2><p>Drag symbols together. Connections retain their semantic endpoints.</p><div class="inspector-actions"><button class="small-button" data-action="macro">${icon('copy')}Create macro</button><button class="small-button" data-action="assignCable">${icon('cable')}Assign cable</button></div></div>`;
  if(s){
    const f=p.functions[s.functionId],d=p.devices[f.deviceId],symbol=getSymbol(p,f.symbolId);html+=physicalSummary(d,symbol);
    if(d){html+=section('PHYSICAL DEVICE',field('Device tag','device:tag',d.tag)+field('Description','device:description',d.description)+field('Part / article number','device:part',d.part)+field('Manufacturer','device:manufacturer',d.manufacturer)+field('Technical rating','device:rating',d.rating)+field('Installation location','device:location',d.location));
      html+=section('FUNCTION IDENTITY',field('Link to physical device','function:deviceId',d.id,'select',{items:Object.values(p.devices).map(device=>({value:device.id,label:`${device.tag} · ${device.description}`}))})+field('Function-specific description','function:description',f.properties.description||'')+`<p class="field-help">A shared device UUID links the coil and its auxiliary contacts. Tags remain editable display properties.</p><div class="inspector-actions"><button class="small-button" data-action="reference">${icon('link')}Reference view</button></div>`);
      if(f.symbolId==='terminal')html+=section('TERMINAL STRIP',field('Strip','device:stripId',d.stripId||'','select',{items:[{value:'',label:'Not assigned'},...Object.values(p.strips).map(strip=>({value:strip.id,label:strip.tag}))]})+field('Terminal position','device:terminalPosition',d.terminalPosition||''));
    }else if(['potential','earth'].includes(f.symbolId))html+=section('POTENTIAL DEFINITION',field('Potential / interruption name','function:net',f.properties.net||'')+field('Connection scope','function:scope',f.properties.scope||'project','select',{items:[{value:'project',label:'Project-wide'},{value:'location',label:'Installation location'}]})+field('Scope location','function:location',f.properties.location||'+CP1')+`<p class="field-help">Identically named points in this scope connect across sheets. Crossing drawn wires does not create a junction.</p>`);
    html+=section('PLACEMENT',`<div class="field-row">${field('X coordinate','placement:x',s.x,'number',{step:p.settings.grid})}${field('Y coordinate','placement:y',s.y,'number',{step:p.settings.grid})}</div>`+field('Rotation','placement:rotation',s.rotation,'select',{items:[0,90,180,270].map(n=>({value:n,label:`${n}°`}))}));
    html+=section('CONNECTION POINTS · SPARE',symbol.pins.map(def=>{const pin=p.pins[f.pins[def.key]];return `<div class="pin-editor"><span title="${e(def.type||'passive')}">${e(def.key)}</span><input type="text" data-pin-label="${pin.id}" value="${e(pin.label)}" aria-label="Terminal ${e(def.key)} designation"><input type="checkbox" data-pin-spare="${e(def.key)}" ${f.properties.unusedPins?.includes(def.key)?'checked':''} title="Intentionally unused" aria-label="${e(def.key)} intentionally unused"></div>`;}).join('')+`<p class="field-help">Checkbox marks an intentionally unused connection point. Pin UUIDs are unaffected by terminal renaming.</p>`);
    if(d){const refs=store.xrefs.get(d.id).filter(r=>r.placementId!==s.id);html+=section('CROSS-REFERENCES',refs.map(r=>`<button class="reference-button" data-goto="${r.placementId}" data-goto-page="${r.pageId}">${icon('link')}<strong>${e(r.text)}</strong><span>${e(getSymbol(p,r.symbol).name.split(' · ')[0])}</span></button>`).join('')||'<p class="field-help">No other representations of this physical device.</p>');}
  }else if(w){const net=state.analysis.nets.find(n=>n.id===state.analysis.netOf[w.from]);
    html+=`<div class="property-hero"><div class="property-type">${icon('wire')}CONNECTION PROPERTIES</div><h2>${e(w.number||'Unnumbered wire')}</h2><p>${e(endpointName(p,w.from))}<br>→ ${e(endpointName(p,w.to))}</p><div class="identity">${icon('link')}UUID ${w.id.slice(0,18)}…</div></div>`;
    html+=section('CONDUCTOR',field('Wire number','wire:number',w.number)+field('Lock wire number','wire:locked',w.locked,'checkbox')+`<div class="field-row">${field('Cross-section (mm²)','wire:crossSection',w.crossSection,'number',{step:'0.1'})}${field('Drawing color','wire:color',w.color,'color')}</div>`);
    html+=section('CABLE ASSIGNMENT',field('Cable','wire:cableId',w.cableId||'','select',{items:[{value:'',label:'Single conductor'},...Object.values(p.cables).map(c=>({value:c.id,label:`${c.tag} · ${c.cores} cores`}))]})+field('Core number','wire:core',w.core)+`<div class="inspector-actions"><button class="small-button" data-action="newCable">Define cable</button></div>`);
    html+=section('SEMANTIC NET',`<span class="net-badge">${net?.pins.length||0} connection points</span>${(net?.labels||[]).map(l=>`<span class="net-badge">${e(l)}</span>`).join('')}<p class="field-help">All connected conductors are highlighted across this sheet. Drawing coordinates never determine connectivity.</p>`);
    html+=section('ROUTING',`<p class="field-help">${w.route.waypoints.length} manual bends · ${renderer.scene?.routeFailures.includes(w.id)?'Obstacle route needs review':'Orthogonal router active'}</p><div class="inspector-actions"><button class="small-button" data-action="route">Edit bends</button><button class="small-button" data-action="autoRoute">Reset route</button></div>`);
  }else{
    const a=state.analysis.stats;html+=`<div class="property-hero"><div class="property-type">${icon('folder')}PROJECT OVERVIEW</div><h2>Every connection<br>has a purpose.</h2><p>One connected project. Independent device identities. Live engineering data.</p></div>`;
    html+=section('PROJECT HEALTH',`<div class="mini-stat-grid"><div class="mini-stat"><strong>${a.devices}</strong><span>PHYSICAL DEVICES</span></div><div class="mini-stat"><strong>${a.wires}</strong><span>CONNECTIONS</span></div><div class="mini-stat"><strong>${a.nets}</strong><span>ELECTRICAL NETS</span></div><div class="mini-stat"><strong>${a.errors}</strong><span>RULE ERRORS</span></div></div>`);
    html+=section('PROJECT INFORMATION',field('Project name','project:name',p.name)+field('Engineer','project:author',p.author)+field('Revision','project:revision',p.revision));
    html+=section('CURRENT SHEET',field('Page number','page:number',currentPage().number)+field('Page title','page:name',currentPage().name)+field('Structure identifier','page:structure',currentPage().structure)+`<div class="inspector-actions"><button class="small-button" data-action="duplicatePage">${icon('copy')}Duplicate</button><button class="small-button" data-action="addPage">${icon('plus')}Add page</button></div>`);
    html+=section('WORKFLOW',`<p class="field-help">Choose a symbol in the insert center, then click the sheet. Press <b>W</b> to connect pins. Select a coil or contact to navigate its device cross-references.</p><div class="inspector-actions"><button class="small-button" data-action="help">Keyboard shortcuts</button></div>`);
  }
  const scroll=$('#inspectorContent').scrollTop;$('#inspectorContent').innerHTML=html;$('#inspectorContent').scrollTop=scroll;
}
function setDock(kind){state.dock=kind;$('#reportSearch').value='';ensureAnalysis();renderDock();}
function renderDock(){
  const a=state.analysis,kind=state.dock,query=$('#reportSearch').value.toLowerCase(),all=reportRows(store.project,a,kind),rows=all.filter(row=>JSON.stringify(row).toLowerCase().includes(query));
  $('#issueCount').textContent=a.issues.length;$$('[data-dock]').forEach(b=>b.classList.toggle('active',b.dataset.dock===kind));
  $('#dockSummary').textContent=kind==='issues'?`${a.stats.errors} errors · ${a.stats.warnings} warnings · ${state.analysisMs.toFixed(1)} ms analysis`:`${all.length} ${kind==='bom'?'articles':kind==='plc'?'channels':'entries'}${rows.length!==all.length?` · ${rows.length} matching`:''}`;
  $('#dockExtra').innerHTML=kind==='terminals'?'<button class="small-button" data-action="newStrip">+ Strip</button>':kind==='cables'?'<button class="small-button" data-action="newCable">+ Cable</button>':kind==='connections'?'<button class="small-button" data-action="number">Number</button>':kind==='issues'?'<button class="small-button" data-action="erc">Run checks</button>':'';
  if(!rows.length){$('#dockContent').innerHTML=`<div class="empty-data"><div class="empty-icon">${icon(kind==='issues'?'check':'table')}</div><div><strong>${kind==='issues'&&!a.issues.length?'Implemented electrical checks passed':'No matching entries'}</strong><small>${kind==='issues'&&!a.issues.length?`${a.stats.devices} physical devices · ${a.stats.wires} connections · ${a.stats.nets} nets. Rule checks are advisory.`:'Engineering reports update from the live project model.'}</small></div></div>`;return;}
  const cols=REPORT_COLUMNS[kind];
  const html=`<table class="data-table"><thead><tr>${cols.map(c=>`<th>${e(c.label).toUpperCase()}</th>`).join('')}</tr></thead><tbody>${rows.slice(0,1500).map(row=>{
    const target=row.placementId||row.objectId||row.connectionId||(kind==='connections'?row.id:null);
    return `<tr ${target?`data-target="${e(target)}" data-target-page="${e(row.pageId||'')}" title="Click to locate on schematic"`:''}>${cols.map(c=>{
      let value=Array.isArray(row[c.key])?row[c.key].join(', '):row[c.key];let content=e(value);
      if(kind==='issues'&&c.key==='severity')content=`<span class="severity ${e(value)}">${e(value.toUpperCase())}</span>`;
      if(kind==='plc'&&['address','signal','description'].includes(c.key))content=`<input value="${e(value)}" data-plc-function="${row.functionId}" data-plc-channel="${e(row.channel)}" data-plc-key="${c.key}" aria-label="${e(row.device)} ${e(row.channel)} ${c.label}">`;
      if(kind==='terminals'&&c.key==='position')content=`<input value="${e(value)}" data-terminal-position="${row.deviceId}" aria-label="${e(row.tag)} terminal position">`;
      if(kind==='cables'&&c.key==='core'&&row.connectionId)content=`<input value="${e(value)}" data-core-wire="${row.connectionId}" aria-label="${e(row.tag)} core number">`;
      return `<td class="${['number','address','part','tag','code'].includes(c.key)?'mono':''}" title="${e(value)}">${content}</td>`;
    }).join('')}</tr>`;
  }).join('')}</tbody></table>${rows.length>1500?'<div class="empty-list">Showing the first 1,500 rows. CSV export includes the complete report.</div>':''}`;
  $('#dockContent').innerHTML=html;
}
function updateProperty(bind,input){
  const [kind,key]=bind.split(':'),s=currentPlacement(),w=currentWire(),value=input.type==='checkbox'?input.checked:input.value;
  store.edit(`Edit ${key}`,p=>{
    if(kind==='project'){p[key]=value;return;}
    if(kind==='page'){p.pages[state.pageId][key]=value;return;}
    if(kind==='placement'&&s){p.placements[s.id][key]=Number(value);return;}
    if(kind==='device'&&s){const d=p.devices[p.functions[s.functionId].deviceId];d[key]=value;
      if(key==='stripId'||key==='terminalPosition'){if(!d.stripId)d.stripId=null;const strip=p.strips[d.stripId];if(strip&&d.terminalPosition)d.tag=`${strip.tag}:${d.terminalPosition}`;}return;}
    if(kind==='function'&&s){if(key==='deviceId')rebindDevice(p,s.functionId,value);else p.functions[s.functionId].properties[key]=value;return;}
    if(kind==='wire'&&w){p.connections[w.id][key]=key==='cableId'?(value||null):value;if(key==='number')p.connections[w.id].locked=!!value;return;}
  });
}
function formField(label,name,value='',type='text',extra=''){return `<label class="property-field"><span>${e(label)}</span><input name="${name}" type="${type}" value="${e(value)}" ${extra}></label>`;}
function formSelect(label,name,items,value=''){return `<label class="property-field"><span>${e(label)}</span><select name="${name}">${items.map(item=>`<option value="${e(item.value)}" ${String(item.value)===String(value)?'selected':''}>${e(item.label)}</option>`).join('')}</select></label>`;}
function showDialog(title,body,handler,{submit='Apply',wide=false}={}){
  $('#dialogTitle').textContent=title;$('#dialogBody').innerHTML=body;$('#dialogSubmit').textContent=submit;$('#dialogSubmit').hidden=!handler;$('#dialogCancel').textContent=handler?'Cancel':'Close';$('#dialog').classList.toggle('wide',wide);dialogHandler=handler;if(!$('#dialog').open)$('#dialog').showModal();
  setTimeout(()=>$('#dialogBody').querySelector('input,textarea,select')?.focus(),0);
}
function showMenu(kind,anchor){
  const list=menus[kind];if(!list)return;const rect=anchor.getBoundingClientRect();$('#menuPopup').innerHTML=list.map(action=>action?`<button data-action="${action}">${icon(commandInfo[action][0])}${e(commandInfo[action][1])}<kbd>${e(commandInfo[action][2])}</kbd></button>`:'<hr>').join('');
  $('#menuPopup').hidden=false;$('#menuPopup').style.left=`${Math.min(rect.left,window.innerWidth-245)}px`;$('#menuPopup').style.top=`${rect.bottom+3}px`;
}
function showContextMenu(clientX,clientY){$('#menuPopup').innerHTML=['properties','wire','rotate','duplicate','copy','paste','route','reference','delete'].map(a=>`<button data-action="${a}">${icon(commandInfo[a][0])}${e(commandInfo[a][1])}<kbd>${e(commandInfo[a][2])}</kbd></button>`).join('');$('#menuPopup').hidden=false;$('#menuPopup').style.left=`${Math.min(clientX,innerWidth-245)}px`;$('#menuPopup').style.top=`${Math.min(clientY,innerHeight-355)}px`;}
const actions={
  new(){showDialog('New electrical project',formField('Project name','name','Untitled electrical project','text','required maxlength="200"')+formField('Engineer','author','Engineering')+'<p>Your current workspace will be replaced. Export it first to keep a separate project file.</p>',data=>{const p=emptyProject(data.get('name'));p.author=data.get('author');addPage(p,'Schematic');store.replace(p);setPage(orderedPages(p)[0].id);},{submit:'Create project'});},
  open(){$('#projectFile').click();},
  save(){downloadFile(`${safeFile(store.project.name)}.vw.json`,JSON.stringify(store.project,null,2));saveNow();toast('Project source exported with persistent device and pin identities.');},
  demo(){showDialog('Load the conveyor example','<p>Load the three-page motor power, relay control, and PLC project. The current workspace will be replaced; export it first to keep a separate copy.</p>',()=>{const p=createDemo();store.replace(p);setPage(orderedPages(p)[0].id);},{submit:'Load example'});},
  addPage(){const number=Math.max(0,...Object.values(store.project.pages).map(p=>+p.number||0))+1;showDialog('Add schematic page',formField('Page number','number',number,'text','required')+formField('Page title','name','New schematic','text','required'),data=>{const id=store.edit('Add schematic page',p=>addPage(p,data.get('name'),data.get('number')));setPage(id);},{submit:'Add page'});},
  duplicatePage(){const page=currentPage(),ps=Object.values(store.project.placements).filter(s=>s.pageId===page.id),bundle=ps.length?captureBundle(store.project,ps.map(s=>s.id)):null;
    const id=store.edit('Duplicate schematic page',p=>{const id=addPage(p,`${page.name} · copy`);p.pages[id].notes=clone(page.notes);p.pages[id].structure=page.structure;if(bundle)insertBundle(p,id,bundle,Math.min(...ps.map(s=>s.x)),Math.min(...ps.map(s=>s.y)));return id;});setPage(id);},
  deletePage(){const page=currentPage();showDialog('Delete schematic page',`<p>Delete page <b>${e(page.number)} · ${e(page.name)}</b> and its placed functions? Unreferenced devices and incident wires are removed atomically. This can be undone.</p>`,()=>{store.edit('Delete page',p=>removePage(p,page.id));setPage(orderedPages(store.project)[0].id);},{submit:'Delete page'});},
  undo(){state.overrides={};store.undo();},redo(){state.overrides={};store.redo();},select(){setTool('select');},wire(){setTool('wire');},pan(){setTool('pan');},
  symbol(){showDialog('Insert an electrical symbol','<p>Choose a symbol, then click the schematic to place it. Press R to rotate and Escape to return to selection.</p><div class="symbol-library" style="grid-template-columns:repeat(6,1fr);max-height:390px;padding:0">'+Object.values(symbols(store.project)).map(s=>`<button type="button" class="symbol-tile" data-symbol="${e(s.id)}" title="${e(s.name)}">${thumbnail(s)}<span>${e(s.name)}</span></button>`).join('')+'</div>',null,{wide:true});},
  rotate(){if(['symbol','macro'].includes(state.tool)){state.rotation=(state.rotation+90)%360;updateGhost();return;}const ids=[...state.selection].filter(id=>store.project.placements[id]);if(!ids.length){toast('Select a symbol to rotate.');return;}store.edit('Rotate symbols',p=>{for(const id of ids)p.placements[id].rotation=(p.placements[id].rotation+90)%360;});},
  delete(){if(!state.selection.size)return;store.edit('Delete selected objects',p=>deleteSelection(p,[...state.selection]));state.selection.clear();selectionChanged();},
  copy(){state.clipboard=captureBundle(store.project,[...state.selection]);toast(`Copied ${state.clipboard.placements.length} symbols and their internal connections.`);},
  paste(){if(!state.clipboard)throw new Error('Copy a circuit selection first.');state.macro=state.clipboard;setTool('macro');},
  duplicate(){const ps=[...state.selection].map(id=>store.project.placements[id]).filter(Boolean),bundle=captureBundle(store.project,[...state.selection]);const ids=store.edit('Duplicate circuit',p=>insertBundle(p,state.pageId,bundle,Math.min(...ps.map(s=>s.x))+50,Math.min(...ps.map(s=>s.y))+50));state.selection=new Set(ids);selectionChanged();},
  selectAll(){state.selection=new Set(Object.values(store.project.placements).filter(s=>s.pageId===state.pageId).map(s=>s.id));selectionChanged();},
  fit(){renderer.fit();},zoomIn(){renderer.zoomAt(1.2);},zoomOut(){renderer.zoomAt(1/1.2);},grid(){renderer.showGrid=!renderer.showGrid;updateControls();renderer.requestDraw();},snap(){state.snap=!state.snap;updateControls();},focus(){document.body.classList.toggle('focus-mode');renderer.resize();renderer.fit();},showNumbers(){state.showNumbers=!state.showNumbers;updateControls();rebuildScene();},showRefs(){state.showRefs=!state.showRefs;updateControls();rebuildScene();},
  number(){showDialog('Automatic connection numbering',formField('Number prefix','prefix',store.project.settings.wirePrefix)+formField('Start number','start',store.project.settings.wireStart,'number','min="0" max="99999999" required')+formSelect('Numbering scheme','mode',[{value:'net',label:'Equipotential net (same number on connected conductors)'},{value:'connection',label:'Individual connection (one number per wire)'}])+`<label class="property-field"><span><input type="checkbox" name="renumber"> Renumber all unlocked connections</span></label><p>Locked numbers are retained. Existing numbers are reused when possible; conflicting locks are reported by the rule checker.</p>`,data=>{store.edit('Number connections',p=>numberConnections(p,{prefix:data.get('prefix'),start:Number(data.get('start')),mode:data.get('mode'),renumber:data.has('renumber')}));setDock('connections');},{submit:'Number connections'});},
  erc(){clearTimeout(analysisTimer);setDock('issues');dispatchAnalysis();toast('Electrical rule analysis requested for the current project revision.');},
  bom(){setDock('bom');},terminals(){setDock('terminals');},plc(){setDock('plc');},cables(){setDock('cables');},
  newStrip(){showDialog('Create a terminal strip',formField('Strip tag','tag',`-X${Object.keys(store.project.strips).length+1}`,'text','required')+formField('Description','description','Field terminals')+formField('Number of terminals to place','count',4,'number','min="1" max="24" required')+formField('Part / article','part','TERMINAL-2.5')+'<p>Feed-through terminals will be placed on the current sheet. Each terminal keeps a separate physical identity and two internally connected pins.</p>',data=>{const count=+data.get('count');if(!Number.isInteger(count)||count<1||count>24)throw new Error('Choose 1–24 terminals.');
      const ids=store.edit('Create terminal strip',p=>{const id=uid(),tag=data.get('tag');p.strips[id]={id,tag,description:data.get('description')};const out=[];for(let i=0;i<count;i++){const x=250+(i%10)*110,y=300+Math.floor(i/10)*170;out.push(addFunction(p,state.pageId,'terminal',x,y,{device:{tag:`${tag}:${i+1}`,stripId:id,terminalPosition:String(i+1),part:data.get('part'),description:data.get('description')}}).placementId);}return out;});state.selection=new Set(ids);setDock('terminals');selectionChanged();},{submit:'Create & place'});},
  newCable(){showDialog('Define a cable',formField('Cable tag','tag',`-W${Object.keys(store.project.cables).length+1}`,'text','required')+`<div class="field-row">${formField('Number of cores','cores',4,'number','min="1" max="1000" required')}${formField('Core cross-section (mm²)','crossSection','1.5','number','min="0.1" step="0.1" required')}</div>`+formField('Length (m)','length',1,'number','min="0" step="0.1"')+formField('Part / article','part','CABLE-4G1.5')+formField('Description','description','Field cable'),data=>{store.edit('Define cable',p=>{const id=uid();p.cables[id]={id,tag:data.get('tag'),cores:+data.get('cores'),crossSection:data.get('crossSection'),length:+data.get('length'),part:data.get('part'),description:data.get('description'),manufacturer:'Generic'};});setDock('cables');},{submit:'Create definition'});},
  assignCable(){const wires=[...state.selection].filter(id=>store.project.connections[id]);if(!wires.length)throw new Error('Select one or more wires first. Shift-click adds wires to the selection.');if(!Object.keys(store.project.cables).length)throw new Error('Define a cable first in Project data → Cables.');
    showDialog('Assign cable cores',formSelect('Cable','cableId',Object.values(store.project.cables).map(c=>({value:c.id,label:`${c.tag} · ${c.cores} cores`})))+formField('First core number','first',1,'number','min="1" required')+`<p>${wires.length} selected connection(s). Core numbers are assigned consecutively.</p>`,data=>{store.edit('Assign cable cores',p=>{const cable=p.cables[data.get('cableId')],first=+data.get('first');if(first+wires.length-1>cable.cores)throw new Error('The selected range exceeds the cable core count.');wires.forEach((id,i)=>{p.connections[id].cableId=cable.id;p.connections[id].core=String(first+i);p.connections[id].crossSection=cable.crossSection;});});setDock('cables');},{submit:'Assign cores'});},
  route(){const w=currentWire();if(!w)throw new Error('Select a wire to edit its route.');showDialog('Edit orthogonal route',`<p>One intermediate point per line, written as <b>x, y</b>. Endpoints always follow their persistent pins. Leave empty to use automatic routing.</p><textarea class="code" name="points" spellcheck="false">${e(w.route.waypoints.map(p=>`${p.x}, ${p.y}`).join('\n'))}</textarea>`,data=>{const text=data.get('points').trim(),points=text?text.split(/\n+/).map(line=>{const v=line.split(/[,;\s]+/).filter(Boolean).map(Number);if(v.length!==2||!v.every(Number.isFinite))throw new Error('Each line must contain exactly two finite coordinates.');return{x:v[0],y:v[1]};}):[];store.edit('Edit wire route',p=>p.connections[w.id].route.waypoints=points);});},
  autoRoute(){const selected=[...state.selection].filter(id=>store.project.connections[id]),ids=selected.length?selected:Object.values(store.project.connections).filter(w=>w.route.pageId===state.pageId).map(w=>w.id);store.edit('Reset automatic routing',p=>{for(const id of ids)p.connections[id].route.waypoints=[];});toast(`Automatic routing restored for ${ids.length} connection(s).`);},
  macro(){const bundle=captureBundle(store.project,[...state.selection]);showDialog('Create reusable circuit macro',formField('Macro name','name','Relay control circuit','text','required')+`<p>${bundle.placements.length} symbols and ${bundle.connections.length} internal wires. Each placement of this macro creates new device, function, and pin identities.</p>`,data=>{store.edit('Create reusable macro',p=>{const id=uid();p.macros[id]={id,name:data.get('name'),bundle};});$('#symbolCategory').value='Macros';renderLibrary();},{submit:'Save macro'});},
  customSymbol(){const selected=currentPlacement(),original=selected?getSymbol(store.project,store.project.functions[selected.functionId].symbolId):getSymbol(store.project,'coil'),definition=clone(original);if(!store.project.symbols[definition.id]){definition.id=`custom${definition.id[0].toUpperCase()}${definition.id.slice(1)}`;definition.name=`Custom ${definition.name}`;definition.category='Custom';}
    showDialog('Declarative symbol editor',`<p>Geometry and connection points are JSON data—not executable code. Supported primitives: line, rect, circle, dot, text. Internal pin groups define permanent conductive bonds.</p><textarea name="definition" class="code" spellcheck="false">${e(JSON.stringify(definition,null,2))}</textarea><p>When changing the pins of an in-use symbol, create a new symbol ID. Existing pin identities are never silently replaced.</p>`,data=>{const def=validateSymbol(JSON.parse(data.get('definition')));store.edit('Save reusable symbol',p=>{p.symbols[def.id]=def;});state.symbolId=def.id;setTool('symbol');},{submit:'Save & place',wide:true});},
  importSymbols(){$('#symbolFile').click();},exportSymbols(){downloadFile('voltweave-symbol-library.json',JSON.stringify({format:'voltweave/symbol-library',version:1,symbols:Object.values(store.project.symbols)},null,2));toast('Custom symbol library exported. Built-in definitions are included in the source code.');},
  reference(){const s=currentPlacement();if(!s)throw new Error('Select a symbol to place another representation of the same function.');showDialog('Place linked function representation',formSelect('Target schematic page','pageId',orderedPages(store.project).map(p=>({value:p.id,label:`${p.number} · ${p.name}`})),state.pageId)+`<div class="field-row">${formField('X coordinate','x',800,'number','required')}${formField('Y coordinate','y',450,'number','required')}</div><p>This creates another drawing of the exact same function and pins—not a second physical contact. To add a different auxiliary contact, insert a contact and link its device in Properties.</p>`,data=>{const id=store.edit('Place linked representation',p=>{const id=uid();p.placements[id]={id,functionId:s.functionId,pageId:data.get('pageId'),x:+data.get('x'),y:+data.get('y'),rotation:s.rotation};return id;});jumpTo(id,data.get('pageId'));},{submit:'Place reference'});},
  properties(){const s=currentPlacement(),w=currentWire();if(s){const f=store.project.functions[s.functionId],d=store.project.devices[f.deviceId];const body=(d?formField('Device tag','tag',d.tag)+formField('Description','description',d.description)+formField('Part / article','part',d.part)+formField('Rating','rating',d.rating):formField('Potential name','net',f.properties.net||''))+`<div class="field-row">${formField('X','x',s.x,'number','required')}${formField('Y','y',s.y,'number','required')}</div>`;
      showDialog('Symbol properties',body,data=>store.edit('Edit symbol properties',p=>{if(d){for(const key of ['tag','description','part','rating'])p.devices[d.id][key]=data.get(key);}else p.functions[f.id].properties.net=data.get('net');p.placements[s.id].x=+data.get('x');p.placements[s.id].y=+data.get('y');}));
    }else if(w){showDialog('Connection properties',formField('Wire number','number',w.number)+formField('Cross-section (mm²)','crossSection',w.crossSection,'number','min="0.1" step="0.1" required')+formField('Color','color',w.color,'color'),data=>store.edit('Edit connection properties',p=>{const wire=p.connections[w.id];wire.number=data.get('number');wire.locked=!!wire.number;wire.crossSection=data.get('crossSection');wire.color=data.get('color');}));}
    else showDialog('Project properties',formField('Project name','name',store.project.name,'text','required')+formField('Engineer','author',store.project.author)+formField('Revision','revision',store.project.revision)+formField('Sheet title','pageName',currentPage().name),data=>store.edit('Edit project properties',p=>{p.name=data.get('name');p.author=data.get('author');p.revision=data.get('revision');p.pages[state.pageId].name=data.get('pageName');}));},
  exportSVG(){downloadFile(`${safeFile(store.project.name)}-page-${safeFile(currentPage().number)}.svg`,sceneToSVG(buildScene(store.project,state.pageId,store.xrefs)),'image/svg+xml');toast('Current schematic exported as editable vector SVG.');},
  exportCSV(){const kind=state.dock,a=ensureAnalysis();downloadFile(`${safeFile(store.project.name)}-${kind}.csv`,csv(reportRows(store.project,a,kind),REPORT_COLUMNS[kind]),'text/csv;charset=utf-8');},
  documentation(){const content=generateDocumentation(store.project,ensureAnalysis());downloadFile(`${safeFile(store.project.name)}-documentation.html`,content,'text/html;charset=utf-8');toast('Standalone engineering document exported. Open it to print or save as PDF.');},
  dockExpand(){$('#dock').classList.toggle('expanded');$('#dock').style.height='';},
  command(){showDialog('Command palette','<input id="commandSearch" class="command-search" placeholder="Type a command, device, or page…" aria-label="Search commands"><div id="commandList" class="command-list"></div>',null,{wide:true});renderCommands('');},
  help(){showDialog('VoltWeave · Connected engineering',`<p>Build multi-page schematics with persistent device identities and a semantic graph independent of geometry. Every visible engineering table is generated from that model.</p><div class="keyboard-grid">${[['Select','V'],['Draw connection','W'],['Pan','H / Space'],['Rotate','R'],['Fit sheet','F'],['Grid / snap','G / X'],['Undo','Ctrl / ⌘ Z'],['Redo','Ctrl / ⌘ Shift Z'],['Save project','Ctrl / ⌘ S'],['Copy / paste circuit','Ctrl / ⌘ C / V'],['Select all','Ctrl / ⌘ A'],['Duplicate','Ctrl / ⌘ D'],['Command palette','Ctrl / ⌘ K'],['Object properties','Enter / double-click'],['Delete selection','Delete'],['Cancel placement / wire','Escape']].map(([label,key])=>`<div>${label}<kbd>${key}</kbd></div>`).join('')}</div><p><b>Connections:</b> press W, click a pin, optionally add bends on blank space, then click another pin. Clicking an existing wire explicitly creates a junction. Crossings alone never connect. Shift-click selects multiple objects.</p><p><b>Device references:</b> insert a coil/contact and choose its shared physical device in Properties. Use “Reference view” only for another representation of the same function and pins.</p><p><b>Persistence:</b> the active workspace autosaves locally. Project → Save exports portable JSON. Reports exports a standalone HTML document containing vector sheets and all schedules; use its Print button for PDF.</p><p><b>Renderer:</b> WebGPU batches anti-aliased line segments; Canvas layers render typography and paper. A labeled Canvas 2D fallback preserves editing when WebGPU is unavailable. No runtime dependencies or cloud services are used.</p><div class="notice">Independent implementation inspired by electrical-CAD workflows. Not affiliated with EPLAN. Native EPLAN formats are not supported. Rule checks are advisory, not certification, electrical simulation, or proof of a safe installation. The example is illustrative and must not be used as construction documentation without independent engineering review.</div>`,null,{wide:true});}
};
function renderCommands(query){const q=query.toLowerCase();let html=Object.entries(commandInfo).filter(([id,c])=>id!=='command'&&c[1].toLowerCase().includes(q)).map(([id,c])=>`<button type="button" data-action="${id}" data-from-command="true">${icon(c[0])}${e(c[1])}<small>${e(c[2])}</small></button>`).join('');if(q)html+=Object.values(store.project.devices).filter(d=>`${d.tag} ${d.description}`.toLowerCase().includes(q)).slice(0,20).map(d=>`<button type="button" data-device="${d.id}">${icon('device')}${e(d.tag)}<small>${e(d.description)}</small></button>`).join('');$('#commandList').innerHTML=html||'<div class="empty-list">No matching commands or devices.</div>';}
async function runAction(id){try{const action=actions[id];if(!action)throw new Error(`Unknown command: ${id}`);await action();}catch(error){toast(error.message,true);console.warn(error);}}
function hitTest(world){
  const radius=9/renderer.zoom,items=renderer.scene.index.query(world.x,world.y,radius);
  const pins=items.filter(i=>i.type==='pin').map(i=>({...i,distance:Math.hypot(i.x-world.x,i.y-world.y)})).filter(i=>i.distance<radius).sort((a,b)=>a.distance-b.distance);if(pins.length)return pins[0];
  const shapes=items.filter(i=>i.type==='symbol'&&world.x>=i.bounds.x1&&world.x<=i.bounds.x2&&world.y>=i.bounds.y1&&world.y<=i.bounds.y2);if(shapes.length)return shapes.at(-1);
  const wires=items.filter(i=>i.type==='wire').map(i=>({...i,distance:distanceToSegment(world,i.a,i.b)})).filter(i=>i.distance<7/renderer.zoom).sort((a,b)=>a.distance-b.distance);return wires[0]||null;
}
function endpointDescriptor(hit,world){
  if(hit?.type==='pin')return {type:'pin',placementId:hit.placementId,pinKey:hit.pinKey,pinId:hit.id};
  if(hit?.type==='wire'){
    const q=closestOnSegment(world,hit.a,hit.b);if(state.snap){if(Math.abs(hit.a.x-hit.b.x)<.1)q.y=Math.max(Math.min(hit.a.y,hit.b.y),Math.min(Math.max(hit.a.y,hit.b.y),snap(q.y,store.project.settings.grid)));else q.x=Math.max(Math.min(hit.a.x,hit.b.x),Math.min(Math.max(hit.a.x,hit.b.x),snap(q.x,store.project.settings.grid)));}
    return {type:'wire',wireId:hit.id,point:q,routePoints:clone(renderer.scene.routes.get(hit.id))};
  }return null;
}
function endpointPosition(descriptor){if(descriptor.type==='wire')return descriptor.point;const placement=store.project.placements[descriptor.placementId];return placement?pinPoint(store.project,placement,descriptor.pinKey):state.pointer;}
function resolveEndpoint(p,descriptor){if(descriptor.type==='pin')return descriptor;const junction=splitConnection(p,descriptor.wireId,descriptor.point,descriptor.routePoints);return {placementId:junction.placementId,pinKey:'J'};}
function wireClick(world,hit){
  const endpoint=endpointDescriptor(hit,world);
  if(!state.wireStart){if(!endpoint){toast('Begin a wire at a pin or an existing conductor.');return;}state.wireStart=endpoint;state.waypoints=[];updateHint();return;}
  if(!endpoint){state.waypoints.push(snapPoint(world));updateWirePreview(world);return;}
  if(endpoint.type==='pin'&&state.wireStart.type==='pin'&&endpoint.pinId===state.wireStart.pinId)return;
  if(endpoint.type==='wire'&&state.wireStart.type==='wire'&&endpoint.wireId===state.wireStart.wireId)throw new Error('Choose a different conductor or terminal.');
  const start=state.wireStart,waypoints=clone(state.waypoints),id=store.edit('Connect electrical terminals',p=>{const a=resolveEndpoint(p,start),b=resolveEndpoint(p,endpoint);return connect(p,a.placementId,a.pinKey,b.placementId,b.pinKey,{waypoints});});
  state.selection=new Set([id]);cancelWire();updateHint();selectionChanged();
}
function updateWirePreview(world,shift=false){
  if(!state.wireStart){renderer.overlay.preview=null;return;}
  const hit=hitTest(world),end=hit?.type==='pin'?{x:hit.x,y:hit.y}:snapPoint(world),anchors=[endpointPosition(state.wireStart),...state.waypoints,end],points=[anchors[0]];
  for(let i=1;i<anchors.length;i++){const a=anchors[i-1],b=anchors[i];points.push(shift?{x:b.x,y:a.y}:{x:a.x,y:b.y},b);}renderer.overlay.preview=points;renderer.requestDraw();
}
function transformBundle(bundle,rotation){if(!rotation)return bundle;const copy=clone(bundle),a=rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a),rotate=pt=>({x:Math.round((pt.x*c-pt.y*s)*1e6)/1e6,y:Math.round((pt.x*s+pt.y*c)*1e6)/1e6});for(const p of copy.placements){Object.assign(p,rotate(p));p.rotation=(p.rotation+rotation)%360;}for(const w of copy.connections)w.route.waypoints=w.route.waypoints.map(rotate);return copy;}
function updateGhost(){const world=snapPoint(state.pointer),scene=new DrawList();
  if(state.tool==='symbol')symbolPrimitives(scene,getSymbol(store.project,state.symbolId),{...world,rotation:state.rotation});
  else if(state.tool==='macro'&&state.macro){const bundle=transformBundle(state.macro,state.rotation);for(const placement of bundle.placements){const f=bundle.functions.find(f=>f.id===placement.functionId);symbolPrimitives(scene,getSymbol(store.project,f.symbolId),{...placement,x:placement.x+world.x,y:placement.y+world.y});}}
  renderer.overlay.ghost=scene;renderer.requestDraw();
}
const pointers=new Map();let gesture=null;
const screenEvent=event=>{const rect=$('#stage').getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};};
$('#stage').addEventListener('pointerdown',event=>{
  if(event.target.closest('button,.canvas-tools,.zoom-controls,.tool-hint'))return;
  try{
    $('#stage').focus({preventScroll:true});$('#menuPopup').hidden=true;
    const screen=screenEvent(event),world=renderer.world(screen);state.pointer=world;pointers.set(event.pointerId,screen);
    if(pointers.size===2){const [a,b]=[...pointers.values()],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};gesture={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom:renderer.zoom,anchor:renderer.world(mid)};state.drag=null;state.overrides={};renderer.overlay.marquee=null;rebuildScene();event.preventDefault();return;}
    if(event.button===2)return;
    if(event.button===1||state.space||state.tool==='pan'){state.drag={kind:'pan',screen,pan:{...renderer.pan}};$('#stage').setPointerCapture(event.pointerId);event.preventDefault();return;}
    const hit=hitTest(world);
    if(state.tool==='symbol'){const pt=snapPoint(world);if(pt.x<55||pt.x>currentPage().width-55||pt.y<125||pt.y>currentPage().height-115)throw new Error('Place symbols inside the schematic working area.');
      const inserted=store.edit('Insert electrical symbol',p=>addFunction(p,state.pageId,state.symbolId,pt.x,pt.y,{rotation:state.rotation}));state.selection=new Set([inserted.placementId]);selectionChanged();return;}
    if(state.tool==='macro'){const pt=snapPoint(world),bundle=transformBundle(state.macro,state.rotation),ids=store.edit('Insert circuit macro',p=>insertBundle(p,state.pageId,bundle,pt.x,pt.y));state.selection=new Set(ids);selectionChanged();return;}
    if(state.tool==='wire'){wireClick(world,hit);event.preventDefault();return;}
    const symbol=hit?.type==='pin'?{...hit,type:'symbol',id:hit.placementId}:hit;
    if(symbol?.type==='symbol'){
      if(event.shiftKey&&state.selection.has(symbol.id)){state.selection.delete(symbol.id);selectionChanged();return;}
      if(!state.selection.has(symbol.id)){if(!event.shiftKey)state.selection.clear();state.selection.add(symbol.id);}
      const originals=Object.fromEntries([...state.selection].filter(id=>store.project.placements[id]).map(id=>[id,clone(store.project.placements[id])]));state.drag={kind:'move',world,screen,originals,moved:false};selectionChanged();
    }else if(hit?.type==='wire'){
      if(!event.shiftKey)state.selection.clear();if(event.shiftKey&&state.selection.has(hit.id))state.selection.delete(hit.id);else state.selection.add(hit.id);selectionChanged();
    }else{
      const previous=event.shiftKey?new Set(state.selection):new Set();if(!event.shiftKey)state.selection.clear();state.drag={kind:'marquee',world,screen,previous,moved:false};selectionChanged();
    }
    if(state.drag)$('#stage').setPointerCapture(event.pointerId);event.preventDefault();
  }catch(error){toast(error.message,true);}
});
$('#stage').addEventListener('pointermove',event=>{
  const screen=screenEvent(event),world=renderer.world(screen);state.pointer=world;if(pointers.has(event.pointerId))pointers.set(event.pointerId,screen);
  if(gesture&&pointers.size>=2){const [a,b]=[...pointers.values()],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance=Math.hypot(a.x-b.x,a.y-b.y);renderer.zoom=Math.max(.08,Math.min(6,gesture.zoom*distance/gesture.distance));renderer.pan={x:mid.x-gesture.anchor.x*renderer.zoom,y:mid.y-gesture.anchor.y*renderer.zoom};renderer.requestDraw();return;}
  const grid=store.project.settings.grid;$('#coordinateStatus').textContent=`X ${snap(world.x,grid)} · Y ${snap(world.y,grid)}`;
  const drag=state.drag;
  if(drag?.kind==='pan'){renderer.pan={x:drag.pan.x+screen.x-drag.screen.x,y:drag.pan.y+screen.y-drag.screen.y};renderer.requestDraw();return;}
  if(drag?.kind==='move'){
    if(!drag.moved&&Math.hypot(screen.x-drag.screen.x,screen.y-drag.screen.y)<3)return;drag.moved=true;
    const delta={x:world.x-drag.world.x,y:world.y-drag.world.y};if(state.snap){delta.x=snap(delta.x,grid);delta.y=snap(delta.y,grid);}
    state.overrides=Object.fromEntries(Object.entries(drag.originals).map(([id,p])=>[id,{x:p.x+delta.x,y:p.y+delta.y}]));rebuildScene();return;
  }
  if(drag?.kind==='marquee'){drag.moved=Math.hypot(screen.x-drag.screen.x,screen.y-drag.screen.y)>3;renderer.overlay.marquee={x:Math.min(world.x,drag.world.x),y:Math.min(world.y,drag.world.y),w:Math.abs(world.x-drag.world.x),h:Math.abs(world.y-drag.world.y)};renderer.requestDraw();return;}
  const hit=hitTest(world);renderer.overlay.hover=hit?.type==='pin'?{x:hit.x,y:hit.y}:null;
  if(state.tool==='wire')updateWirePreview(world,event.shiftKey);else if(['symbol','macro'].includes(state.tool))updateGhost();else renderer.requestDraw();
});
function endPointer(event,cancelled=false){
  pointers.delete(event.pointerId);if(gesture){if(pointers.size<2)gesture=null;state.drag=null;return;}
  const drag=state.drag;state.drag=null;
  try{
    if(drag?.kind==='move'&&drag.moved&&!cancelled){const overrides=state.overrides;state.overrides={};store.edit('Move symbols',p=>{for(const [id,position]of Object.entries(overrides))Object.assign(p.placements[id],position);});}
    else if(drag?.kind==='marquee'&&drag.moved&&!cancelled){const b=renderer.overlay.marquee;state.selection=new Set(drag.previous);for(const [id,box]of renderer.scene.bounds)if(box.x1>=b.x&&box.x2<=b.x+b.w&&box.y1>=b.y&&box.y2<=b.y+b.h)state.selection.add(id);selectionChanged();}
  }catch(error){toast(error.message,true);}
  state.overrides={};renderer.overlay.marquee=null;if(drag?.kind==='move')rebuildScene();renderer.requestDraw();
  if($('#stage').hasPointerCapture(event.pointerId))$('#stage').releasePointerCapture(event.pointerId);
}
$('#stage').addEventListener('pointerup',event=>endPointer(event));$('#stage').addEventListener('pointercancel',event=>endPointer(event,true));
$('#stage').addEventListener('pointerleave',()=>{if(!state.drag){renderer.overlay.hover=null;renderer.overlay.ghost=null;renderer.requestDraw();}});
$('#stage').addEventListener('wheel',event=>{if(event.target.closest('.canvas-tools,.zoom-controls'))return;event.preventDefault();renderer.zoomAt(Math.exp(-Math.max(-250,Math.min(250,event.deltaY))*.0017),screenEvent(event));},{passive:false});
$('#stage').addEventListener('dblclick',event=>{if(event.target.closest('button'))return;if(state.tool==='select')runAction('properties');});
$('#stage').addEventListener('contextmenu',event=>{event.preventDefault();if(state.tool==='wire'){if(state.waypoints.length)state.waypoints.pop();else cancelWire();updateHint();return;}if(['symbol','macro'].includes(state.tool)){setTool('select');return;}showContextMenu(event.clientX,event.clientY);});
let dockDrag=null;
$('#dockResize').addEventListener('pointerdown',event=>{dockDrag={y:event.clientY,height:$('#dock').offsetHeight};event.target.setPointerCapture(event.pointerId);event.preventDefault();});
$('#dockResize').addEventListener('pointermove',event=>{if(dockDrag)$('#dock').style.height=`${Math.max(80,Math.min($('.editor').offsetHeight*.7,dockDrag.height+dockDrag.y-event.clientY))}px`;});
$('#dockResize').addEventListener('pointerup',()=>dockDrag=null);

// All UI writes go through the same validated transaction store.
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.action){event.preventDefault();$('#menuPopup').hidden=true;if(button.dataset.fromCommand)$('#dialog').close();runAction(button.dataset.action);return;}
  if(button.dataset.menu){event.preventDefault();showMenu(button.dataset.menu,button);return;}
  if(button.dataset.ribbon){state.ribbon=button.dataset.ribbon;renderRibbon();return;}
  if(button.dataset.nav){state.nav=button.dataset.nav;renderNavigation();return;}
  if(button.dataset.dock){setDock(button.dataset.dock);return;}
  if(button.dataset.page){event.preventDefault();setPage(button.dataset.page);return;}
  if(button.dataset.device){event.preventDefault();if($('#dialog').open)$('#dialog').close();const ref=store.xrefs.get(button.dataset.device)[0];if(ref)jumpTo(ref.placementId,ref.pageId);return;}
  if(button.dataset.symbol){event.preventDefault();if($('#dialog').open)$('#dialog').close();state.symbolId=button.dataset.symbol;state.rotation=0;setTool('symbol');return;}
  if(button.dataset.macro){state.macro=store.project.macros[button.dataset.macro].bundle;state.rotation=0;setTool('macro');return;}
  if(button.dataset.goto){jumpTo(button.dataset.goto,button.dataset.gotoPage);}
});
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#menuPopup,[data-menu]'))$('#menuPopup').hidden=true;});
$('#dockContent').addEventListener('click',event=>{if(event.target.closest('input,select,button'))return;const row=event.target.closest('[data-target]');if(row)jumpTo(row.dataset.target,row.dataset.targetPage);});
document.addEventListener('change',event=>{
  const input=event.target;
  try{
    if(input.dataset.bind){updateProperty(input.dataset.bind,input);return;}
    if(input.dataset.pinLabel){store.edit('Rename terminal designation',p=>p.pins[input.dataset.pinLabel].label=input.value);return;}
    if(input.dataset.pinSpare){const s=currentPlacement();if(!s)return;store.edit('Set spare connection point',p=>{const f=p.functions[s.functionId],keys=new Set(f.properties.unusedPins||[]);input.checked?keys.add(input.dataset.pinSpare):keys.delete(input.dataset.pinSpare);f.properties.unusedPins=[...keys];});return;}
    if(input.dataset.plcFunction){store.edit('Edit PLC I/O assignment',p=>{const f=p.functions[input.dataset.plcFunction];f.properties.channels??={};f.properties.channels[input.dataset.plcChannel]??={};f.properties.channels[input.dataset.plcChannel][input.dataset.plcKey]=input.value;});return;}
    if(input.dataset.terminalPosition){store.edit('Change terminal position',p=>{const d=p.devices[input.dataset.terminalPosition];d.terminalPosition=input.value;if(d.stripId)d.tag=`${p.strips[d.stripId].tag}:${input.value}`;});return;}
    if(input.dataset.coreWire){store.edit('Assign cable core',p=>p.connections[input.dataset.coreWire].core=input.value);}
  }catch(error){toast(error.message,true);renderInspector();}
});
$('#navSearch').addEventListener('input',renderNavigation);$('#symbolSearch').addEventListener('input',renderLibrary);$('#symbolCategory').addEventListener('change',renderLibrary);$('#reportSearch').addEventListener('input',renderDock);
document.addEventListener('input',event=>{if(event.target.id==='commandSearch')renderCommands(event.target.value);});
$('#dialogClose').onclick=()=>$('#dialog').close();$('#dialogCancel').onclick=()=>$('#dialog').close();
$('#dialogForm').addEventListener('submit',async event=>{event.preventDefault();if(!dialogHandler)return;try{const handler=dialogHandler;await handler(new FormData(event.target));$('#dialog').close();}catch(error){toast(error.message,true);}});
$('#projectFile').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{const p=parseProject(await file.text());store.replace(p);setPage(orderedPages(p)[0].id);toast(`Opened ${p.name}`);}catch(error){toast(`Project was not changed: ${error.message}`,true);}event.target.value='';});
$('#symbolFile').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>2*1024*1024)throw new Error('Symbol file exceeds 2 MB.');const parsed=JSON.parse(await file.text()),defs=Array.isArray(parsed)?parsed:(parsed.symbols||[parsed]);if(!Array.isArray(defs)||defs.length>2000)throw new Error('Invalid symbol library.');defs.forEach(validateSymbol);store.edit('Import symbol library',p=>{for(const def of defs)p.symbols[def.id]=def;});toast(`Imported ${defs.length} reusable symbol(s).`);}catch(error){toast(error.message,true);}event.target.value='';});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){if($('#dialog').open)return;setTool('select');state.drag=null;state.overrides={};renderer.overlay.marquee=null;$('#menuPopup').hidden=true;rebuildScene();return;}
  if($('#dialog').open)return;
  if(event.target.closest('input,textarea,select,[contenteditable=true]'))return;
  const key=event.key.toLowerCase(),mod=event.ctrlKey||event.metaKey;
  if(mod){const mappings={z:event.shiftKey?'redo':'undo',y:'redo',s:'save',o:'open',n:'new',c:'copy',v:'paste',a:'selectAll',d:'duplicate',k:'command',e:event.shiftKey?'erc':null};if(mappings[key]){event.preventDefault();runAction(mappings[key]);}return;}
  if(event.code==='Space'){event.preventDefault();state.space=true;$('#stage').style.cursor='grab';return;}
  const mappings={v:'select',w:'wire',h:'pan',r:'rotate',f:'fit',g:'grid',x:'snap',delete:'delete',backspace:'delete',enter:'properties','+':'zoomIn','=':'zoomIn','-':'zoomOut'};
  if(mappings[key]){event.preventDefault();runAction(mappings[key]);return;}
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const grid=store.project.settings.grid*(event.shiftKey?10:1),dx=event.key==='ArrowRight'?grid:event.key==='ArrowLeft'?-grid:0,dy=event.key==='ArrowDown'?grid:event.key==='ArrowUp'?-grid:0,ids=[...state.selection].filter(id=>store.project.placements[id]);if(ids.length)store.edit('Nudge symbols',p=>{for(const id of ids){p.placements[id].x+=dx;p.placements[id].y+=dy;}});}
  if(['PageDown','PageUp'].includes(event.key)){event.preventDefault();const pages=orderedPages(store.project),index=pages.findIndex(p=>p.id===state.pageId),next=Math.max(0,Math.min(pages.length-1,index+(event.key==='PageDown'?1:-1)));setPage(pages[next].id);}
});
document.addEventListener('keyup',event=>{if(event.code==='Space'){state.space=false;$('#stage').style.cursor='';}});
window.addEventListener('blur',()=>{state.space=false;$('#stage').style.cursor='';});
renderRibbon();renderNavigation();renderPageTabs();renderLibrary();renderInspector();renderDock();rebuildScene();renderer.fit();updateHint();
$('#titleProject').textContent=store.project.name;document.title=`${store.project.name} · VoltWeave`;$('#statusMessage').textContent=`${restored?'Restored local workspace':'Conveyor example loaded'} · ${Object.keys(store.project.pages).length} schematic pages`;
$('#saveState').textContent=restored?'Restored local workspace':'Example ready';$('#graphStatus').textContent=`${state.analysis.stats.nets} nets · live`;
window.voltweave={store,renderer,run:runAction,setPage,jumpTo,select(ids){state.selection=new Set(ids);selectionChanged();},get project(){return store.project;},get analysis(){return ensureAnalysis();},get state(){return state;},get ready(){return renderer.backend!=='Initializing';},save:saveNow};
renderer.initialize({forceFallback:params.get('renderer')==='canvas'}).then(()=>{dispatchAnalysis();window.dispatchEvent(new CustomEvent('voltweave:ready'));});
if(!restored)saveNow();
