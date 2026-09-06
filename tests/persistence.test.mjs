import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyProject,addPage} from '../src/model.js';
import {createWorkspaceRecord,persistWorkspace,checkpointWorkspace,loadWorkspace} from '../src/persistence.js';

// These are storage-adapter unit tests, not a substitute for real browser IndexedDB tests.
const KEY='voltweave-workspace';
function project(name){const p=emptyProject(name);addPage(p,'Schematic');return p;}
function fixture(t,{localValue=null,dbValue=null,noDB=false,localThrows=false}={}){
  const previous={indexedDB:globalThis.indexedDB,localStorage:globalThis.localStorage,warn:console.warn};
  const values=new Map(localValue===null?[]:[[KEY,localValue]]);
  const memory={value:dbValue,writes:0};
  globalThis.localStorage={getItem:k=>{if(localThrows)throw new Error('Quota / permission denied');return values.get(k)||null;},setItem:(k,v)=>{if(localThrows)throw new Error('Quota / permission denied');values.set(k,v);}};
  globalThis.indexedDB=noDB?undefined:{open(){
    const request={};queueMicrotask(()=>{request.result={createObjectStore(){},close(){},transaction(){
      const tx={objectStore(){return {
        get(){const r={};queueMicrotask(()=>{r.result=structuredClone(memory.value);r.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.());});return r;},
        put(value){memory.value=structuredClone(value);memory.writes++;return {};}
      };}};return tx;}};request.onsuccess?.();});return request;
  }};
  console.warn=()=>{};
  t.after(()=>{globalThis.indexedDB=previous.indexedDB;globalThis.localStorage=previous.localStorage;console.warn=previous.warn;});
  return {values,memory};
}

test('save-intent timestamps are strictly monotonic even within one millisecond',()=>{
  const p=project('Monotonic');const records=Array.from({length:100},()=>createWorkspaceRecord(p));
  for(let i=1;i<records.length;i++)assert.ok(records[i].savedAt>records[i-1].savedAt);
  assert.equal(records[0].format,'voltweave/workspace');assert.equal(JSON.parse(records[0].project).id,p.id);
});
test('localStorage fallback saves and restores exact project identities',async t=>{
  fixture(t,{noDB:true});const p=project('Local fallback');assert.equal(await persistWorkspace(p),'Local storage');assert.deepEqual(await loadWorkspace(),p);
});
test('storage failure is reported rather than pretending the project was saved',async t=>{
  fixture(t,{noDB:true,localThrows:true});await assert.rejects(persistWorkspace(project('No storage')),/storage is unavailable/);
});
test('IndexedDB saves successfully when localStorage quota is unavailable',async t=>{
  const {memory}=fixture(t,{localThrows:true});const p=project('Database only');assert.equal(await persistWorkspace(p),'IndexedDB');assert.equal(memory.writes,1);assert.deepEqual(await loadWorkspace(),p);
});
test('restore chooses the newer local checkpoint over the older database record',async t=>{
  const old=createWorkspaceRecord(project('Older database')),fresh=createWorkspaceRecord(project('Newer checkpoint'));
  fixture(t,{dbValue:old,localValue:JSON.stringify(fresh)});assert.equal((await loadWorkspace()).name,'Newer checkpoint');
});
test('restore chooses the newer database record over the older local copy',async t=>{
  const old=createWorkspaceRecord(project('Older local')),fresh=createWorkspaceRecord(project('Newer database'));
  fixture(t,{dbValue:fresh,localValue:JSON.stringify(old)});assert.equal((await loadWorkspace()).name,'Newer database');
});
test('a corrupt local copy cannot prevent restoring the valid database backup',async t=>{
  const p=project('Valid database');fixture(t,{dbValue:createWorkspaceRecord(p),localValue:'{broken-json'});assert.deepEqual(await loadWorkspace(),p);
});
test('a corrupt database copy cannot prevent restoring the valid local backup',async t=>{
  const p=project('Valid local');fixture(t,{dbValue:{format:'voltweave/workspace',savedAt:999,project:'{}'},localValue:JSON.stringify(createWorkspaceRecord(p))});assert.deepEqual(await loadWorkspace(),p);
});
test('an older queued save cannot overwrite a newer unload checkpoint',async t=>{
  const {values}=fixture(t);const p=project('Queued old state'),old=createWorkspaceRecord(p),fresh=project('New unload state');
  const checkpoint=checkpointWorkspace(fresh);await persistWorkspace(p,old);
  assert.equal(JSON.parse(values.get(KEY)).savedAt,checkpoint.savedAt);assert.deepEqual(await loadWorkspace(),fresh);
});
test('the database transaction rejects stale write intent after a newer save',async t=>{
  const {memory}=fixture(t);const oldP=project('Old'),newP=project('New'),old=createWorkspaceRecord(oldP),fresh=createWorkspaceRecord(newP);
  await persistWorkspace(newP,fresh);await persistWorkspace(oldP,old);assert.equal(memory.writes,1);assert.equal(memory.value.savedAt,fresh.savedAt);assert.deepEqual(await loadWorkspace(),newP);
});
test('legacy raw-project local storage is accepted and upgraded on the next save',async t=>{
  const p=project('Legacy');const {values}=fixture(t,{noDB:true,localValue:JSON.stringify(p)});
  assert.deepEqual(await loadWorkspace(),p);await persistWorkspace(p);assert.equal(JSON.parse(values.get(KEY)).format,'voltweave/workspace');
});
