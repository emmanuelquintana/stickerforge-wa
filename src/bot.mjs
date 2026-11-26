import * as api from '@whiskeysockets/baileys';
import pino from 'pino';import qr from 'qrcode-terminal';
import {mkdir,mkdtemp,rm,readFile} from 'node:fs/promises';import {createWriteStream} from 'node:fs';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {pipeline} from 'node:stream/promises';import {Transform} from 'node:stream';
import {parseCommand,HELP} from './commands.mjs';import {makeSticker,makeAudio,extra,exportVideo,run} from './media.mjs';import {installAudioEncoder,sendSticker} from './protocol.mjs';
import {classifyLink,downloadLink} from './links.mjs';
const {useMultiFileAuthState,fetchLatestBaileysVersion,DisconnectReason,downloadMediaMessage,proto}=api;
const makeSocket=api.default?.default??api.default;
const logger=pino({level:'silent'});const session=resolve(process.env.SESSION_DIR||'session');
const allowed=new Set((process.env.ALLOWED_JIDS||'').split(',').map(x=>x.trim()).filter(Boolean));
const maxBytes=20*1024*1024, parallel=2,queue=[],activeUsers=new Set(),seen=new Map(),pending=new Map(),last=new Map();let running=0,closing=false,sock,delay=1500;
function clean(map,max,age){const now=Date.now();for(const [k,v] of map){if(now-(typeof v==='number'?v:v.at)>age)map.delete(k);}while(map.size>max)map.delete(map.keys().next().value);}
function pump(){while(running<parallel&&queue.length){const job=queue.shift();running++;job().catch(()=>{}).finally(()=>{running--;pump();});}}
function content(m){let c=m.message??{};for(let i=0;i<4&&c.ephemeralMessage?.message;i++)c=c.ephemeralMessage.message;return c;}
function media(c){for(const [type,k] of [['image','imageMessage'],['video','videoMessage'],['audio','audioMessage'],['document','documentMessage']])if(c[k]){
 const v=c[k];if(type==='document'){const mime=v.mimetype??'';if(!/^(image|video|audio)\//.test(mime)||mime==='image/svg+xml')return null;return {kind:mime==='image/gif'?'video':mime.split('/')[0],data:v};}return {kind:type,data:v};}return null;}
function request(m){const c=content(m),own=media(c),text=c.conversation??c.extendedTextMessage?.text??own?.data.caption??'';const ctx=c.extendedTextMessage?.contextInfo??own?.data.contextInfo;
 if(own)return {text,source:{message:c,key:m.key},kind:own.kind};
 if(ctx?.quotedMessage&&ctx.stanzaId){const q=media(ctx.quotedMessage);if(q)return {text,kind:q.kind,source:{message:ctx.quotedMessage,key:{remoteJid:m.key.remoteJid,id:ctx.stanzaId,participant:ctx.participant,fromMe:false}}};}return {text};}
async function download(s,m,path){const info=media(content(m));if(!info)throw Error('Archivo no admitido');if(Number(info.data.fileLength)>maxBytes)throw Error('Máximo 20 MB');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);let total=0;
 try{const stream=await downloadMediaMessage(m,'stream',{options:{signal:controller.signal}},{logger,reuploadRequest:s.updateMediaMessage});if(controller.signal.aborted){stream.destroy();throw Error('Descarga agotada');}
 await pipeline(stream,new Transform({transform(chunk,_enc,cb){total+=chunk.length;cb(total>maxBytes?Error('Máximo 20 MB'):null,chunk);}}),createWriteStream(path,{flags:'wx',mode:0o600}),{signal:controller.signal});}finally{clearTimeout(timer);}}
const reply=(s,m,text)=>s.sendMessage(m.key.remoteJid,{text},{quoted:m});
async function processJob(s,m,r,parsed,second){const dir=await mkdtemp(join(tmpdir(),'stickerforge-'));try{
 const input=join(dir,'input.bin');if(r.url)await downloadLink(r.url,input);else await download(s,r.source,input);const o=parsed.options,cmd=parsed.cmd,jid=m.key.remoteJid;
 if(cmd==='!video'){const p=await exportVideo(input,dir);await s.sendMessage(jid,{video:await readFile(p),mimetype:'video/mp4'},{quoted:m});}
 else if(['!a','!s','!mezclar'].includes(cmd)){
  const still=r.kind==='image';if(!['video','image'].includes(r.kind))throw Error('Se necesita imagen o video');if(still&&cmd==='!a')throw Error('Usa !mezclar para añadir audio a una imagen');
  const visual=await makeSticker(input,dir,o,{still});let audio;
  if(cmd==='!a'||cmd==='!mezclar'){
   let source=input,ao=o;if(second){source=join(dir,'sound.bin');await download(s,second,source);ao={...o,start:0};}
   if(still)visual.duration=o.duration;
   audio=await makeAudio(source,dir,ao,{duration:visual.duration,pad:true});
  }
  await sendSticker(api,s,jid,visual,audio,m);
 }else if(cmd==='!audio'||cmd==='!voz'){
  const p=await makeAudio(input,dir,o,{mp3:cmd==='!audio'}),b=await readFile(p);await s.sendMessage(jid,cmd==='!voz'?{audio:b,mimetype:'audio/ogg; codecs=opus',ptt:true}:{document:b,mimetype:'audio/mpeg',fileName:'audio.mp3'},{quoted:m});
 }else{const p=await extra(input,dir,o,cmd),b=await readFile(p);await s.sendMessage(jid,cmd==='!foto'?{image:b}:{video:b,gifPlayback:true},{quoted:m});}
 }finally{await rm(dir,{recursive:true,force:true});}}
async function handle(s,m){const jid=m.key.remoteJid;if(!jid||!(/@(s\.whatsapp\.net|lid)$/.test(jid)))return;
 const self=!!m.key.fromMe;const own=[s.user?.id,s.user?.lid].filter(Boolean).map(x=>x.replace(/:\d+@/,'@'));const isSelf=self&&own.includes(jid);if(self&&!isSelf)return;
 const identities=[jid,m.key.remoteJidAlt].filter(Boolean);if(!isSelf&&!identities.some(x=>allowed.has(x)))return;
 const age=Date.now()/1000-Number(m.messageTimestamp||0);if(age>120||age< -60)return;
 clean(seen,500,300000);clean(pending,50,120000);clean(last,500,60000);const id=`${jid}:${m.key.id}`;if(seen.has(id))return;seen.set(id,Date.now());
 const r=request(m);let parsed;try{parsed=parseCommand(r.text);if(parsed?.url){classifyLink(parsed.url);if(process.env.ENABLE_LINKS==='0')throw Error('Descarga por enlaces desactivada.');r.url=parsed.url;r.kind='video';r.source=undefined;}}catch(e){await reply(s,m,e.message);return;}
 if(parsed?.cmd==='!ayuda'){await reply(s,m,HELP);return;}if(parsed?.cmd==='!cancelar'){pending.delete(jid);await reply(s,m,'Mezcla cancelada.');return;}
 if(parsed?.cmd==='!mezclar'){if((!r.source&&!r.url)||!['image','video'].includes(r.kind)){await reply(s,m,'Responde a una imagen o video con !mezclar.');return;}pending.set(jid,{at:Date.now(),r,parsed});await reply(s,m,'Envía el audio o nota de voz en los próximos 2 minutos.');return;}
 let second,job=r;if(!parsed&&r.kind==='audio'&&pending.has(jid)){const p=pending.get(jid);pending.delete(jid);parsed=p.parsed;job=p.r;second=r.source;}
 if(!parsed)return;if(!job.source&&!job.url){await reply(s,m,'Adjunta o responde a un archivo, o envía un enlace. Usa !ayuda.');return;}
 if(activeUsers.has(jid)||queue.length>=8||Date.now()-(last.get(jid)||0)<3000){await reply(s,m,'Hay un trabajo en curso o la cola está llena. Intenta después.');return;}
 activeUsers.add(jid);last.set(jid,Date.now());queue.push(async()=>{try{await processJob(s,m,job,parsed,second);}catch(e){console.error('[trabajo] error de procesamiento');try{await reply(s,m,`No se pudo completar: ${/FFmpeg|ffprobe/.test(e.message)?'formato no compatible o error de conversión':e.message.slice(0,140)}`);}catch{}}finally{activeUsers.delete(jid);}});pump();}
async function connect(){if(closing)return;const {state,saveCreds}=await useMultiFileAuthState(session);const {version}=await fetchLatestBaileysVersion();const s=makeSocket({version,auth:state,logger,syncFullHistory:false,markOnlineOnConnect:false});sock=s;
 s.ev.on('creds.update',()=>saveCreds().catch(()=>console.error('No se pudo guardar la sesión')));
 s.ev.on('connection.update',({connection,lastDisconnect,qr:code})=>{
 if(code){console.log('Escanea el QR desde Dispositivos vinculados. No lo compartas.');qr.generate(code,{small:true});}
 if(connection==='open'){delay=1500;console.log('Conectado. Usa !ayuda en el chat contigo mismo o desde un JID autorizado.');}
 if(connection==='close'&&sock===s&&!closing){const status=lastDisconnect?.error?.output?.statusCode;if([DisconnectReason.loggedOut,DisconnectReason.connectionReplaced,DisconnectReason.forbidden,DisconnectReason.badSession].includes(status)){console.error('Sesión finalizada. Revisa Dispositivos vinculados.');return;}const wait=delay;delay=Math.min(30000,delay*2);setTimeout(()=>connect().catch(()=>{console.error('Reconexión fallida. Reinicia el bot.');}),wait);}});
 s.ev.on('messages.upsert',({type,messages})=>{if(type!=='notify'||closing||sock!==s)return;for(const m of messages)handle(s,m).catch(()=>console.error('[mensaje] error'));});}
await mkdir(session,{recursive:true,mode:0o700});await run(process.env.FFMPEG_PATH||'ffmpeg',['-version']);await run(process.env.FFPROBE_PATH||'ffprobe',['-version']);installAudioEncoder(proto);await connect();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{closing=true;queue.length=0;try{sock?.end(undefined);}catch{};setTimeout(()=>process.exit(0),1000).unref();});
