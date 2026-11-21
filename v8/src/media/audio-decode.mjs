import {scaledLimit,PROCESSING_LIMITS} from '../runtime/processing-capacity.mjs';
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {isAudioExtension} from './audio-formats.mjs';
const execFileAsync=promisify(execFile);
let cached;
export async function findFfmpeg(){
  if(cached!==undefined)return cached;
  for(const name of ['ffmpeg','ffmpeg.exe']){
    try{await execFileAsync(name,['-version'],{timeout:4000,windowsHide:true});cached=name;return cached;}
    catch(error){if(error.code==='ENOENT')continue;if(error.stdout||error.stderr){cached=name;return cached;}}
  }
  cached=null;return null;
}
export async function pcmWavFromAudio(bytes,extension){
  if(!isAudioExtension(extension))throw new Error('这不是可转写的录音格式');
  const ffmpeg=await findFfmpeg();if(!ffmpeg)return null;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-asr-')),input=path.join(dir,'input'+extension),output=path.join(dir,'output.wav');
  try{fs.writeFileSync(input,bytes);await execFileAsync(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',input,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le','-f','wav',output],{timeout:scaledLimit(120000),windowsHide:true,maxBuffer:1024*1024});
    const wav=fs.readFileSync(output);if(!wav.length||wav.length>80*1024*1024)throw new Error('转成WAV后为空或超过处理上限，请缩短录音');return wav;
  }catch(error){if(String(error.message).includes('转成WAV后'))throw error;throw new Error('录音无法转成可转写的WAV：'+String(error.stderr||error.message).replace(/\s+/g,' ').slice(0,240));}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
}
