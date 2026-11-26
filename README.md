# StickerForge WA — 0.3.0 experimental

Bot privado de conversión multimedia para WhatsApp, escrito en módulos JavaScript ES y FFmpeg. No es un producto oficial de Meta. No se conecta a ningún bot público ni usa una API de conversión externa. La sesión de WhatsApp tiene acceso a mensajes de la cuenta vinculada; utiliza una cuenta secundaria y nunca compartas su carpeta de sesión. Existe riesgo de bloqueo por uso de un cliente no oficial. No se recomienda para automatización masiva ni para cuentas de negocio críticas.

## Instalador Windows x64

Ejecuta `StickerForge-WA-Setup-x64.exe` y elige **1. Iniciar bot**. El EXE incluye el código fuente y ofrece instalar las dependencias faltantes mediante WinGet y npm, con confirmación explícita. Requiere internet en el primer arranque y WinGet si faltan componentes. No es una compilación autónoma sin dependencias. No está firmado digitalmente. Los datos y la sesión se guardan en `%LOCALAPPDATA%\StickerForgeWA`. El menú 2 abre la configuración de usuarios autorizados. No se ha verificado el instalador en un Windows real ni la conexión WhatsApp.

Para compilar: Go 1.23+ y Python 3, ejecuta `python scripts/build.py`. El resultado está en `dist/`. El workflow genera un ejecutable y checksum y crea un prerelease al subir un tag `v*`, si pasan las pruebas. Para crear el repositorio público desde esta carpeta limpia, instala Git y GitHub CLI, ejecuta `gh auth login` y luego `powershell -ExecutionPolicy Bypass -File .\publicar.ps1` (la excepción de política afecta solo ese proceso). El script solicita confirmación y añade únicamente los archivos del proyecto explícitamente. No se publican sesiones.

Licencia MIT; véase LICENSE y NOTICE.md.

## Instalación manual (Windows)

1. Instala Node.js >=22.12 y FFmpeg con libwebp/libwebp_anim/libopus/libx264/libmp3lame y ffprobe. En PowerShell: `winget install OpenJS.NodeJS.LTS` y `winget install Gyan.FFmpeg`. Instala Git si npm lo requiere.
2. Abre una terminal nueva en esta carpeta. Ejecuta `npm install`, luego `npm test` y `npm start`. Alternativamente, `iniciar.cmd` instala dependencias y abre el bot.
3. Vincula la cuenta secundaria desde WhatsApp > Dispositivos vinculados. El QR solo se imprime localmente.
4. Prueba `!ayuda` en el chat contigo mismo de esa cuenta. Para usar otro teléfono, copia `.env.example` a `.env` y configura `ALLOWED_JIDS` con los JID exactos de chats permitidos. Ejemplo ilustrativo: `521XXXXXXXXXX@s.whatsapp.net`; WhatsApp puede usar también identificadores `@lid`. Reinicia el bot tras cambiar la configuración. No abras el acceso a desconocidos.

Linux: instala las mismas dependencias, usa `npm install` y `npm start`. El bot requiere una conexión persistente y acceso a los servidores de WhatsApp; no es adecuado para funciones serverless de corta duración. No se incluye servidor desplegado, credenciales ni binarios de terceros. Las dependencias directas tienen versiones fijadas; todavía no se ha generado package-lock porque el entorno de construcción no tuvo acceso al registro npm. Antes de desplegar, revisa el lockfile resultante y las dependencias con `npm audit`.

## Comandos

Envía un video o imagen con el texto como pie, o responde a un mensaje con el comando.

| Comando | Resultado |
|---|---|
| `!a` | Sticker con el sonido del video, recorte cuadrado centrado |
| `!s` | Sticker estático o animado, sin sonido |
| `!a modo=completo` | Encuadre completo con relleno transparente |
| `!a modo=negro` | Encuadre completo con relleno negro |
| `!a x=50 y=20` | Desplaza la zona de recorte |
| `!a inicio=2 dur=4` | Elige el fragmento |
| `!a vol=150 fps=12` | Control de volumen y FPS máximos |
| `!mezclar dur=5` | Responde a una imagen/video y luego manda audio en menos de 2 minutos |
| `!audio` | Extrae MP3 |
| `!voz` | Convierte a nota de voz Ogg/Opus |
| `!gif` | Envía un MP4 silencioso con gifPlayback |
| `!foto inicio=1` | Extrae fotograma JPEG |
| `!cancelar` | Cancela una mezcla pendiente |
| `!ayuda` | Muestra menú |

`x/y=0` corresponde al inicio del eje, `100` al final. Duración predeterminada 5 s, máximo configurable por comando 15 s. El cliente puede limitar la reproducción de clips largos. Se busca conservar proporciones, nunca estirar. El límite interno de tamaño es 500 KiB animado y 100 KiB estático. El codificador reduce FPS/calidad si hace falta; no se garantiza que cualquier clip quepa. La animación se valida por cabecera WebP y duración ANMF; el audio se recorta/rellena según la duración real de los cuadros. `!mezclar` con imagen estática es experimental y puede no reproducirse en el cliente.

## Enlaces de videos (nuevo en 0.2.0)

