# IPHub — Backend real (Node.js + Express + base de datos en disco)

Esto **no es una demo**. El servidor Express ejecuta operaciones de red reales
contra el sistema operativo donde corra, y guarda todo en un archivo `db.json`
real que persiste entre reinicios.

## 1. Instalar

Necesitás [Node.js](https://nodejs.org) 18 o superior instalado.

```bash
cd iphub
npm install
cp .env.example .env
# Editá .env y poné un JWT_SECRET largo y aleatorio, y tu CIDR de LAN real
```

## 2. Correr

```bash
npm start
```

Abrí `http://localhost:3001` en el navegador. Registrate (se crea un usuario
real, con contraseña hasheada con bcrypt, guardado en `db.json`).

## 3. Qué es real y qué depende de tu sistema

| Función | Cómo funciona de verdad | Requisito |
|---|---|---|
| Login/registro | bcrypt + JWT, persistido en `db.json` | Ninguno |
| Auditoría | Cada acción se graba con timestamp real | Ninguno |
| Analizador de IP | Llama a la API pública `ip-api.com` desde el server | Salida a internet |
| Escaneo de puertos | `net.Socket.connect()` real contra el host que pongas | Que el host sea alcanzable desde donde corre el server |
| Traceroute | Ejecuta `traceroute` (Linux/Mac) o `tracert` (Windows) del sistema operativo | El binario debe estar instalado (en Linux: `apt install traceroute`) |
| DNS | Módulo `dns` nativo de Node, consulta resolvers reales | Ninguno |
| ARP / tabla MAC | Ejecuta `arp -a` del sistema operativo | Solo ve hosts con los que tu equipo ya tuvo tráfico |
| Descubrir red (ping sweep) | Pinguea cada IP real del rango /24 que indiques + cruza con ARP | El server debe estar en la misma LAN que querés mapear |
| Speedtest | Descarga/sube bytes reales entre tu navegador y este servidor y mide el tiempo real | Mide el enlace hasta **este** servidor, no "internet" en abstracto — si lo corrés en tu PC vía localhost vas a medir tu loopback; para medir tu enlace a internet real, desplegalo en un VPS |

## 4. Lo único que NO se puede hacer nunca desde acá (no es limitación mía, es física/protocolo)

- Un navegador **nunca** puede hacer ARP/ICMP crudo por sí solo — por eso todo
  esto vive en el backend Node, que sí tiene acceso a sockets del sistema operativo.
- "Aislar" un dispositivo de la red real requeriría tocar reglas de firewall
  (`iptables`/Windows Firewall) con privilegios root/admin. Por seguridad, esta
  versión solo lo **marca como sospechoso** en la base de datos — no ejecuta
  cambios de firewall automáticos. Si querés eso, decímelo y lo agregamos como
  un paso explícito y confirmado (nunca automático).

## 5. Email real (opcional)

El formulario de soporte guarda el ticket en la base de datos real, pero no
manda un email — no voy a inventar que "se envió" un correo que no salió.
Si querés que además dispare un email de verdad, agregá tus credenciales SMTP
reales y conectamos `nodemailer` en `/api/contact`.

## 6. Legal

Escanear puertos, hacer ping sweep o traceroute contra redes o equipos que no
son tuyos, sin autorización explícita, puede constituir un delito según la
legislación de tu país. Usá esta herramienta solo sobre infraestructura propia
o con permiso escrito.

## App para Windows (agente)
`agent/` es una app de escritorio nativa (Electron): ventana propia, sin localhost ni Node para el usuario final.
Compilar (en Windows, Node 18+): `BUILD-EXE.bat` → `IPHub-Agent.exe` portable, copiado a `public/download/`.

## Correo
Configurá SMTP_USER / SMTP_PASS en `.env` (ver `.env.example`, Gmail requiere "contraseña de aplicación"). Se usa para el código de verificación y para enviar los tickets a SUPPORT_TO.

## Login con Google y Discord
En la pantalla de inicio de sesión / registro hay botones **Google** y **Discord**. Si el correo ya existe, entra a esa cuenta; si no, crea una cuenta nueva ya verificada.
Configuración (en `.env`, ver `.env.example`):
- `GOOGLE_CLIENT_ID` y origen autorizado `http://localhost:3001`.
- `DISCORD_CLIENT_ID` y redirect `http://localhost:3001/auth/discord`.

## IP de red en el Dashboard
El Dashboard muestra la IP de red del equipo donde corre IPHub (más su subred y máscara). Endpoint: `GET /api/network/info`.


## Crear el .exe (Windows)

IPHub.exe  (monitor de red + sesión de la misma cuenta de la página)
=================================================
Qué hace: al abrirlo escanea la red local y muestra dispositivos (nombre, IP, MAC, fabricante, tipo,
SO probable, latencia, puertos/servicios, banners, certificados, mDNS/UPnP, riesgo). Podés iniciar
sesión con la misma cuenta de la web para que Topología muestre esa red. Los datos locales se
guardan en la PC del usuario.

Logo: corregido. El CSP del EXE ahora permite img-src 'self' y se usa logo.png como icono de ventana
y de empaquetado. Si no ves el logo, recompilá con BUILD-EXE.bat después de actualizar estos archivos.

Compilar (en Windows):
1) Doble clic en BUILD-EXE.bat
   - Instala electron + packager solo en agent/ (descarga ~100-150 MB la primera vez).
