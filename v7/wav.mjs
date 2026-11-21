export function splitWav(bytes,seconds=25){
  if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw new Error('需要标准PCM WAV文件；MP3请先转换WAV或提供文字稿');
  let fmt,data;for(let pos=12;pos+8<=bytes.length;){const size=bytes.readUInt32LE(pos+4),tag=bytes.toString('ascii',pos,pos+4);if(pos+8+size>bytes.length)throw new Error('WAV文件不完整');if(tag==='fmt ')fmt=bytes.subarray(pos+8,pos+8+size);if(tag==='data')data=bytes.subarray(pos+8,pos+8+size);pos+=8+size+(size%2);}
  if(!fmt||fmt.length<16||!data||fmt.readUInt16LE(0)!==1||fmt.readUInt16LE(14)!==16)throw new Error('目前支持16位PCM WAV；请先转换或提供文字稿');
  const channels=fmt.readUInt16LE(2),rate=fmt.readUInt32LE(4),align=fmt.readUInt16LE(12),byteRate=fmt.readUInt32LE(8);if(![1,2].includes(channels)||rate<8000||rate>48000||align!==channels*2||byteRate!==rate*align||data.length%align)throw new Error('WAV参数不受支持');
  const chunkSize=Math.floor(byteRate*seconds/align)*align,out=[];if(data.length/byteRate>500)throw new Error('本轮录音最多500秒，长会议请拆分或上传文字稿');
  for(let offset=0;offset<data.length;offset+=chunkSize){const audio=data.subarray(offset,offset+chunkSize),header=Buffer.alloc(44);header.write('RIFF',0);header.writeUInt32LE(36+audio.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);fmt.copy(header,20,0,16);header.write('data',36);header.writeUInt32LE(audio.length,40);out.push({bytes:Buffer.concat([header,audio]),start:offset/byteRate,end:(offset+audio.length)/byteRate});}return out;
}