Instala [yt-dlp](https://github.com/yt-dlp/yt-dlp) para enlaces de redes sociales: `winget install yt-dlp.yt-dlp` y vuelve a abrir la terminal. Usa una versión actual, comprueba `yt-dlp --version`. Node.js ya instalado sirve como runtime JavaScript de yt-dlp; en algunas instalaciones YouTube requiere además los componentes oficiales EJS (consulta la documentación de yt-dlp). No se habilita descarga automática de componentes remotos. No es necesario yt-dlp para enlaces directos.

| Mensaje | Resultado |
|---|---|
| `https://youtu.be/AbCdEf12345` | Sticker con audio, centrado, 5 segundos |
| `!a https://youtu.be/AbCdEf12345 inicio=8 dur=4 y=20` | Sticker con sonido del fragmento elegido |
| `!s URL` | Sticker sin sonido |
| `!audio URL` | MP3 del fragmento |
| `!voz URL` | Nota de voz del fragmento |
| `!gif URL` | GIF silencioso |
| `!foto URL inicio=2` | Fotograma |
| `!video URL` | Video completo convertido a MP4, hasta 3 min |
| `!mezclar URL` | Video de fondo, luego envía una nota de voz/audio |

URL significa un enlace HTTPS real. Se reconocen publicaciones individuales de YouTube (incluyendo Shorts), TikTok, Instagram, Facebook y X, y enlaces HTTPS directos con extensión MP4, MOV, M4V o WebM. Los enlaces abreviados pueden fallar si el extractor requiere el extractor genérico (deshabilitado). No se descargan listas completas ni directos; no se usan cookies, cuentas ni credenciales para saltar restricciones. Solo formatos HTTPS combinados de hasta 720p (si se conoce la altura); no se fusionan pistas separadas. La disponibilidad depende de cada plataforma y sus condiciones; utiliza únicamente contenido que tengas derecho a descargar y reutilizar. Si no hay audio, usa !s.

Límites: descarga de 20 MiB medida durante el streaming, hasta 180 segundos de video y timeout de descarga de 90 s; los mismos límites de cola y autorización anteriores. El archivo se inspecciona con ffprobe y se elimina al finalizar. Los enlaces directos validan DNS IPv4 pública, fijan la IP de conexión y vuelven a validar cada redirección HTTPS; no se admiten direcciones IP literales ni puertos no estándar. Las redes sociales usan yt-dlp con lista de dominios/rutas iniciales, sin extractor genérico, configuraciones locales, cookies ni plugins. **yt-dlp no está aislado a nivel de red**: sus solicitudes internas no pasan por el filtro de IP del descargador directo; ejecútalo con usuario sin privilegios, firewall que bloquee redes internas/metadata y no autorices a desconocidos. Desactiva enlaces con `ENABLE_LINKS=0`.

Verificación 0.2.0: pruebas locales de parser, clasificación, rechazo de direcciones privadas, descarga simulada por proceso y conversión; sin prueba con las plataformas reales ni WhatsApp en este entorno.

## Seguridad y operación

- Solo chat propio o JIDs explícitamente autorizados; no acepta grupos, estados, envíos masivos ni mensajes view-once. Los comandos son voluntarios.
- Entrada de hasta 20 MiB, dos trabajos simultáneos, ocho pendientes, un trabajo por chat, limitación básica de frecuencia, deduplicación y vencimiento de comandos.
- Archivos multimedia temporales eliminados en finally; una terminación abrupta puede dejar temporales con prefijo `stickerforge-` en el directorio temporal del sistema. Los metadatos de una mezcla pendiente permanecen en memoria hasta vencimiento o cancelación, sin descargar el archivo anticipadamente.
- FFmpeg se ejecuta sin shell, con tiempo y tamaño de salida de consola limitados, filtros controlados y protocolos limitados a file/pipe. No es un sandbox completo: procesa solo archivos de confianza, ejecuta con un usuario sin privilegios, aplica actualizaciones de seguridad y aísla el proceso antes de exponerlo a terceros.
- Sesión en disco, excluida de Git por defecto. En Windows protege la carpeta con permisos del usuario; en Linux usa un usuario dedicado. No subas archivos de sesión a un repositorio (incluidos directorios de sesión personalizados). No se almacenan archivos de usuarios en una base de datos.
- Reconexión con backoff; no intenta volver a vincular si WhatsApp revoca la sesión. Sin telemetría propia.

## Estado de verificación

Probado localmente con Node 22.16 y FFmpeg 7.1: parser, video vertical con tres modos de encuadre, dimensiones y tamaño WebP, audio Opus y sincronía, imagen estática, MP3, fotograma y video GIF. No se instalaron dependencias de WhatsApp ni se probó un envío real; la integración de protocolo, permisos de JID/LID, descarga y reproducción de stickers con sonido requieren pruebas con una cuenta secundaria. No hay benchmark frente al original. El archivo de audio se incorpora mediante el campo protobuf experimental 26 usando un contexto asíncrono por envío para evitar mezclar audios entre trabajos. El protocolo puede cambiar sin aviso.

Referencia técnica: [WhatsApp Sound Sticker Bot](https://github.com/DavidRamirez206/whatsapp-sound-sticker-bot) (MIT), de Ismael Barrionuevo, y [documentación no oficial del protocolo](https://docs.baron0.com/WA_STICKERS/). Esta implementación modular se escribió para este proyecto y no incluye archivos descargados del repositorio original.
