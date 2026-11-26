import {spawn} from 'node:child_process';
import {request} from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {createWriteStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {probe} from './media.mjs';
export const MAX_LINK_BYTES=20*1024*1024;
const MAX_SECONDS=180;
const hosts={youtube:['youtube.com','www.youtube.com','m.youtube.com','youtu.be'],tiktok:['tiktok.com','www.tiktok.com','m.tiktok.com','vm.tiktok.com','vt.tiktok.com'],instagram:['instagram.com','www.instagram.com'],facebook:['facebook.com','www.facebook.com','m.facebook.com','fb.watch'],x:['x.com','www.x.com','twitter.com','www.twitter.com','mobile.twitter.com']};
function httpsUrl(raw){let u;try{u=new URL(raw);}catch{throw Error('Enlace inválido.');}if(raw.length>4096||u.protocol!=='https:'||u.username||u.password||u.port||isIP(u.hostname.replace(/^\[|\]$/g,''))||!u.hostname.includes('.'))throw Error('Solo enlaces HTTPS públicos sin credenciales ni IP.');u.hash='';return u;}
export function classifyLink(raw){const u=httpsUrl(raw),h=u.hostname,p=u.pathname;
 if(hosts.youtube.includes(h)&&((h==='youtu.be'&&/^\/[\w-]{11}\/?$/.test(p))||(/^\/(shorts|embed)\/[\w-]{11}\/?$/.test(p))||(p==='/watch'&&/^[\w-]{11}$/.test(u.searchParams.get('v')||'')))){const id=p==='/watch'?u.searchParams.get('v'):p.split('/').filter(Boolean).at(-1);return {type:'platform',site:'youtube',url:`https://www.youtube.com/watch?v=${id}`};}
 if(hosts.tiktok.includes(h)&&(/^(\/@[^/]+\/video\/\d+|\/t\/[\w-]+)\/?$/.test(p)||(['vm.tiktok.com','vt.tiktok.com'].includes(h)&&/^\/[\w-]+\/?$/.test(p))))return {type:'platform',site:'tiktok',url:u.href};
 if(hosts.instagram.includes(h)&&/^\/(reel|reels|p|tv)\/[\w-]+\/?$/.test(p))return {type:'platform',site:'instagram',url:u.href};
 if(hosts.facebook.includes(h)&&((h==='fb.watch'&&/^\/[\w-]+\/?$/.test(p))||/^\/(reel\/\d+|share\/(r|v)\/[\w-]+|[^/]+\/videos\/\d+)\/?$/.test(p)||(p==='/watch/'||p==='/watch')&&/^\d+$/.test(u.searchParams.get('v')||'')))return {type:'platform',site:'facebook',url:u.href};
 if(hosts.x.includes(h)&&/^\/(?:[\w]+\/status|i\/web\/status)\/\d+\/?$/.test(p))return {type:'platform',site:'x',url:u.href};
 if(Object.values(hosts).flat().includes(h))throw Error('Envía el enlace de un video individual, no un perfil o lista.');
 if(/\.(mp4|webm|mov|m4v)$/i.test(p))return {type:'direct',url:u.href};
 throw Error('Enlace no admitido. Usa un video de YouTube, TikTok, Instagram, Facebook, X o un archivo MP4/WebM/MOV público.');}
export function publicIPv4(ip){if(isIP(ip)!==4)return false;const [a,b,c]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===88&&c===99)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);}
function limit(){let n=0;return new Transform({transform(b,_e,cb){n+=b.length;cb(n>MAX_LINK_BYTES?Error('El video supera 20 MiB.'):null,b);}});}
async function direct(raw,out,signal,redirects=0){const u=httpsUrl(raw);const addresses=await lookup(u.hostname,{all:true,family:4});if(!addresses.length||addresses.some(a=>!publicIPv4(a.address)))throw Error('Destino de red no permitido.');signal.throwIfAborted();const ip=addresses[0].address;
 const res=await new Promise((resolve,reject)=>{const req=request(u,{signal,agent:false,family:4,autoSelectFamily:false,lookup:(_h,o,cb)=>o.all?cb(null,[{address:ip,family:4}]):cb(null,ip,4),headers:{'Accept':'video/*, application/octet-stream','Accept-Encoding':'identity'}},resolve);req.on('error',reject);req.end();});
 if([301,302,303,307,308].includes(res.statusCode)){res.destroy();if(redirects>=3||!res.headers.location)throw Error('Demasiadas redirecciones.');return direct(new URL(res.headers.location,u).href,out,signal,redirects+1);}
 if(res.statusCode!==200||! /^(video\/|application\/octet-stream)/i.test(res.headers['content-type']||'')||Number(res.headers['content-length'])>MAX_LINK_BYTES){res.destroy();throw Error('Archivo remoto no disponible, demasiado grande o no es un video.');}
 await pipeline(res,limit(),createWriteStream(out,{flags:'wx',mode:0o600}),{signal});}
export function downloaderArgs(url){return ['--ignore-config','--no-plugin-dirs','--no-remote-components','--no-cookies','--no-cookies-from-browser','--no-cache-dir','--no-playlist','--playlist-items','1','--use-extractors','default,-generic','--default-search','error','--socket-timeout','12','--retries','1','--extractor-retries','1','--fragment-retries','1','--match-filters',`!is_live & duration <= ${MAX_SECONDS}`,'--max-filesize','20M','--no-progress','--js-runtimes','node','--format','best[height<=?720][protocol=https]','-o','-','--',url];}
async function platform(url,out,signal){const child=spawn(process.env.YTDLP_PATH||'yt-dlp',downloaderArgs(url),{shell:false,windowsHide:true,stdio:['ignore','pipe','ignore'],signal});const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',c=>c===0?resolve():reject(Error('No se pudo obtener el video público. Revisa el enlace, los límites o la instalación de yt-dlp.')));});const transfer=pipeline(child.stdout,limit(),createWriteStream(out,{flags:'wx',mode:0o600}),{signal});try{await Promise.all([exit,transfer]);}catch(e){child.kill('SIGKILL');await Promise.allSettled([exit,transfer]);if(e.code==='ENOENT')throw Error('Instala yt-dlp para usar enlaces de redes sociales.');throw e;}}
export async function downloadLink(raw,out){const link=classifyLink(raw),signal=AbortSignal.timeout(90000);try{if(link.type==='direct')await direct(link.url,out,signal);else await platform(link.url,out,signal);const s=await stat(out);if(!s.size||s.size>MAX_LINK_BYTES)throw Error('Video vacío o demasiado grande.');const p=await probe(out);if(!p.video||p.duration===null||p.duration<=0||p.duration>MAX_SECONDS)throw Error('Se requiere un video de hasta 3 minutos.');return p;}catch(e){if(signal.aborted)throw Error('Tiempo de descarga agotado.');throw e;}}
