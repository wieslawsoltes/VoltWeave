import {parseProject} from './model.js';
const DB_NAME='voltweave-workspace',STORE='projects',KEY='active',LOCAL_KEY='voltweave-workspace';
let lastTimestamp=0;
function openDB(){return new Promise((resolve,reject)=>{if(!globalThis.indexedDB)return reject(new Error('IndexedDB unavailable'));const request=indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
function decodeRecord(value){if(!value)return null;const record=typeof value==='string'?JSON.parse(value):value;if(record.format==='voltweave/workspace')return {savedAt:record.savedAt,project:parseProject(record.project)};return {savedAt:0,project:parseProject(typeof value==='string'?value:JSON.stringify(value))};}
export function createWorkspaceRecord(project){lastTimestamp=Math.max(Date.now(),lastTimestamp+1);return {format:'voltweave/workspace',savedAt:lastTimestamp,project:JSON.stringify(project)};}
function writeLocalIfNewer(record){let current=null;try{current=JSON.parse(localStorage.getItem(LOCAL_KEY));}catch{}if(!current||!current.savedAt||current.savedAt<=record.savedAt)localStorage.setItem(LOCAL_KEY,JSON.stringify(record));}
export async function loadWorkspace(){
  const candidates=[];
  try{const db=await openDB();const value=await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).get(KEY);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();const record=decodeRecord(value);if(record)candidates.push(record);}catch(error){console.warn('Workspace database restore:',error.message);}
  try{const record=decodeRecord(localStorage.getItem(LOCAL_KEY));if(record)candidates.push(record);}catch(error){console.warn('Workspace local restore:',error.message);}
  candidates.sort((a,b)=>b.savedAt-a.savedAt);lastTimestamp=Math.max(lastTimestamp,...candidates.map(c=>c.savedAt||0));return candidates[0]?.project||null;
}
/** Synchronous unload checkpoint. Timestamp arbitration protects it from a stale queued save. */
export function checkpointWorkspace(project){const record=createWorkspaceRecord(project);writeLocalIfNewer(record);return record;}
export async function persistWorkspace(project,record=createWorkspaceRecord(project)){
  let localSaved=false;try{writeLocalIfNewer(record);localSaved=true;}catch{/* IndexedDB can save projects larger than the localStorage quota. */}
  try{const db=await openDB();await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),request=store.get(KEY);
    request.onsuccess=()=>{const previous=request.result;if(!previous||!previous.savedAt||previous.savedAt<=record.savedAt)store.put(record,KEY);};
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Persistence transaction aborted'));
  });db.close();return 'IndexedDB';}catch(error){if(localSaved)return 'Local storage';throw new Error(`Browser storage is unavailable: ${error.message}`);}
}
export function downloadFile(name,content,type='application/json'){const blob=content instanceof Blob?content:new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
export function csv(rows,columns){const escape=value=>{let str=String(value??'');if(/^[\s]*[=+\-@]/.test(str))str="'"+str;return '"'+str.replaceAll('"','""')+'"';};return '\uFEFF'+[columns.map(c=>escape(c.label)).join(','),...rows.map(row=>columns.map(c=>escape(Array.isArray(row[c.key])?row[c.key].join('; '):row[c.key])).join(','))].join('\r\n');}
