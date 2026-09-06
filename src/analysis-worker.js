import {analyzeProject} from './graph.js';
self.onmessage=({data})=>{
  const start=performance.now();
  try {self.postMessage({revision:data.revision,result:analyzeProject(data.project),elapsed:performance.now()-start});}
  catch(error){self.postMessage({revision:data.revision,error:error.message});}
};
