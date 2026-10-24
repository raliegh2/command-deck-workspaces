import {neuralMemory,closeNeuralMemory} from '../server/neural-memory.js';
import {vaultRoot} from '../server/knowledge.js';
const memory=await neuralMemory();
try{await memory.index(vaultRoot);console.log(JSON.stringify(memory.status()));}finally{closeNeuralMemory();}
