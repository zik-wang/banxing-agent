import path from 'node:path';
export {outputFormats as requestedFormats} from './execution-intent.mjs';
export function checkRequestedFormats(cards,formats=[],initialIds=new Set(),allowExisting=false){const current=cards.filter(a=>allowExisting||!initialIds.has(a.artifactId));const missing=formats.filter(f=>!current.some(a=>path.extname(a.path).toLowerCase()==='.'+f));return {requested:formats,missing,satisfied:missing.length===0};}
