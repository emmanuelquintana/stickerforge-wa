import {spawn} from 'node:child_process';
import {readFile,stat} from 'node:fs/promises';
import {extname,join} from 'node:path';
export const LIMIT=500*1024;
export function run(bin,args,{timeout=45000,cap=1024*1024,signal,cwd}={}){
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const child=spawn(bin,args,{cwd,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});let out=[],size=0,err='',failure;
    const stop=(e)=>{failure=e;child.kill('SIGKILL');};
    const timer=setTimeout(()=>stop(Error('Tiempo de proceso agotado')),timeout);
    const cancel=()=>stop(Error('Operación cancelada'));
    signal?.addEventListener('abort',cancel,{once:true});
    child.once('close',()=>signal?.removeEventListener('abort',cancel));
    child.stdout.on('data',b=>{size+=b.length;if(size>cap)stop(Error('Salida excesiva'));else out.push(b);});
    child.stderr.on('data',b=>{err=(err+b.toString()).slice(-3000);});
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer);if(failure||code!==0)reject(failure??Error(`FFmpeg/ffprobe falló (${code}): ${err}`));else resolve(Buffer.concat(out));});
  });
}
const ff=process.env.FFMPEG_PATH||'ffmpeg', fp=process.env.FFPROBE_PATH||'ffprobe';
const formats='mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpeg,mpegts,flv,gif,png_pipe,jpeg_pipe,webp_pipe,bmp_pipe,ogg,mp3,wav,aac,flac';
const base=['-hide_banner','-loglevel','error','-nostdin','-y','-filter_threads','1','-threads','2','-protocol_whitelist','file,pipe','-format_whitelist',formats];
function imageInput(path) {
  const format = { '.png': 'png_pipe', '.jpg': 'jpeg_pipe', '.jpeg': 'jpeg_pipe', '.webp': 'webp_pipe', '.bmp': 'bmp_pipe' }[extname(path).toLowerCase()];
  return format ? ['-f', format] : [];
}
export async function probe(path,{signal}={}){
  const b=await run(fp,['-v','error','-protocol_whitelist','file,pipe','-format_whitelist',formats,'-show_streams','-show_format','-of','json',...imageInput(path),path],{timeout:12000,signal});
  const p=JSON.parse(b);const v=p.streams.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic),a=p.streams.find(s=>s.codec_type==='audio');
  if(v&&(!v.width||!v.height||v.width*v.height>4096*4096)) throw Error('Resolución no admitida');
  const duration=Number(v?.duration??p.format?.duration);return {video:v,audio:a,duration:Number.isFinite(duration)?duration:null};
}
export function filter(o){
  const filters = [];
  if (o.rotation === 90) filters.push('transpose=clock');
  if (o.rotation === 180) filters.push('hflip', 'vflip');
  if (o.rotation === 270) filters.push('transpose=cclock');
  if (o.flip) filters.push('hflip');
  if (o.brightness || (o.contrast ?? 1) !== 1 || (o.saturation ?? 1) !== 1) {
    filters.push(`eq=brightness=${o.brightness ?? 0}:contrast=${o.contrast ?? 1}:saturation=${o.saturation ?? 1}`);
  }
  const x=o.x/100,y=o.y/100;
  if(o.mode==='blur') {
    filters.push('split[back][front];[back]scale=512:512:force_original_aspect_ratio=increase,crop=512:512,gblur=sigma=24,setsar=1[bg];[front]scale=512:512:force_original_aspect_ratio=decrease,setsar=1[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,format=rgba');
  } else
  if(o.mode==='corte') {
    const edge = Math.round(256 * (o.zoom ?? 1)) * 2;
    filters.push(`scale=${edge}:${edge}:force_original_aspect_ratio=increase:force_divisible_by=2`,
      `crop=512:512:(iw-ow)*${x}:(ih-oh)*${y}`, 'setsar=1', 'format=rgba');
  } else {
    const color = { negro: 'black', blanco: 'white', color: o.color }[o.mode] ?? 'black@0';
    filters.push('scale=512:512:force_original_aspect_ratio=decrease:force_divisible_by=2', 'format=rgba',
      `pad=512:512:(ow-iw)/2:(oh-ih)/2:color=${color}`, 'setsar=1');
  }
  if(o.caption) filters.push(`drawtext=fontfile=caption.ttf:textfile=caption.txt:expansion=none:fontsize=34:fontcolor=white:borderw=${o.outline??3}:bordercolor=black:x=(w-tw)/2:y=h-th-24`);
  return filters.join(',');
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
export async function makeSticker(input,dir,o,{still=false,signal}={}){
  const p=await probe(input,{signal});if(!p.video)throw Error('Se necesita imagen o video');
  const output=join(dir,'sticker.webp');
  if(!still&&p.duration!==null&&o.start>=p.duration)throw Error('El inicio está fuera del video');
  const duration=still?0:Math.min(o.duration,p.duration===null?o.duration:p.duration-o.start)/(o.speed??1);
  const ladder=still?[[0,85],[0,65],[0,40],[0,20]]:[[15,72],[12,55],[10,42],[8,30],[6,22],[5,12],[5,4]];
  const candidates=ladder.map(([fps,q],index)=>[
    Math.min(o.fps, o.quality !== undefined && index === 0 && !still ? o.fps : fps),
    index === 0 ? (o.quality ?? q) : Math.min(o.quality ?? q, q),
  ]);
  for(const [fps,q] of candidates){
    const inputArgs=still?[]:['-ss',String(o.start)];
    const f=still?filter(o):`setpts=PTS/${o.speed??1},fps=${fps},${filter(o)}`;
    await run(ff,[...base,...inputArgs,...imageInput(input),'-i',input,'-map','0:v:0','-an','-vf',f,...(still?['-frames:v','1']:['-t',String(duration),'-loop','0']),'-c:v',still?'libwebp':'libwebp_anim','-quality',String(q),'-compression_level','3','-threads','2',output],{signal,cwd:o.caption?dir:undefined});
    const size=(await stat(output)).size;if(size>(still?100*1024:LIMIT))continue;
    const b=await readFile(output),info=webpInfo(b);if(info.width!==512||info.height!==512)throw Error('Dimensión de salida inválida');
    if(!still&&info.frames===0) { if(info.width===512) return {path:output,animated:false,duration,bytes:size}; }
    return {path:output,animated:info.frames>0,duration:still?0:info.duration,bytes:size};
  }
  throw Error('No cabe en el límite de tamaño; prueba con dur=3.');
}
export async function makeAudio(input,dir,o,{duration=o.duration,mp3=false,pad=false,signal}={}){
  if(!(await probe(input,{signal})).audio)throw Error('El archivo no contiene audio');
  const output=join(dir,mp3?'audio.mp3':'audio.ogg');
  const af=[`volume=${o.volume/100}`];
  af.push(o.pitch ? `rubberband=tempo=${o.speed??1}:pitch=${2**(o.pitch/12)}` : `atempo=${o.speed??1}`);
  if(o.removeSilence&&!pad)af.push('silenceremove=start_periods=1:start_duration=0.1:start_threshold=-45dB:stop_periods=-1:stop_duration=0.25:stop_threshold=-45dB');
  if(o.effect==='radio')af.push('highpass=f=300','lowpass=f=3000');
  if(o.effect==='echo')af.push('aecho=0.8:0.8:70:0.25');
  if(o.normalize)af.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  af.push('alimiter=limit=0.95:latency=1');
  if(pad)af.push('apad');
  if(o.fadeIn)af.push(`afade=t=in:d=${Math.min(o.fadeIn,duration)}`);
  if(o.fadeOut)af.push(`afade=t=out:st=${Math.max(0,duration-o.fadeOut)}:d=${Math.min(o.fadeOut,duration)}`);
  await run(ff,[...base,'-ss',String(o.start),'-i',input,'-map','0:a:0','-vn','-af',af.join(','),'-t',String(duration),'-ac','1','-ar','48000','-c:a',mp3?'libmp3lame':'libopus','-b:a',mp3?'96k':'48k',output],{signal});
  const info=await probe(output,{signal});if(!info.audio||!(await stat(output)).size)throw Error('Audio inválido');return output;
}

export async function waveform(input, {signal} = {}) {
  const samples = await run(ff, [...base, '-i', input, '-map', '0:a:0', '-t', '180', '-ac', '1', '-ar', '4000', '-f', 's16le', 'pipe:1'], {signal,cap:1500000});
  const stride = Math.max(1, Math.ceil(samples.length / 2 / 96));
  const peaks = [];
  for(let start=0; start<samples.length/2; start+=stride) {
    let peak=0;
    for(let i=start; i<Math.min(samples.length/2,start+stride); i++) {
      peak=Math.max(peak, Math.abs(samples.readInt16LE(i*2)));
    }
    peaks.push(peak/32768);
  }
  return peaks;
}
export async function extra(input,dir,o,kind,{signal}={}){
  const p=await probe(input,{signal});if(!p.video)throw Error('Se necesita video');const photo=kind==='!foto',output=join(dir,photo?'foto.jpg':'gif.mp4');
  await run(ff,[...base,'-ss',String(o.start),...imageInput(input),'-i',input,'-map','0:v:0','-an','-vf',photo?'scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2':'fps=15,scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2',...(photo?['-frames:v','1','-q:v','3']:['-t',String(o.duration),'-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p','-movflags','+faststart']),output],{signal});return output;
}

export async function exportVideo(input,dir,{signal}={}){
 const p=await probe(input,{signal});if(!p.video||p.duration===null||p.duration>180)throw Error('Se necesita un video de hasta 3 minutos');const output=join(dir,'video.mp4');
 await run(ff,[...base,'-i',input,'-map','0:v:0','-map','0:a:0?','-vf','scale=720:720:force_original_aspect_ratio=decrease:force_divisible_by=2','-c:v','libx264','-preset','veryfast','-b:v','500k','-maxrate','650k','-bufsize','1300k','-c:a','aac','-b:a','64k','-pix_fmt','yuv420p','-movflags','+faststart',output],{timeout:90000,signal});
 if((await stat(output)).size>20*1024*1024)throw Error('El video convertido supera 20 MiB.');return output;
}
