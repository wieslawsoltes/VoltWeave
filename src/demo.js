import {emptyProject,addPage,addFunction,connect,uid,validateProject} from './model.js';
import {numberConnections} from './graph.js';
/** Illustrative engineering data only; not a certified or construction-ready circuit. */
export function createDemo() {
  const p=emptyProject('Conveyor drive · MCC-01');p.author='Engineering team';p.description='Three-sheet motor starter and PLC integration example. Demonstration only; validate independently before engineering use.';
  const power=addPage(p,'Power distribution','1'),control=addPage(p,'Motor control & interlocks','2'),automation=addPage(p,'PLC & field signals','3');
  const put=(page,s,x,y,options={})=>addFunction(p,page,s,x,y,options),wire=(a,ak,b,bk,opts={})=>connect(p,a,ak,b,bk,opts);
  const potential=(page,x,y,net,rotation=0)=>put(page,'potential',x,y,{properties:{net},rotation});
  const x1=uid(),x2=uid();p.strips[x1]={id:x1,tag:'-X1',description:'Motor field terminals'};p.strips[x2]={id:x2,tag:'-X2',description:'24 V DC distribution'};
  const motorCable=uid();p.cables[motorCable]={id:motorCable,tag:'-W1',cores:4,crossSection:'2.5',length:12,part:'CABLE-4G2.5',manufacturer:'Generic',description:'Motor field cable · 4G2.5'};
  p.pages[power].notes=[{x:210,y:158,text:'01  /  THREE-PHASE MOTOR FEEDER',size:12,weight:600},{type:'divider',x:805,y:165,height:665},{x:962,y:158,text:'02  /  CONTROL POWER SUPPLY',size:12,weight:600},{x:990,y:800,text:'To control & PLC sheets  /2 · /3',size:13},{x:160,y:858,text:'400 V AC · 3~ · 50 Hz',size:13}];
  const q=put(power,'breaker3',360,280,{device:{tag:'-Q1',description:'Main circuit breaker'}}),k=put(power,'contactor3',360,430,{device:{tag:'-K1',description:'Conveyor contactor'}}),f=put(power,'overload3',360,570,{device:{tag:'-F1',description:'Motor overload'}}),m=put(power,'motor3',360,810,{device:{tag:'-M1'}});
  for(let i=0;i<3;i++) {
    const x=270+i*90,s=potential(power,x,190,`L${i+1}`),top=String(i*2+1),bottom=String(i*2+2);
    wire(s,'P',q,top,{crossSection:'2.5'});wire(q,bottom,k,top,{crossSection:'2.5'});wire(k,bottom,f,top,{crossSection:'2.5'});
    const t=put(power,'terminal',x,680,{device:{tag:`-X1:${i+1}`,stripId:x1,terminalPosition:String(i+1),description:'Motor terminal'}});
    wire(f,bottom,t,'1',{crossSection:'2.5'});wire(t,'2',m,['U','V','W'][i],{crossSection:'2.5',cableId:motorCable,core:String(i+1)});
  }
  const pe=potential(power,655,550,'PE'),pet=put(power,'terminal',655,680,{device:{tag:'-X1:PE',stripId:x1,terminalPosition:'PE',part:'TERMINAL-PE-2.5',description:'Protective earth terminal'}});
  wire(pe,'P',pet,'1',{color:'#73914b',crossSection:'2.5'});wire(pet,'2',m,'PE',{color:'#73914b',crossSection:'2.5',cableId:motorCable,core:'4',waypoints:[{x:655,y:830}]});
  const psu=put(power,'supply',1130,345,{device:{tag:'-G1'}}),ac=potential(power,1085,205,'L1'),neutral=potential(power,1175,205,'N');wire(ac,'P',psu,'L');wire(neutral,'P',psu,'N',{color:'#548fb0'});
  for(const [i,key,net]of [[0,'+','+24V'],[1,'-','0V']]) {
    const x=1085+i*90,t=put(power,'terminal',x,535,{device:{tag:`-X2:${i+1}`,stripId:x2,terminalPosition:String(i+1),description:'Control supply terminal'}}),out=potential(power,x,710,net,180);
    wire(psu,key,t,'1',{color:i?'#548fb0':'#285e78'});wire(t,'2',out,'P',{color:i?'#548fb0':'#285e78'});
  }
  p.pages[control].notes=[{x:145,y:156,text:'01  /  LOCAL START–STOP / SELF-HOLD',size:12,weight:600},{type:'divider',x:725,y:170,height:670},{x:866,y:156,text:'02  /  RUN INDICATION',size:12,weight:600},{x:410,y:728,text:'-K1 master function on /1.3',size:12},{x:410,y:749,text:'Physical device shared by coil and contacts.',size:12},{x:866,y:851,text:'24 V DC control circuit',size:13}];
  const c24=potential(control,250,185,'+24V'),stop=put(control,'pushNC',250,280,{device:{tag:'-S0',description:'Stop · local station'}}),j1=put(control,'junction',250,360),start=put(control,'pushNO',250,445,{device:{tag:'-S1',description:'Start · local station'}}),latch=put(control,'contactNO',495,445,{deviceId:k.deviceId,properties:{description:'Self-hold contact'}}),j2=put(control,'junction',250,535),ol=put(control,'contactNC',250,610,{deviceId:f.deviceId,properties:{description:'Overload healthy'}}),coil=put(control,'coil',250,750,{deviceId:k.deviceId,properties:{description:'Conveyor contactor coil'}}),c0=potential(control,250,855,'0V',180);
  wire(c24,'P',stop,'21');wire(stop,'22',j1,'J');wire(j1,'J',start,'13');wire(start,'14',j2,'J');wire(j1,'J',latch,'13',{waypoints:[{x:495,y:360}]});wire(latch,'14',j2,'J',{waypoints:[{x:495,y:535}]});wire(j2,'J',ol,'21');wire(ol,'22',coil,'A1');wire(coil,'A2',c0,'P',{color:'#548fb0'});
  const h24=potential(control,955,205,'+24V'),aux=put(control,'contactNO',955,380,{deviceId:k.deviceId,properties:{description:'Running feedback'}}),h=put(control,'lamp',955,630,{device:{tag:'-H1',description:'Conveyor running'}}),h0=potential(control,955,800,'0V',180);
  p.pins[aux.pins['13']].label='23';p.pins[aux.pins['14']].label='24';wire(h24,'P',aux,'13');wire(aux,'14',h,'X1');wire(h,'X2',h0,'P',{color:'#548fb0'});
  p.pages[automation].notes=[{x:180,y:155,text:'01  /  FIELD INPUTS',size:12,weight:600},{x:716,y:155,text:'02  /  CONTROLLER',size:12,weight:600},{x:1115,y:155,text:'03  /  DIGITAL OUTPUTS',size:12,weight:600},{x:740,y:830,text:'Spare channels I3 / Q3 intentionally unused.',size:12}];
  const plc=put(automation,'plc',800,455,{device:{tag:'-A1'},properties:{unusedPins:['I3','Q3']}}),lplus=potential(automation,755,205,'+24V'),common=potential(automation,845,205,'0V');wire(lplus,'P',plc,'L+');wire(common,'P',plc,'M',{color:'#548fb0'});
  const ps2=potential(automation,260,200,'+24V'),s2=put(automation,'pushNO',260,325,{device:{tag:'-S2',description:'Remote start'}});wire(ps2,'P',s2,'13');wire(s2,'14',plc,'I0');
  const ps3=potential(automation,260,440,'+24V'),s3=put(automation,'pushNO',260,565,{device:{tag:'-S3',description:'Reset request'}});wire(ps3,'P',s3,'13');wire(s3,'14',plc,'I1',{waypoints:[{x:460,y:610},{x:460,y:420}]});
  const pb=potential(automation,525,560,'+24V'),b1=put(automation,'contactNC',525,705,{device:{tag:'-B1',description:'Conveyor limit switch',part:'LIMIT-NC'}});wire(pb,'P',b1,'21');wire(b1,'22',plc,'I2',{waypoints:[{x:615,y:750},{x:615,y:470}]});
  for(const [i,symbol,y,tag,description]of [[0,'lamp',370,'-H2','System ready'],[1,'lamp',505,'-H3','Fault indication'],[2,'coil',680,'-K2','Remote enable relay']]) {
    const load=put(automation,symbol,1210,y,{rotation:270,device:{tag,description}}),zero=potential(automation,1450,y,'0V',90);
    wire(plc,`Q${i}`,load,symbol==='coil'?'A1':'X1',{waypoints:[{x:1080+i*25,y:370+i*50},{x:1080+i*25,y}]});wire(load,symbol==='coil'?'A2':'X2',zero,'P',{color:'#548fb0'});
  }
  const channels=p.functions[plc.functionId].properties.channels;
  Object.assign(channels.I0,{signal:'StartRequest',description:'Remote start push button'});Object.assign(channels.I1,{signal:'ResetRequest',description:'Alarm reset push button'});Object.assign(channels.I2,{signal:'LimitHealthy',description:'End-of-travel limit'});Object.assign(channels.I3,{signal:'Spare_DI'});Object.assign(channels.Q0,{signal:'SystemReady',description:'Ready indication'});Object.assign(channels.Q1,{signal:'FaultActive',description:'Fault indication'});Object.assign(channels.Q2,{signal:'RemoteEnable',description:'Enable interposing relay'});Object.assign(channels.Q3,{signal:'Spare_DO'});
  numberConnections(p);return validateProject(p);
}
