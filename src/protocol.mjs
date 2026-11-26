// Experimental field 26, based on public interoperability documentation.
import {AsyncLocalStorage} from 'node:async_hooks';
import {readFile} from 'node:fs/promises';
const scope=new AsyncLocalStorage();
export function installAudioEncoder(proto){
 const S=proto.Message.StickerMessage,original=S.encode;
 S.encode=function(message,writer){const w=original.call(this,message,writer),ctx=scope.getStore();
  if(ctx&&message?.fileEncSha256&&Buffer.from(message.fileEncSha256).equals(ctx.hash))w.uint32(210).bytes(ctx.audio);return w;};
}
export async function sendSticker(api,sock,jid,visual,audio,quoted){
 const {prepareWAMessageMedia,generateWAMessageFromContent,proto}=api;
 if(!audio)return sock.sendMessage(jid,{sticker:await readFile(visual.path),isAnimated:visual.animated},{quoted});
 const upload={upload:sock.waUploadToServer};const seconds=Math.max(1,Math.ceil(visual.duration));
 const [s,a]=await Promise.all([
  prepareWAMessageMedia({sticker:await readFile(visual.path),isAnimated:visual.animated},upload),
  prepareWAMessageMedia({audio:await readFile(audio),mimetype:'audio/ogg; codecs=opus',seconds,ptt:true},upload)]);
 const sticker=s.stickerMessage,am=a.audioMessage;
 if(!sticker?.fileEncSha256||!am?.mediaKey)throw Error('No se pudo preparar la carga');
 Object.assign(sticker,{width:512,height:512,isAnimated:visual.animated});
 const audioBytes=proto.Message.AudioMessage.encode({...am,seconds,ptt:true}).finish();
 const userJid=jid.endsWith('@lid')&&sock.user?.lid?sock.user.lid:sock.user?.id;
 const message=generateWAMessageFromContent(jid,{stickerMessage:sticker},{quoted,userJid});
 await scope.run({hash:Buffer.from(sticker.fileEncSha256),audio:audioBytes},async()=>{
  // Fail closed if our encoded sticker does not contain the audio payload.
  const b=Buffer.from(proto.Message.encode(message.message).finish());if(!b.includes(Buffer.from(audioBytes)))throw Error('El protocolo no adjuntó el audio');
  await sock.relayMessage(jid,message.message,{messageId:message.key.id});
 });
}
