# StickerForge Desktop

[English](README.md)

Editor multimedia local para Windows x64 con un bot privado de WhatsApp opcional. Sticker Studio exporta WebP cuadrados de 512 × 512. Audio Studio exporta Ogg/Opus y MP3. El historial y los paquetes se guardan en este equipo.

## Instalar y usar

1. Abre el instalador EXE o MSI. Para la edición portable, extrae el ZIP completo y ejecuta `stickerforge.exe` junto a la carpeta `engine`.
2. En la bienvenida, elige idioma, tema y **Preparar motor**. El asistente descarga FFmpeg y FFprobe con verificación SHA-256. Después, las conversiones de archivos locales funcionan sin Internet.
3. Abre Sticker Studio e importa un archivo. Ajusta el fragmento y el encuadre, renderiza una vista previa y exporta. Puedes guardar copias desde el historial.
4. Para vincular WhatsApp, abre la sección WhatsApp, configura los números autorizados e inicia el bot. Escanea el QR con **Dispositivos vinculados** en el teléfono. Baileys es una integración no oficial. Usa una cuenta secundaria por el riesgo de suspensión.

El descargador admite enlaces directos HTTPS a videos públicos de hasta 20 MiB y 3 minutos. Los extractores de redes sociales requieren aislamiento de red adicional. Los paquetes `.sfpack` se comparten entre instalaciones de StickerForge y contienen archivos WebP. Su importación directa en WhatsApp no está validada.

## Desarrollo

`npm ci`, `npm run build` y `npm test`. Las pruebas multimedia necesitan FFmpeg y FFprobe en PATH. Para generar los paquetes en Windows, ejecuta `pwsh -File scripts/stage-windows.ps1` y después `npm run desktop -- build --ci`. Consulta [arquitectura](ARCHITECTURE.md), [comandos](COMMANDS.md) y [seguridad](SECURITY.md).