2) Resultado: agent\dist\IPHub-win32-x64\IPHub.exe
   (dentro de esa carpeta hay más archivos; no muevas solo el .exe)
3) Para la web: comprimí la carpeta completa IPHub-win32-x64 como zip y copiala a
   public\download\IPHub-Windows.zip  (el botón de descarga de la página la sirve).

Probar sin compilar:  cd agent && npm install && npm start

Cómo partir el zip en partes (si pesa muchos MB) y juntarlo después
------------------------------------------------------------------
En la PC donde generaste el zip (PowerShell o CMD):

  A) Crear partes de 20 MB (ajustá el tamaño si querés):

     cd agent\dist
     powershell -Command "Compress-Archive -Path 'IPHub-win32-x64\*' -DestinationPath 'IPHub-Windows.zip' -Force"
     split -b 20m IPHub-Windows.zip IPHub-part-

     (Si no tenés split de Git Bash, usá 7-Zip o:
      powershell -Command "$i=0; Get-Content IPHub-Windows.zip -Encoding Byte -ReadCount 20MB | ForEach-Object { [IO.File]::WriteAllBytes(('IPHub-part-{0:D2}.bin' -f $i++), $_) }")

  B) Enviar las partes (IPHub-part-aa, IPHub-part-ab, ... o .bin) por el medio que uses.

  C) En la PC destino, juntar y descomprimir (CMD o PowerShell):

     copy /b IPHub-part-* IPHub-Windows.zip
     (o si usaste .bin:  copy /b IPHub-part-00.bin + IPHub-part-01.bin + ... IPHub-Windows.zip)

     Luego:
     mkdir IPHub
     tar -xf IPHub-Windows.zip -C IPHub
     (o clic derecho → Extraer todo)

     Abrí IPHub\IPHub.exe  (o la carpeta que haya generado packager).

Conexión con la página: en el exe poné la URL del servidor (por defecto la de producción o
http://127.0.0.1:3001), entrá con el mismo correo/contraseña o Continuar con Google/Discord.
Topología muestra esa red. Exportar genera JSON para importar si no hay conexión.

Dueño: iphuboficial@gmail.com / lbaa1986 (también acepta el punto final).


## Configurar la IA

IA del chatbot (obligatorio reiniciar el servidor)
==================================================
1) Edita el archivo .env en netvista-pro

2) Agrega (Groq gratis):

GROQ_API_KEY=gsk_tu_clave_aqui
AI_PROVIDER=groq
AI_MODEL=llama-3.3-70b-versatile

Clave en: https://console.groq.com/keys

3) Ctrl+C al servidor y de nuevo: npm start

4) Debe decir: IA chatbot: ACTIVA (Groq)

Respaldo recomendado (gratis) para que el chat y las traducciones nunca se queden sin IA
---------------------------------------------------------------------------------------
Groq gratis tiene un límite de tokens por minuto (p. ej. 8000 con gpt-oss-120b). Si se alcanza, el servidor
espera y prueba otro modelo; ya NO desactiva Groq por eso. Para tener más margen agregá un segundo proveedor:

  GEMINI_API_KEY=...        (gratis: https://aistudio.google.com/apikey)
  OPENROUTER_API_KEY=...    (gratis: https://openrouter.ai/keys)
  POLLINATIONS_API_KEY=...  (gratis: https://enter.pollinations.ai)

Las líneas no deben empezar con "#". Reiniciá el servidor después de editar .env.

Traducción de la interfaz: usa Google, luego Microsoft y por último la IA. Si un motor falla descansa un rato
y se pasa al siguiente. Necesita salida a internet (translate.googleapis.com / api-edge.cognitive.microsofttranslator.com).


## Subir a GitHub

El `.exe` NO va en el repositorio (es pesado): subilo en **Releases**. `node_modules`, `dist`, `.env` y la base de datos ya están en `.gitignore`.

## v1 · cambios recientes
- ARP: lee `arp -a`, `/proc/net/arp` e `ip neigh` (Render/Linux). Traceroute: usa `traceroute` y, si no existe, un mtr externo.
- Guardado de la DB agrupado (antes bloqueaba el servidor → 502). Caché de idiomas reparada (+ persistida en Upstash).
- Mapa de topología nuevo (`public/topo-pro.js`), capa visual `public/pro.css` + `public/pro.js`.
- Exe: usa la dirección configurable de la página, reintentos si Render está dormido.
