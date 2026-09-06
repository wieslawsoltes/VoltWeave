/** Dependency-free build for this project's deliberately simple, static ES-module graph.
 * This is not a general-purpose JS bundler. Development remains on the source ES modules.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const names=['symbols','model','graph','routing','scene','renderer','persistence','demo','reports'];
function transform(source){return source.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]\.\/([^'"]+)['"];?\s*$/gm,(_,bindings,module)=>`const {${bindings.replace(/\bas\b/g,':')}}=__modules[${JSON.stringify(module.replace(/\.js$/,''))}];`).replace(/^export /gm,'');}
function moduleCode(name,source){const exports=[...source.matchAll(/^export\s+(?:async\s+)?(?:class|function|const|let)\s+(\w+)/gm)].map(m=>m[1]);return `__modules[${JSON.stringify(name)}]=(()=>{\n${transform(source)}\nreturn {${exports.join(',')}};\n})();\n`;}
const sources=Object.fromEntries(await Promise.all(names.map(async n=>[n,await readFile(path.join(root,'src',`${n}.js`),'utf8')])));
const worker=`'use strict';const __modules=Object.create(null);\n${['symbols','model','graph'].map(n=>moduleCode(n,sources[n])).join('\n')}\nself.onmessage=({data})=>{const start=performance.now();try{self.postMessage({revision:data.revision,result:__modules.graph.analyzeProject(data.project),elapsed:performance.now()-start});}catch(error){self.postMessage({revision:data.revision,error:error.message});}};`;
let app=transform(await readFile(path.join(root,'src','app.js'),'utf8'));
app=app.replace("new Worker(new URL('./analysis-worker.js',import.meta.url),{type:'module'})",'new Worker(window.__voltweaveWorkerURL)');
const script=`(async()=>{'use strict';const __modules=Object.create(null);\n${names.map(n=>moduleCode(n,sources[n])).join('\n')}\nwindow.__voltweaveWorkerURL=URL.createObjectURL(new Blob([${JSON.stringify(worker)}],{type:'text/javascript'}));\n${app}\n})().catch(error=>{console.error(error);document.getElementById('statusMessage').textContent='Startup failed: '+error.message;});`;
let html=await readFile(path.join(root,'index.html'),'utf8'),css=await readFile(path.join(root,'styles.css'),'utf8');
html=html.replace('<link rel="stylesheet" href="styles.css">',()=>`<style>${css}</style>`).replace('<script type="module" src="src/app.js"></script>',()=>`<script>${script.replace(/<\/script/gi,'<\\/script')}</script>`);
await mkdir(path.join(root,'dist'),{recursive:true});await writeFile(path.join(root,'dist','voltweave.html'),html);console.log(`Built dist/voltweave.html (${Math.round(Buffer.byteLength(html)/1024)} KiB).`);
