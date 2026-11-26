import * as api from '@whiskeysockets/baileys';
import pino from 'pino';import qr from 'qrcode-terminal';
import {mkdir,mkdtemp,rm,readFile} from 'node:fs/promises';import {createWriteStream} from 'node:fs';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {pipeline} from 'node:stream/promises';import {Transform} from 'node:stream';
import {parseCommand,HELP} from './commands.mjs';import {makeSticker,makeAudio,extra,exportVideo,run} from './media.mjs';import {installAudioEncoder,sendSticker} from './protocol.mjs';
import {classifyLink,downloadLink} from './links.mjs';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { toDataURL } from 'qrcode';
import { encryptedAuth } from '../desktop/auth.mjs';
const {useMultiFileAuthState,fetchLatestBaileysVersion,DisconnectReason,downloadMediaMessage,proto}=api;
const makeSocket=api.default?.default??api.default;
const desktop = process.argv.includes('--desktop');
const channel = desktop ? createInterface({ input: process.stdin }) : null;
const config = desktop ? JSON.parse((await once(channel, 'line'))[0]) : {};
const report = (status, qr) => {
  if (desktop) process.stdout.write(JSON.stringify({ status, qr }) + '\n');
};
const logger=pino({level:'silent'});const session=resolve(config.session || process.env.SESSION_DIR||'session');
const allowed=new Set(config.allowed || (process.env.ALLOWED_JIDS||'').split(',').map(x=>x.trim()).filter(Boolean));
const maxBytes=20*1024*1024, parallel=2,queue=[],activeUsers=new Map(),seen=new Map(),pending=new Map(),last=new Map();let running=0,closing=false,sock,delay=1500;
const prefix = config.prefix || '!';
const interval = config.interval || 3000;
function clean(map,max,age){const now=Date.now();for(const [k,v] of map){if(now-(typeof v==='number'?v:v.at)>age)map.delete(k);}while(map.size>max)map.delete(map.keys().next().value);}
function pump(){while(running<parallel&&queue.length){const job=queue.shift();running++;job().catch(()=>{}).finally(()=>{running--;pump();});}}
function content(m){let c=m.message??{};for(let i=0;i<4&&c.ephemeralMessage?.message;i++)c=c.ephemeralMessage.message;return c;}
function media(c){for(const [type,k] of [['image','imageMessage'],['video','videoMessage'],['audio','audioMessage'],['document','documentMessage']])if(c[k]){
 const v=c[k];if(type==='document'){const mime=v.mimetype??'';if(!/^(image|video|audio)\//.test(mime)||mime==='image/svg+xml')return null;return {kind:mime==='image/gif'?'video':mime.split('/')[0],data:v};}return {kind:type,data:v};}return null;}
function request(m){const c=content(m),own=media(c),text=c.conversation??c.extendedTextMessage?.text??own?.data.caption??'';const ctx=c.extendedTextMessage?.contextInfo??own?.data.contextInfo;
 if(own)return {text,source:{message:c,key:m.key},kind:own.kind};
 if(ctx?.quotedMessage&&ctx.stanzaId){const q=media(ctx.quotedMessage);if(q)return {text,kind:q.kind,source:{message:ctx.quotedMessage,key:{remoteJid:m.key.remoteJid,id:ctx.stanzaId,participant:ctx.participant,fromMe:false}}};}return {text};}
async function download(s,m,path,parent){const info=media(content(m));if(!info)throw Error('Archivo no admitido');if(Number(info.data.fileLength)>maxBytes)throw Error('Máximo 20 MB');
 const signal=AbortSignal.any([AbortSignal.timeout(45000),parent]);let total=0;
 const stream=await downloadMediaMessage(m,'stream',{options:{signal}},{logger,reuploadRequest:s.updateMediaMessage});if(signal.aborted){stream.destroy();throw Error('Descarga interrumpida');}
 await pipeline(stream,new Transform({transform(chunk,_enc,cb){total+=chunk.length;cb(total>maxBytes?Error('Máximo 20 MB'):null,chunk);}}),createWriteStream(path,{flags:'wx',mode:0o600}),{signal});}
const reply=(s,m,text)=>s.sendMessage(m.key.remoteJid,{text},{quoted:m});
async function processJob(s,m,r,parsed,second,signal){const dir=await mkdtemp(join(tmpdir(),'stickerforge-'));try{
 signal.throwIfAborted();
 const input=join(dir,'input.bin');if(r.url)await downloadLink(r.url,input,{signal,directOnly:desktop});else await download(s,r.source,input,signal);const o=parsed.options,cmd=parsed.cmd,jid=m.key.remoteJid;
 if(cmd==='!video'){const p=await exportVideo(input,dir,{signal});signal.throwIfAborted();await s.sendMessage(jid,{video:await readFile(p),mimetype:'video/mp4'},{quoted:m});}
 else if(['!a','!s','!mezclar'].includes(cmd)){
  const still=r.kind==='image';if(!['video','image'].includes(r.kind))throw Error('Se necesita imagen o video');if(still&&cmd==='!a')throw Error('Usa !mezclar para añadir audio a una imagen');
  const visual=await makeSticker(input,dir,o,{still,signal});let audio;
  if(cmd==='!a'||cmd==='!mezclar'){
   let source=input,ao=o;if(second){source=join(dir,'sound.bin');await download(s,second,source,signal);ao={...o,start:0};}
   if(still)visual.duration=o.duration;
   audio=await makeAudio(source,dir,ao,{duration:visual.duration,pad:true,signal});
  }
  signal.throwIfAborted();await sendSticker(api,s,jid,visual,audio,m);
 }else if(cmd==='!audio'||cmd==='!voz'){
  const p=await makeAudio(input,dir,o,{mp3:cmd==='!audio',signal}),b=await readFile(p);signal.throwIfAborted();await s.sendMessage(jid,cmd==='!voz'?{audio:b,mimetype:'audio/ogg; codecs=opus',ptt:true}:{document:b,mimetype:'audio/mpeg',fileName:'audio.mp3'},{quoted:m});
 }else{const p=await extra(input,dir,o,cmd,{signal}),b=await readFile(p);signal.throwIfAborted();await s.sendMessage(jid,cmd==='!foto'?{image:b}:{video:b,gifPlayback:true},{quoted:m});}
 }finally{await rm(dir,{recursive:true,force:true});}}
async function handle(s,m){const jid=m.key.remoteJid;if(!jid||!(/@(s\.whatsapp\.net|lid)$/.test(jid)))return;
 const self=!!m.key.fromMe;const own=[s.user?.id,s.user?.lid].filter(Boolean).map(x=>x.replace(/:\d+@/,'@'));const isSelf=self&&own.includes(jid);if(self&&!isSelf)return;
 const identities=[jid,m.key.remoteJidAlt].filter(Boolean);if(!isSelf&&!identities.some(x=>allowed.has(x)))return;
 const age=Date.now()/1000-Number(m.messageTimestamp||0);if(age>120||age< -60)return;
 clean(seen,500,300000);clean(pending,50,120000);clean(last,500,60000);const id=`${jid}:${m.key.id}`;if(seen.has(id))return;seen.set(id,Date.now());
 const r=request(m);const text=r.text.trim();let parsed;
 try{if(text.startsWith(prefix)||/^https:\/\//i.test(text))parsed=parseCommand(text.startsWith(prefix)?'!'+text.slice(prefix.length):text);if(parsed?.url){const link=classifyLink(parsed.url);if(process.env.ENABLE_LINKS==='0')throw Error('Descarga por enlaces desactivada.');if(link.type==='platform'&&(desktop||process.env.ENABLE_UNISOLATED_EXTRACTORS!=='1'))throw Error('El extractor requiere aislamiento de red. Usa un enlace directo HTTPS.');r.url=parsed.url;r.kind='video';r.source=undefined;}}catch(e){await reply(s,m,e.message);return;}
 if(parsed?.cmd==='!ayuda'){await reply(s,m,HELP.replaceAll('!',prefix));return;}
 if(parsed?.cmd==='!estado'){await reply(s,m,`Bot conectado · ${running} en curso · ${queue.length} en espera`);return;}
 if(parsed?.cmd==='!config'){await reply(s,m,`Modo privado · Prefijo ${prefix} · Límite de archivo: 20 MiB`);return;}
 if(parsed?.cmd==='!cancelar'){const mixing=pending.delete(jid);const task=activeUsers.get(jid);task?.abort();await reply(s,m,mixing||task?'Cancelación solicitada.':'No hay un trabajo pendiente.');return;}
 if(parsed?.cmd==='!mezclar'){if((!r.source&&!r.url)||!['image','video'].includes(r.kind)){await reply(s,m,'Responde a una imagen o video con !mezclar.');return;}pending.set(jid,{at:Date.now(),r,parsed});await reply(s,m,'Envía el audio o nota de voz en los próximos 2 minutos.');return;}
 let second,job=r;if(!parsed&&r.kind==='audio'&&pending.has(jid)){const p=pending.get(jid);pending.delete(jid);parsed=p.parsed;job=p.r;second=r.source;}
 if(!parsed)return;if(!job.source&&!job.url){await reply(s,m,'Adjunta o responde a un archivo, o envía un enlace. Usa !ayuda.');return;}
 if(activeUsers.has(jid)||queue.length>=8||Date.now()-(last.get(jid)||0)<interval){await reply(s,m,'Hay un trabajo en curso o la cola está llena. Intenta después.');return;}
 const controller=new AbortController();
 activeUsers.set(jid,controller);last.set(jid,Date.now());queue.push(async()=>{try{await processJob(s,m,job,parsed,second,controller.signal);}catch(e){if(!controller.signal.aborted&&!closing){console.error('[trabajo] error de procesamiento');try{await reply(s,m,/protocolo/.test(e.message)?'WhatsApp no pudo adjuntar el audio del sticker.':'No se pudo procesar el archivo o descargar el video.');}catch{}}}finally{activeUsers.delete(jid);}});pump();}
await mkdir(session,{recursive:true,mode:0o700});
const auth = desktop ? await encryptedAuth(session, Buffer.from(config.key, 'hex'), api) : await useMultiFileAuthState(session);
async function connect(){if(closing)return;const {state,saveCreds}=auth;const {version}=await fetchLatestBaileysVersion();if(closing)return;const s=makeSocket({version,auth:state,logger,syncFullHistory:false,markOnlineOnConnect:false});sock=s;
 s.ev.on('creds.update',()=>saveCreds().catch(()=>console.error('No se pudo guardar la sesión')));
 s.ev.on('connection.update',({connection,lastDisconnect,qr:code})=>{
 if(code){
   if (desktop) void toDataURL(code, { margin: 2, width: 260 }).then(image => { if(sock===s&&!closing)report('qr', image); }).catch(()=>report('error'));
   else { console.log('Escanea el QR desde Dispositivos vinculados. No lo compartas.');qr.generate(code,{small:true}); }
 }
 if(connection==='open'){delay=1500;report('connected');if(!desktop)console.log('Conectado. Usa !ayuda en el chat contigo mismo o desde un JID autorizado.');}
 if(connection==='close'&&sock===s&&!closing){const status=lastDisconnect?.error?.output?.statusCode;if([DisconnectReason.loggedOut,DisconnectReason.connectionReplaced,DisconnectReason.forbidden,DisconnectReason.badSession].includes(status)){report('ended');console.error('Sesión finalizada. Revisa Dispositivos vinculados.');return;}report('connecting');const wait=delay;delay=Math.min(30000,delay*2);setTimeout(()=>connect().catch(()=>{report('error');console.error('Reconexión fallida. Reinicia el bot.');}),wait);}});
 s.ev.on('messages.upsert',({type,messages})=>{if(type!=='notify'||closing||sock!==s)return;for(const m of messages)handle(s,m).catch(()=>console.error('[mensaje] error'));});}
async function stop(unlink) {
  if (closing) return;
  closing = true;
  queue.length = 0;
  for (const task of activeUsers.values()) task.abort();
  setTimeout(() => process.exit(1), 8000).unref();
  try {
    if (unlink) await sock?.logout();
    else sock?.end(undefined);
    await auth.flush?.();
    if (unlink) await rm(join(session, 'state.bin'), { force: true });
    process.exit(0);
  } catch {
    process.exit(1);
  }
}
channel?.on('line', line => { if (line === 'stop' || line === 'unlink') void stop(line === 'unlink'); });
channel?.on('close', () => void stop(false));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void stop(false));
await run(process.env.FFMPEG_PATH||'ffmpeg',['-version']);await run(process.env.FFPROBE_PATH||'ffprobe',['-version']);installAudioEncoder(proto);await connect();
