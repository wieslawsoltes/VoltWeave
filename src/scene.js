import {getSymbol,placementBounds,transformPoint,pinPoint} from './symbols.js';
import {routeWire,SpatialIndex} from './routing.js';
export const COLORS={ink:'#183747',wire:'#285e78',muted:'#657c89',line:'#a2b0b9',accent:'#007e91',select:'#078be0',danger:'#dc5a48'};
export class DrawList {
  constructor(){this.segments=[];this.texts=[];this.fills=[];}
  line(x1,y1,x2,y2,color=COLORS.ink,width=1.7){this.segments.push({x1,y1,x2,y2,color,width});}
  path(points,color=COLORS.ink,width=1.7){for(let i=1;i<points.length;i++)this.line(points[i-1].x,points[i-1].y,points[i].x,points[i].y,color,width);}
  rect(x,y,w,h,color=COLORS.ink,width=1.4){this.path([{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h},{x,y}],color,width);}
  circle(x,y,r,color=COLORS.ink,width=1.7){let previous={x:x+r,y};const n=Math.min(256,Math.max(12,Math.ceil(r*2)));for(let i=1;i<=n;i++){const next={x:x+Math.cos(i*2*Math.PI/n)*r,y:y+Math.sin(i*2*Math.PI/n)*r};this.path([previous,next],color,width);previous=next;}}
  text(x,y,text,size=14,options={}){this.texts.push({x,y,text:String(text??''),size,color:COLORS.ink,align:'left',...options});}
  fill(x,y,w,h,color){this.fills.push({x,y,w,h,color});}
  dashed(x1,y1,x2,y2,color=COLORS.line,dash=8){const l=Math.hypot(x2-x1,y2-y1);for(let t=0;t<l;t+=dash*2)this.line(x1+(x2-x1)*t/l,y1+(y2-y1)*t/l,x1+(x2-x1)*Math.min(t+dash,l)/l,y1+(y2-y1)*Math.min(t+dash,l)/l,color,1);}
}
export function symbolPrimitives(scene,definition,placement,color=COLORS.ink) {
  const point=(x,y)=>transformPoint(placement,x,y);
  for(const shape of definition.shapes) {
    if(shape.type==='line')scene.path(Array.from({length:shape.points.length/2},(_,i)=>point(shape.points[i*2],shape.points[i*2+1])),color);
    else if(shape.type==='rect'){const {x,y,w,h}=shape;scene.path([[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]].map(([x,y])=>point(x,y)),color);}
    else if(shape.type==='circle'||shape.type==='dot'){const p=point(shape.x,shape.y);scene.circle(p.x,p.y,shape.r,color,shape.type==='dot'?shape.r*1.8:1.7);}
    else if(shape.type==='text'){const p=point(shape.x,shape.y);scene.text(p.x,p.y,shape.text,shape.size,{align:'center',color});}
  }
}
export function buildScene(p,pageId,xrefs,{overrides={},selection=new Set(),highlightNet=null,showNumbers=true,showRefs=true}={}) {
  const page=p.pages[pageId],scene=new DrawList();scene.page=page;scene.index=new SpatialIndex();scene.routes=new Map();scene.pins=[];scene.bounds=new Map();scene.routeFailures=[];
  if(!page)return scene;
  const w=page.width,h=page.height;
  scene.rect(55,50,w-110,h-100,'#758e9d',1.3);
  for(let i=0;i<10;i++){const x=55+(w-110)*i/10;scene.line(x,50,x,65,'#9aaab4',1);scene.text(x+(w-110)/20,44,String(i+1),12,{align:'center',color:COLORS.muted});}
  for(let i=0;i<5;i++)scene.text(37,150+i*(h-200)/5,String.fromCharCode(65+i),12,{align:'center',color:COLORS.muted});
  scene.text(84,94,page.name.toUpperCase(),25,{weight:600});scene.text(w-84,93,page.structure,15,{align:'right',color:COLORS.muted});
  scene.line(55,121,w-55,121,'#a6b4bd',1);
  const tb=h-111;scene.fill(56,tb,w-112,60,'#f3f7f9');scene.line(55,tb,w-55,tb,'#758e9d',1.3);
  const cols=[55,485,w-510,w-300,w-170,w-55];for(const x of cols.slice(1,-1))scene.line(x,tb,x,h-50,'#97aab5',1);
  scene.text(74,tb+18,'PROJECT / INSTALLATION',9,{color:COLORS.muted});scene.text(74,tb+42,p.name,16,{weight:600});
  scene.text(502,tb+18,'DRAWING TITLE',9,{color:COLORS.muted});scene.text(502,tb+42,page.name,15);
  scene.text(w-493,tb+18,'ENGINEER',9,{color:COLORS.muted});scene.text(w-493,tb+41,p.author,14);
  scene.text(w-282,tb+18,'REVISION',9,{color:COLORS.muted});scene.text(w-282,tb+42,p.revision,16);
  scene.text(w-151,tb+18,'PAGE',9,{color:COLORS.muted});scene.text(w-151,tb+43,`${page.number} / ${Object.keys(p.pages).length}`,20,{weight:600});
  scene.text(55,h-25,'VOLTWEAVE  /  ELECTRICAL ENGINEERING',10,{color:COLORS.muted});scene.text(w-55,h-25,'SCHEMATIC · SEMANTIC CONNECTIVITY',10,{color:COLORS.muted,align:'right'});
  for(const note of page.notes || []) {
    if(note.type==='divider')scene.dashed(note.x,note.y,note.x,note.y+(note.height||500),'#b8c5cd');
    else scene.text(note.x,note.y,note.text,note.size||16,{color:note.color||COLORS.muted,weight:note.weight||400});
  }
  const placements=Object.values(p.placements).filter(s=>s.pageId===pageId).map(s=>({...s,...overrides[s.id]}));
  const obstacles=placements.filter(s=>p.functions[s.functionId].symbolId!=='junction').map(s=>({id:s.id,...placementBounds(p,s,7)}));
  const connected=new Set(Object.values(p.connections).flatMap(w=>[w.from,w.to]));
  for(const wire of Object.values(p.connections).filter(w=>w.route.pageId===pageId)) {
    const route=routeWire(p,wire,overrides,obstacles);scene.routes.set(wire.id,route.points);if(route.failed)scene.routeFailures.push(wire.id);
    const selected=selection.has(wire.id),highlighted=highlightNet?.has(wire.from),color=selected||highlighted?COLORS.select:route.failed?'#bf7837':wire.color;
    scene.path(route.points,color,selected||highlighted?3:1.9);
    for(let i=1;i<route.points.length;i++){const a=route.points[i-1],b=route.points[i];scene.index.insert({key:`${wire.id}:${i}`,type:'wire',id:wire.id,a,b},{x1:Math.min(a.x,b.x)-7,y1:Math.min(a.y,b.y)-7,x2:Math.max(a.x,b.x)+7,y2:Math.max(a.y,b.y)+7});}
    if(showNumbers&&wire.number){let best=null;for(let i=1;i<route.points.length;i++){const a=route.points[i-1],b=route.points[i],length=Math.hypot(a.x-b.x,a.y-b.y);if(!best||length>best.length)best={a,b,length};}
      if(best?.length>45){const {a,b}=best,vertical=Math.abs(a.x-b.x)<1,label=wire.number+(wire.cableId?` · ${p.cables[wire.cableId]?.tag}:${wire.core}`:'');scene.text((a.x+b.x)/2-(vertical?7:0),(a.y+b.y)/2-(vertical?0:6),label,10.5,{align:'center',color:highlighted?COLORS.select:'#668797',rotation:vertical?-90:0,backing:true});}
    }
  }
  for(const placement of placements) {
    const f=p.functions[placement.functionId],d=p.devices[f.deviceId],symbol=getSymbol(p,f.symbolId),color=selection.has(placement.id)?COLORS.select:COLORS.ink,bounds=placementBounds(p,placement,7);
    scene.bounds.set(placement.id,bounds);scene.index.insert({key:placement.id,type:'symbol',id:placement.id,bounds},bounds);symbolPrimitives(scene,symbol,placement,color);
    for(const def of symbol.pins){const point=pinPoint(p,placement,def.key),pinId=f.pins[def.key],pin=p.pins[pinId];const item={key:`pin:${placement.id}:${pinId}`,type:'pin',id:pinId,placementId:placement.id,pinKey:def.key,...point,connected:connected.has(pinId),unused:f.properties.unusedPins?.includes(def.key)};scene.pins.push(item);scene.index.insert(item,{x1:point.x-8,y1:point.y-8,x2:point.x+8,y2:point.y+8});
      if(!['junction','potential','earth'].includes(f.symbolId)){const top=def.y<0||def.x<0;scene.text(point.x+(def.x===0?7:def.x<0?-7:7),point.y+(top?-6:13),pin.label,10,{align:def.x<0?'right':'left',color:'#738793'});}
    }
    if(d) {
      const large=['breaker3','contactor3','overload3','motor3','supply','plc'].includes(f.symbolId);const lx=large?bounds.x1-14:bounds.x2+10,ly=large?placement.y-17:placement.y-10,align=large?'right':'left';
      scene.text(lx,ly,d.tag,f.symbolId==='terminal'?14:17,{weight:600,color,align});if(f.symbolId!=='terminal')scene.text(lx,ly+20,f.properties.description||d.description,11.5,{color:COLORS.muted,align});
      if(d.rating&&f.symbolId!=='terminal')scene.text(lx,ly+37,d.rating,10.5,{color:COLORS.muted,align});
      if(showRefs){const refs=(xrefs?.get(f.deviceId)||[]).filter(r=>r.placementId!==placement.id);if(refs.length)scene.text(lx,ly+55,refs.map(r=>r.text).join('  '),10.5,{align,color:COLORS.accent});}
      if(f.symbolId==='plc')for(const def of symbol.pins.filter(pin=>['input','output'].includes(pin.type))){const pt=pinPoint(p,placement,def.key),ch=f.properties.channels?.[def.key];if(ch)scene.text(pt.x+(def.type==='input'?12:-12),pt.y+18,ch.address,9.5,{color:COLORS.accent,align:def.type==='input'?'left':'right'});}
    } else if(f.properties.net&&f.symbolId!=='earth')scene.text(placement.x+15,placement.y-10,f.properties.net,15,{weight:600,color:COLORS.accent});
  }
  return scene;
}
export const escapeXML=value=>String(value??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
export function sceneToSVG(scene,{includePins=true}={}) {
  const {width:w,height:h}=scene.page;
  const fills=scene.fills.map(f=>`<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" fill="${escapeXML(f.color)}"/>`).join('');
  const lines=scene.segments.map(s=>`<path d="M${s.x1.toFixed(2)} ${s.y1.toFixed(2)}L${s.x2.toFixed(2)} ${s.y2.toFixed(2)}" stroke="${escapeXML(s.color)}" stroke-width="${s.width}"/>`).join('');
  const text=scene.texts.map(t=>`<text x="${t.x}" y="${t.y}" font-size="${t.size}" font-weight="${t.weight||400}" fill="${escapeXML(t.color)}" text-anchor="${t.align==='center'?'middle':t.align==='right'?'end':'start'}"${t.rotation?` transform="rotate(${t.rotation} ${t.x} ${t.y})"`:''}>${escapeXML(t.text)}</text>`).join('');
  const pins=includePins?scene.pins.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="2.4" fill="white" stroke="${p.connected?'#668593':'#cb8373'}" stroke-width="1"/>`).join(''):'';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeXML(scene.page.name)}"><rect width="100%" height="100%" fill="white"/>${fills}<g fill="none" stroke-linecap="round" stroke-linejoin="round">${lines}</g><g font-family="Arial, sans-serif">${text}</g>${pins}</svg>`;
}
