import {getSymbol,pinPoint,placementBounds,transformPoint} from './symbols.js';
export const snap=(v,grid=10)=>Math.round(v/grid)*grid;
export const samePoint=(a,b)=>Math.abs(a.x-b.x)<0.01&&Math.abs(a.y-b.y)<0.01;
export function closestOnSegment(p,a,b) {const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return {x:a.x+t*dx,y:a.y+t*dy};}
export function distanceToSegment(p,a,b) {const q=closestOnSegment(p,a,b);return Math.hypot(q.x-p.x,q.y-p.y);}
export function simplify(points) {
  const out=[];
  for(const p of points){if(out.length&&samePoint(out.at(-1),p))continue;
    while(out.length>=2){const a=out.at(-2),b=out.at(-1);if(Math.abs((b.x-a.x)*(p.y-b.y)-(b.y-a.y)*(p.x-b.x))>0.001)break;out.pop();}out.push(p);
  }return out;
}
class MinHeap {
  constructor(){this.items=[];}
  push(item){const a=this.items;a.push(item);let i=a.length-1;while(i){const p=(i-1)>>1;if(a[p].f<=item.f)break;a[i]=a[p];i=p;}a[i]=item;}
  pop(){const a=this.items,root=a[0],last=a.pop();if(a.length){let i=0;while(true){let c=i*2+1;if(c>=a.length)break;if(c+1<a.length&&a[c+1].f<a[c].f)c++;if(a[c].f>=last.f)break;a[i]=a[c];i=c;}a[i]=last;}return root;}
  get length(){return this.items.length;}
}
function intersects(a,b,box) {
  if(a.x===b.x)return a.x>box.x1&&a.x<box.x2&&Math.max(a.y,b.y)>box.y1&&Math.min(a.y,b.y)<box.y2;
  if(a.y===b.y)return a.y>box.y1&&a.y<box.y2&&Math.max(a.x,b.x)>box.x1&&Math.min(a.x,b.x)<box.x2;
  return true;
}
function clearPath(points,obstacles){for(let i=1;i<points.length;i++)if(obstacles.some(b=>intersects(points[i-1],points[i],b)))return false;return true;}
/** Bounded Manhattan A*: bend penalties, local obstacle occupancy, and explicit failure reporting. */
export function orthogonalRoute(start,end,obstacles=[],grid=10,budget=22000) {
  const alternatives=[ [start,{x:start.x,y:end.y},end], [start,{x:end.x,y:start.y},end], [start,{x:start.x,y:snap((start.y+end.y)/2,grid)},{x:end.x,y:snap((start.y+end.y)/2,grid)},end], [start,{x:snap((start.x+end.x)/2,grid),y:start.y},{x:snap((start.x+end.x)/2,grid),y:end.y},end] ];
  for(const path of alternatives)if(clearPath(path,obstacles))return {points:simplify(path),failed:false,visited:0};
  const a={x:snap(start.x,grid),y:snap(start.y,grid)},b={x:snap(end.x,grid),y:snap(end.y,grid)};
  const minX=Math.min(a.x,b.x)-250,maxX=Math.max(a.x,b.x)+250,minY=Math.min(a.y,b.y)-250,maxY=Math.max(a.y,b.y)+250;
  const blocked=new Set();
  for(const o of obstacles)for(let x=Math.max(minX,Math.ceil(o.x1/grid)*grid);x<=Math.min(maxX,o.x2);x+=grid)for(let y=Math.max(minY,Math.ceil(o.y1/grid)*grid);y<=Math.min(maxY,o.y2);y+=grid)if(x>o.x1&&x<o.x2&&y>o.y1&&y<o.y2)blocked.add(`${x},${y}`);
  blocked.delete(`${a.x},${a.y}`);blocked.delete(`${b.x},${b.y}`);
  const key=(x,y,d)=>`${x},${y},${d}`,heap=new MinHeap(),dist=new Map(),parent=new Map(),states=new Map();
  const initial={...a,d:-1,g:0,f:Math.abs(b.x-a.x)+Math.abs(b.y-a.y)};initial.key=key(a.x,a.y,-1);heap.push(initial);dist.set(initial.key,0);states.set(initial.key,initial);
  let visited=0,found=null;
  const dirs=[[0,1],[1,0],[0,-1],[-1,0]];
  while(heap.length&&visited++<budget){const current=heap.pop();if(current.g!==dist.get(current.key))continue;if(current.x===b.x&&current.y===b.y){found=current;break;}
    for(let d=0;d<4;d++){const x=current.x+dirs[d][0]*grid,y=current.y+dirs[d][1]*grid;if(x<minX||x>maxX||y<minY||y>maxY||blocked.has(`${x},${y}`))continue;
      const k=key(x,y,d),g=current.g+grid+(current.d!==-1&&current.d!==d?grid*0.45:0);
      if(g>=(dist.get(k)??Infinity))continue;const n={x,y,d,g,f:g+Math.abs(x-b.x)+Math.abs(y-b.y),key:k};dist.set(k,g);parent.set(k,current.key);states.set(k,n);heap.push(n);
    }
  }
  if(!found)return {points:simplify(alternatives[0]),failed:true,visited};
  const rev=[];let k=found.key;while(k){const v=states.get(k);rev.push({x:v.x,y:v.y});k=parent.get(k);}rev.reverse();
  return {points:simplify([start,{x:a.x,y:start.y},...rev,{x:b.x,y:end.y},end]),failed:false,visited};
}
function escapePoint(project,s,pinId,point,grid) {
  const f=project.functions[s.functionId],def=getSymbol(project,f.symbolId),pin=def.pins.find(p=>f.pins[p.key]===pinId);
  if(f.symbolId==='junction')return point;
  const b=def.bounds;let dx=0,dy=0;
  const distances=[Math.abs(pin.x-b[0]),Math.abs(pin.x-b[2]),Math.abs(pin.y-b[1]),Math.abs(pin.y-b[3])],edge=distances.indexOf(Math.min(...distances));
  if(edge===0)dx=-1;else if(edge===1)dx=1;else if(edge===2)dy=-1;else dy=1;
  const direction=transformPoint({...s,x:0,y:0},dx*grid*1.5,dy*grid*1.5);
  return {x:point.x+direction.x,y:point.y+direction.y};
}
export function routeWire(p,w,overrides={},obstacleCache) {
  const from={...p.placements[w.route.fromPlacementId],...overrides[w.route.fromPlacementId]},to={...p.placements[w.route.toPlacementId],...overrides[w.route.toPlacementId]};
  const a=pinPoint(p,from,p.pins[w.from].key),b=pinPoint(p,to,p.pins[w.to].key),grid=p.settings.grid;
  const ea=escapePoint(p,from,w.from,a,grid),eb=escapePoint(p,to,w.to,b,grid);
  const obstacles=(obstacleCache||Object.values(p.placements).filter(s=>s.pageId===w.route.pageId).map(s=>({id:s.id,...placementBounds(p,{...s,...overrides[s.id]},8)}))).filter(o=>o.id!==from.id&&o.id!==to.id);
  const anchors=[ea,...w.route.waypoints,eb],points=[a,ea];let failed=false;
  for(let i=1;i<anchors.length;i++){const r=orthogonalRoute(anchors[i-1],anchors[i],obstacles,grid);points.push(...r.points);failed ||= r.failed;}
  points.push(eb,b);return {points:simplify(points),failed};
}
/** Page-space uniform-grid index for bounded pointer queries. */
export class SpatialIndex {
  constructor(cell=100){this.cell=cell;this.cells=new Map();this.items=new Map();}
  insert(item,b) {this.items.set(item.key,item);for(let x=Math.floor(b.x1/this.cell);x<=Math.floor(b.x2/this.cell);x++)for(let y=Math.floor(b.y1/this.cell);y<=Math.floor(b.y2/this.cell);y++){const k=`${x},${y}`;if(!this.cells.has(k))this.cells.set(k,[]);this.cells.get(k).push(item);}}
  query(x,y,r=10){const found=new Map();for(let cx=Math.floor((x-r)/this.cell);cx<=Math.floor((x+r)/this.cell);cx++)for(let cy=Math.floor((y-r)/this.cell);cy<=Math.floor((y+r)/this.cell);cy++)for(const item of this.cells.get(`${cx},${cy}`)||[])found.set(item.key,item);return [...found.values()];}
}
