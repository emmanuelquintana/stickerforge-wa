import {spawn} from 'node:child_process';
import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
export const LIMIT=500*1024;
export function run(bin,args,{timeout=45000,cap=1024*1024}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(bin,args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});let out=[],size=0,err='',failure;
    const stop=(e)=>{failure=e;child.kill('SIGKILL');};
    const timer=setTimeout(()=>stop(Error('Tiempo de proceso agotado')),timeout);
    child.stdout.on('data',b=>{size+=b.length;if(size>cap)stop(Error('Salida excesiva'));else out.push(b);});
    child.stderr.on('data',b=>{err=(err+b.toString()).slice(-3000);});
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer);if(failure||code!==0)reject(failure??Error(`FFmpeg/ffprobe falló (${code}): ${err}`));else resolve(Buffer.concat(out));});
  });
}
const ff=process.env.FFMPEG_PATH||'ffmpeg', fp=process.env.FFPROBE_PATH||'ffprobe';
const formats='mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpeg,mpegts,flv,gif,png_pipe,jpeg_pipe,webp_pipe,bmp_pipe,ogg,mp3,wav,aac,flac';
const base=['-hide_banner','-loglevel','error','-nostdin','-y','-filter_threads','1','-threads','2','-protocol_whitelist','file,pipe','-format_whitelist',formats];
export async function probe(path){
  const b=await run(fp,['-v','error','-protocol_whitelist','file,pipe','-format_whitelist',formats,'-show_streams','-show_format','-of','json',path],{timeout:12000});
  const p=JSON.parse(b);const v=p.streams.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic),a=p.streams.find(s=>s.codec_type==='audio');
  if(v&&(!v.width||!v.height||v.width*v.height>4096*4096)) throw Error('Resolución no admitida');
  const duration=Number(v?.duration??p.format?.duration);return {video:v,audio:a,duration:Number.isFinite(duration)?duration:null};
}
export function filter(o){
  const x=o.x/100,y=o.y/100;
  if(o.mode==='corte')return `scale=512:512:force_original_aspect_ratio=increase:force_divisible_by=2,crop=512:512:(iw-ow)*${x}:(ih-oh)*${y},setsar=1,format=rgba`;
  return `scale=512:512:force_original_aspect_ratio=decrease:force_divisible_by=2,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=${o.mode==='negro'?'black':'black@0'},setsar=1`;
}
export function webpInfo(b){
  if(b.length<20||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WEBP'||b.readUInt32LE(4)+8!==b.length)throw Error('WebP inválido');
  let duration=0,frames=0,w=0,h=0;
  for(let i=12;i+8<=b.length;){const name=b.toString('ascii',i,i+4),n=b.readUInt32LE(i+4),s=i+8;if(s+n>b.length)throw Error('WebP truncado');
    if(name==='VP8X'&&n>=10){w=b.readUIntLE(s+4,3)+1;h=b.readUIntLE(s+7,3)+1;}
    if(name==='VP8 '&&n>=10&&!w){w=b.readUInt16LE(s+6)&0x3fff;h=b.readUInt16LE(s+8)&0x3fff;}
    if(name==='VP8L'&&n>=5&&!w){const bits=b.readUInt32LE(s+1);w=(bits&0x3fff)+1;h=((bits>>>14)&0x3fff)+1;}
    if(name==='ANMF'&&n>=16){frames++;duration+=b.readUIntLE(s+12,3);}i=s+n+(n%2);
  }
  return {width:w,height:h,frames,duration:duration/1000};
}
export async function makeSticker(input,dir,o,{still=false}={}){
  const p=await probe(input);if(!p.video)throw Error('Se necesita imagen o video');
  const output=join(dir,'sticker.webp');
  if(!still&&p.duration!==null&&o.start>=p.duration)throw Error('El inicio está fuera del video');
  const duration=still?0:Math.min(o.duration,p.duration===null?o.duration:p.duration-o.start);
  const ladder=still?[[0,85],[0,65],[0,40],[0,20]]:[[15,72],[12,55],[10,42],[8,30],[6,22],[5,12],[5,4]];
  const candidates=ladder.map(([fps,q])=>[Math.min(fps,o.fps),q]);
  for(const [fps,q] of candidates){
    const inputArgs=still?[]:['-ss',String(o.start)];
    const f=still?filter(o):`fps=${fps},${filter(o)}`;
    await run(ff,[...base,...inputArgs,'-i',input,'-map','0:v:0','-an','-vf',f,...(still?['-frames:v','1']:['-t',String(duration),'-loop','0']),'-c:v',still?'libwebp':'libwebp_anim','-quality',String(q),'-compression_level','3','-threads','2',output]);
    const size=(await stat(output)).size;if(size>(still?100*1024:LIMIT))continue;
    const b=await readFile(output),info=webpInfo(b);if(info.width!==512||info.height!==512)throw Error('Dimensión de salida inválida');
    if(!still&&info.frames===0) { if(info.width===512) return {path:output,animated:false,duration,bytes:size}; }
    return {path:output,animated:info.frames>0,duration:still?0:info.duration,bytes:size};
  }
  throw Error('No cabe en el límite de tamaño; prueba con dur=3.');
}
export async function makeAudio(input,dir,o,{duration=o.duration,mp3=false,pad=false}={}){
  if(!(await probe(input)).audio)throw Error('El archivo no contiene audio');
  const output=join(dir,mp3?'audio.mp3':'audio.ogg');
  const af=`volume=${o.volume/100},alimiter=limit=0.95:latency=1${pad?',apad':''}`;
  await run(ff,[...base,'-ss',String(o.start),'-i',input,'-map','0:a:0','-vn','-af',af,'-t',String(duration),'-ac','1','-ar','48000','-c:a',mp3?'libmp3lame':'libopus','-b:a',mp3?'96k':'48k',output]);
  const info=await probe(output);if(!info.audio||!(await stat(output)).size)throw Error('Audio inválido');return output;
}
export async function extra(input,dir,o,kind){
  const p=await probe(input);if(!p.video)throw Error('Se necesita video');const photo=kind==='!foto',output=join(dir,photo?'foto.jpg':'gif.mp4');
  await run(ff,[...base,'-ss',String(o.start),'-i',input,'-map','0:v:0','-an','-vf',photo?'scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2':'fps=15,scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2',...(photo?['-frames:v','1','-q:v','3']:['-t',String(o.duration),'-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p','-movflags','+faststart']),output]);return output;
}

export async function exportVideo(input,dir){
 const p=await probe(input);if(!p.video||p.duration===null||p.duration>180)throw Error('Se necesita un video de hasta 3 minutos');const output=join(dir,'video.mp4');
 await run(ff,[...base,'-i',input,'-map','0:v:0','-map','0:a:0?','-vf','scale=720:720:force_original_aspect_ratio=decrease:force_divisible_by=2','-c:v','libx264','-preset','veryfast','-b:v','500k','-maxrate','650k','-bufsize','1300k','-c:a','aac','-b:a','64k','-pix_fmt','yuv420p','-movflags','+faststart',output],{timeout:90000});
 if((await stat(output)).size>20*1024*1024)throw Error('El video convertido supera 20 MiB.');return output;
}
