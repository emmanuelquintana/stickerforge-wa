export const HELP = `StickerForge 🛠️\nEnvía un archivo con el comando, responde a un archivo o manda un enlace HTTPS de video. Un enlace solo equivale a !a.\n!video — descargar y devolver el video desde un enlace\n!a — sticker con sonido, cuadrado\n!s — sticker sin sonido\n!mezclar — elige imagen/video y después envía audio\n!audio — extraer audio como archivo MP3\n!voz — convertir audio/video a nota de voz\n!gif — video corto sin sonido, como GIF de WhatsApp\n!foto — extraer fotograma\n!cancelar — cancelar mezcla pendiente\n!ayuda — menú\nOpciones de !a, !s y !mezclar: modo=corte|completo|negro, x=0..100, y=0..100, inicio=0..120, dur=0.5..15, vol=0..200, fps=5|6|8|10|12|15.\nEjemplo: !a inicio=2 dur=5 y=20\nCompleto conserva el encuadre con relleno transparente. Negro usa relleno negro.`;
const aliases = { '!sticker':'!s', '!sonido':'!a', '!help':'!ayuda', '!menu':'!ayuda',
  '!recorte':'!s', '!invertir':'!s', '!lento':'!a', '!rapido':'!a', '!volumen':'!a', '!efecto':'!a' };
export function parseCommand(text) {
  if (typeof text !== 'string') return null;
  const tokens=text.trim().split(/\s+/);
  if(/^https:\/\//i.test(tokens[0])) tokens.unshift('!a');
  if(!tokens[0].startsWith('!')) return null;
  const raw=tokens.shift().toLowerCase(),cmd=aliases[raw]??raw;
  let url;const args=[];for(const token of tokens){if(/^https:\/\//i.test(token)){if(url)throw Error('Envía un solo enlace.');url=token;}else args.push(token.toLowerCase());}
  if (!['!a','!s','!mezclar','!audio','!voz','!gif','!foto','!cancelar','!ayuda','!video','!estado','!config'].includes(cmd)) return null;
  const o={mode:'corte',x:50,y:50,start:0,duration:5,volume:100,fps:15};
  if(raw==='!invertir')o.flip=true;
  if(raw==='!lento')o.speed=0.75;
  if(raw==='!rapido')o.speed=1.5;
  if(raw==='!efecto')o.effect='radio';
  const spec={x:['x',0,100],y:['y',0,100],inicio:['start',0,120],dur:['duration',0.5,15],vol:['volume',0,200],fps:['fps',5,15],zoom:['zoom',1,3],vel:['speed',0.5,2]};
  const seen=new Set();
  for(const a of args){const [k,v,...rest]=a.split('='); if(!v||rest.length||seen.has(k)) throw Error('Opción inválida o repetida. Usa !ayuda.');seen.add(k);
    if(k==='modo'&&['corte','completo','negro'].includes(v)){o.mode=v;continue;}
    if(k==='efecto'&&['radio','echo'].includes(v)){o.effect=v;continue;}
    if(!Object.hasOwn(spec,k)||!/^\d+(\.\d+)?$/.test(v)) throw Error('Opción inválida. Usa !ayuda.');
    const [key,min,max]=spec[k],n=Number(v); if(n<min||n>max||(k==='fps'&&![5,6,8,10,12,15].includes(n))) throw Error(`Valor inválido: ${k}`); o[key]=n;
  }
  return {cmd,options:o,...(url?{url}:{})};
}
