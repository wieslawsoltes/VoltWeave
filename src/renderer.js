/** One instanced draw for anti-aliased line capsules; no WebGL or third-party renderer. */
const SHADER = `
struct View { resolution:vec2f, pan:vec2f, zoom:f32, dpr:f32, pad:vec2f }
struct Segment { a:vec2f, b:vec2f, color:vec4f, params:vec4f }
@group(0) @binding(0) var<uniform> view:View;
@group(0) @binding(1) var<storage,read> segments:array<Segment>;
struct VOut { @builtin(position) position:vec4f, @location(0) uv:vec2f, @location(1) color:vec4f, @location(2) length:f32, @location(3) halfWidth:f32 }
@vertex fn vs(@builtin(vertex_index) vertex:u32, @builtin(instance_index) instance:u32)->VOut {
  let quad=array<vec2f,6>(vec2f(0,-1),vec2f(1,-1),vec2f(0,1),vec2f(0,1),vec2f(1,-1),vec2f(1,1));
  let s=segments[instance];let a=s.a*view.zoom+view.pan;let b=s.b*view.zoom+view.pan;
  let delta=b-a;let len=max(length(delta),0.0001);let dir=delta/len;let normal=vec2f(-dir.y,dir.x);
  let hw=max(s.params.x*view.zoom,view.dpr)*0.5;let extent=hw+1.25;
  let q=quad[vertex];let uv=vec2f(q.x*(len+2.0*extent)-extent,q.y*extent);let pixel=a+dir*uv.x+normal*uv.y;
  var out:VOut;out.position=vec4f(pixel.x/view.resolution.x*2.0-1.0,1.0-pixel.y/view.resolution.y*2.0,0,1);
  out.uv=uv;out.color=s.color;out.length=len;out.halfWidth=hw;return out;
}
@fragment fn fs(in:VOut)->@location(0) vec4f {
  let cap=in.uv.x-clamp(in.uv.x,0.0,in.length);let distance=length(vec2f(cap,in.uv.y));
  let alpha=(1.0-smoothstep(in.halfWidth-0.65,in.halfWidth+0.65,distance))*in.color.a;
  return vec4f(in.color.rgb*alpha,alpha);
}`;
const rgb=hex=>[parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255];
export class SchematicRenderer {
  constructor(container,{onStatus=()=>{},onFrame=()=>{}}={}) {
    this.container=container;this.onStatus=onStatus;this.onFrame=onFrame;this.zoom=0.7;this.pan={x:0,y:0};this.dpr=1;this.showGrid=true;this.showPins=true;this.scene=null;this.selection=new Set();this.overlay={};this.backend='Initializing';this.pending=false;
    this.paper=container.querySelector('#paper');this.gpuCanvas=container.querySelector('#vectors');this.fallback=container.querySelector('#fallback');this.labels=container.querySelector('#labels');
    this.paperCtx=this.paper.getContext('2d');this.textCtx=this.labels.getContext('2d');this.fallbackCtx=this.fallback.getContext('2d');this.fallback.hidden=true;
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(container);
  }
  async initialize({forceFallback=false}={}) {
    try {
      if(forceFallback||!navigator.gpu)throw new Error(forceFallback?'Canvas backend requested':'WebGPU is not available in this browser');
      const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw new Error('No WebGPU adapter');
      this.device=await adapter.requestDevice();this.context=this.gpuCanvas.getContext('webgpu');if(!this.context)throw new Error('No WebGPU canvas context');
      const format=navigator.gpu.getPreferredCanvasFormat();this.context.configure({device:this.device,format,alphaMode:'premultiplied'});
      const module=this.device.createShaderModule({code:SHADER,label:'VoltWeave anti-aliased line capsules'}),info=await module.getCompilationInfo();
      const errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw new Error(errors.map(m=>m.message).join('\n'));
      this.pipeline=await this.device.createRenderPipelineAsync({label:'VoltWeave segment pipeline',layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'triangle-list'}});
      this.uniform=this.device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
      this.backend='WebGPU';this.gpuCanvas.hidden=false;this.fallback.hidden=true;this.uploadNeeded=true;
      this.device.lost.then(info=>this.useFallback(`WebGPU device lost: ${info.message || info.reason}`));
      this.device.addEventListener('uncapturederror',e=>this.useFallback(e.error.message));
      this.onStatus(this.backend,'Instanced GPU line rendering');this.resize();this.requestDraw();
    }catch(error){this.useFallback(error.message);}
  }
  useFallback(reason) {if(this.backend==='Canvas 2D')return;this.backend='Canvas 2D';this.gpuCanvas.hidden=true;this.fallback.hidden=false;this.onStatus(this.backend,reason);this.requestDraw();}
  resize() {
    const box=this.container.getBoundingClientRect();this.width=Math.max(1,box.width);this.height=Math.max(1,box.height);this.dpr=Math.min(window.devicePixelRatio||1,2);
    const max=this.device?.limits.maxTextureDimension2D || 8192;this.dpr=Math.min(this.dpr,max/this.width,max/this.height);
    for(const canvas of [this.paper,this.gpuCanvas,this.fallback,this.labels]){const w=Math.round(this.width*this.dpr),h=Math.round(this.height*this.dpr);if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;}
    this.requestDraw();
  }
  setScene(scene){this.scene=scene;this.uploadNeeded=true;this.requestDraw();}
  fit(){if(!this.scene?.page)return;this.zoom=Math.max(0.08,Math.min((this.width-70)/this.scene.page.width,(this.height-42)/this.scene.page.height));this.pan={x:(this.width-this.scene.page.width*this.zoom)/2,y:(this.height-this.scene.page.height*this.zoom)/2};this.requestDraw();}
  world(point){return {x:(point.x-this.pan.x)/this.zoom,y:(point.y-this.pan.y)/this.zoom};}
  screen(point){return {x:point.x*this.zoom+this.pan.x,y:point.y*this.zoom+this.pan.y};}
  zoomAt(factor,point={x:this.width/2,y:this.height/2}) {const world=this.world(point);this.zoom=Math.max(0.08,Math.min(6,this.zoom*factor));this.pan={x:point.x-world.x*this.zoom,y:point.y-world.y*this.zoom};this.requestDraw();}
  centerAt(point){this.pan={x:this.width/2-point.x*this.zoom,y:this.height/2-point.y*this.zoom};this.requestDraw();}
  requestDraw(){if(this.pending)return;this.pending=true;requestAnimationFrame(()=>{this.pending=false;this.draw();});}
  upload() {
    if(!this.scene||!this.device||!this.pipeline)return;
    const count=this.scene.segments.length,need=Math.max(48,count*48);
    if(!this.storage||this.capacity<need){this.storage?.destroy();this.capacity=2**Math.ceil(Math.log2(need));this.storage=this.device.createBuffer({size:this.capacity,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});this.bindGroup=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}},{binding:1,resource:{buffer:this.storage}}]});}
    const data=new Float32Array(count*12);let i=0;
    for(const s of this.scene.segments){data.set([s.x1,s.y1,s.x2,s.y2,...rgb(s.color),1,s.width,0,0,0],i);i+=12;}
    if(data.byteLength)this.device.queue.writeBuffer(this.storage,0,data);this.segmentCount=count;this.uploadNeeded=false;
  }
  worldTransform(ctx){ctx.setTransform(this.dpr*this.zoom,0,0,this.dpr*this.zoom,this.dpr*this.pan.x,this.dpr*this.pan.y);}
  clear(ctx){ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);}
  draw() {
    if(!this.scene?.page)return;const start=performance.now(),scene=this.scene;
    const bg=this.paperCtx;this.clear(bg);this.worldTransform(bg);
    bg.save();bg.shadowColor='rgba(29,51,67,.17)';bg.shadowBlur=14/this.zoom;bg.shadowOffsetY=3/this.zoom;bg.fillStyle='#fff';bg.fillRect(0,0,scene.page.width,scene.page.height);bg.restore();
    for(const f of scene.fills){bg.fillStyle=f.color;bg.fillRect(f.x,f.y,f.w,f.h);}
    if(this.showGrid&&this.zoom>0.18){bg.fillStyle='#dfe7eb';const step=this.zoom<0.4?20:10;const minX=Math.max(70,Math.floor(-this.pan.x/this.zoom/step)*step),maxX=Math.min(scene.page.width-60,(this.width-this.pan.x)/this.zoom),minY=Math.max(140,Math.floor(-this.pan.y/this.zoom/step)*step),maxY=Math.min(scene.page.height-115,(this.height-this.pan.y)/this.zoom);for(let x=minX;x<maxX;x+=step)for(let y=minY;y<maxY;y+=step)bg.fillRect(x,y,0.7/this.zoom,0.7/this.zoom);}
    if(this.backend==='WebGPU') {
      try {if(this.uploadNeeded)this.upload();this.device.queue.writeBuffer(this.uniform,0,new Float32Array([this.gpuCanvas.width,this.gpuCanvas.height,this.pan.x*this.dpr,this.pan.y*this.dpr,this.zoom*this.dpr,this.dpr,0,0]));
        const encoder=this.device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
        pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.bindGroup);pass.draw(6,this.segmentCount);pass.end();this.device.queue.submit([encoder.finish()]);
      }catch(e){this.useFallback(e.message);}
    }
    if(this.backend!=='WebGPU'){const ctx=this.fallbackCtx;this.clear(ctx);this.worldTransform(ctx);ctx.lineCap='round';ctx.lineJoin='round';
      for(const s of scene.segments){ctx.beginPath();ctx.moveTo(s.x1,s.y1);ctx.lineTo(s.x2,s.y2);ctx.strokeStyle=s.color;ctx.lineWidth=Math.max(s.width,1/this.zoom);ctx.stroke();}}
    const ctx=this.textCtx;this.clear(ctx);this.worldTransform(ctx);
    for(const t of scene.texts){const pos=this.screen(t);if(pos.x<-500||pos.x>this.width+500||pos.y<-100||pos.y>this.height+100)continue;
      ctx.save();ctx.translate(t.x,t.y);if(t.rotation)ctx.rotate(t.rotation*Math.PI/180);ctx.font=`${t.weight||400} ${t.size}px "Segoe UI", Arial, sans-serif`;ctx.textAlign=t.align;ctx.fillStyle=t.color;
      if(t.backing){const w=ctx.measureText(t.text).width;ctx.fillStyle='rgba(255,255,255,.91)';ctx.fillRect(-w/2-2,-t.size,w+4,t.size+3);ctx.fillStyle=t.color;}ctx.fillText(t.text,0,0);ctx.restore();
    }
    if(this.showPins&&this.zoom>=0.28)for(const pin of scene.pins){ctx.beginPath();ctx.arc(pin.x,pin.y,2.3,0,Math.PI*2);ctx.fillStyle='white';ctx.fill();ctx.lineWidth=0.8/this.zoom;ctx.strokeStyle=pin.connected?'#79909c':pin.unused?'#bcc5ca':'#c88679';ctx.stroke();}
    for(const id of this.selection){const b=scene.bounds.get(id);if(!b)continue;ctx.strokeStyle='#168ade';ctx.lineWidth=1/this.zoom;ctx.setLineDash([4/this.zoom,3/this.zoom]);ctx.strokeRect(b.x1,b.y1,b.x2-b.x1,b.y2-b.y1);ctx.setLineDash([]);for(const x of [b.x1,b.x2])for(const y of [b.y1,b.y2]){ctx.fillStyle='#fff';ctx.fillRect(x-3/this.zoom,y-3/this.zoom,6/this.zoom,6/this.zoom);ctx.strokeRect(x-3/this.zoom,y-3/this.zoom,6/this.zoom,6/this.zoom);}}
    const o=this.overlay;
    if(o.marquee){ctx.fillStyle='rgba(0,137,192,.08)';ctx.strokeStyle='#0089c0';ctx.lineWidth=1/this.zoom;const {x,y,w,h}=o.marquee;ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);}
    if(o.preview){ctx.strokeStyle='#098ba1';ctx.lineWidth=2/this.zoom;ctx.setLineDash([6/this.zoom,4/this.zoom]);ctx.beginPath();o.preview.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();ctx.setLineDash([]);}
    if(o.ghost){ctx.globalAlpha=0.65;for(const s of o.ghost.segments){ctx.beginPath();ctx.moveTo(s.x1,s.y1);ctx.lineTo(s.x2,s.y2);ctx.strokeStyle='#007e91';ctx.lineWidth=1.7;ctx.stroke();}ctx.globalAlpha=1;}
    if(o.hover){ctx.beginPath();ctx.arc(o.hover.x,o.hover.y,7/this.zoom,0,Math.PI*2);ctx.fillStyle='rgba(0,153,170,.13)';ctx.fill();ctx.strokeStyle='#0099aa';ctx.lineWidth=1.5/this.zoom;ctx.stroke();}
    this.onFrame({backend:this.backend,segments:scene.segments.length,cpuMs:performance.now()-start,zoom:this.zoom});
  }
  destroy(){this.observer.disconnect();this.storage?.destroy();this.uniform?.destroy();this.device?.destroy();}
}
