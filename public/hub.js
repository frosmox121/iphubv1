/* Manual por funciones + tips (! hover) + perfil */
(function () {
  // Manual por FUNCIÓN: [título, resumen hover, detalle completo]
  const HELP = {
    'topology-viewer': ['Visor de topología (web)', 'Muestra la red publicada por la app. No ejecuta laboratorio pesado.', 'La web solo visualiza. Fuente: snapshot del agente (POST /api/agent/snapshot) o JSON importado. Sin app no hay mapa en vivo. Botón Descargar → /api/download/exe. El IDE (edición, estrés, propagación) está en la aplicación de escritorio, no aquí.'],
    'device-inventory': ['Inventario de dispositivos', 'Lista hosts detectados por el agente o importados.', 'Campos: IP, MAC, fabricante, tipo, SO, puertos, riesgo. Origen: agente local o importación. No mezcla cuentas.'],
    'tool-ip': ['Analizador de IP', 'Consulta geolocalización e ISP de una IP pública.', 'API: POST /api/tools/ip-lookup. Backend consulta ip-api.com. Requiere sesión. Suma XP con cooldown. No escanea tu LAN.'],
    'tool-ports': ['Escaneo de puertos', 'Prueba si puertos TCP están abiertos en un host.', 'API: POST /api/tools/port-scan. Usa net.Socket desde el servidor. Solo contra el host que indiques. Marca puertos críticos (21,23,445,3389,5900).'],
    'tool-traceroute': ['Traceroute', 'Muestra saltos hasta un destino.', 'API: POST /api/tools/traceroute. Ejecuta traceroute/tracert del SO del servidor. Resultado orientativo según red del hosting.'],
    'tool-dns': ['Consulta DNS', 'Resuelve registros DNS de un dominio.', 'API de herramientas DNS. Módulo dns de Node. Tipos comunes A/AAAA/MX/TXT/NS.'],
    'tool-speed': ['Speedtest', 'Mide descarga/subida contra este servidor.', 'Endpoints /api/tools/speedtest/*. Mide el enlace hasta el servidor IPHub, no “todo Internet”.'],
    'workspace': ['Workspace', 'Tablero personal con widgets y embeds.', 'API: PUT /api/workspace. Guardás layout en tu usuario. Widgets: dashboard, topología, IP, auditoría, notas, iframe externo.'],
    'code-intel': ['Código e inteligencia', 'Repos, commits, funciones, query, grafos, foro.', 'Solo dueño (iphuboficial@gmail.com). APIs /api/code/* y /api/forum/*. Incluye demo seed + conexión de repos. Code Query filtra funciones/commits/archivos. Shared views con expiración.'],
    'code-query': ['Code Query Explorer', 'Consultas tipo SQL sobre el modelo de código.', 'POST /api/code/query con entity, filters, sort. Guardar: POST /api/code/query/save. Solo lectura sobre el índice de código del dueño.'],
    'code-graph': ['Grafo de código', 'Nodos y enlaces de llamadas/dependencias.', 'GET /api/code/graph/:repoId. Resalta críticos y externos.'],
    'forum': ['Foro de código', 'Publicaciones ligadas a repo/commit/función.', 'POST /api/forum/posts. Categorías seguridad, backend, APIs, incidentes, etc. Solo dueño en esta fase.'],
    'ai-settings': ['Configuración de IA', 'Elegí proveedor, modelo y clave propia.', 'PUT /api/ai/settings. Campos: aiProvider, aiModel, aiBaseUrl, aiApiKey, learnPrompt. En empresa el admin define el prompt de Aprender para el equipo.'],
    'learn-prompt': ['Prompt de Aprender', 'Personaliza cómo se generan los quizzes.', 'Se guarda en el perfil. Perfil personal: cualquier usuario. Empresa: administrador. Si no hay clave IA, banco local.'],
    'auth-login': ['Inicio de sesión', 'Correo/contraseña o Google/Discord.', 'POST /api/auth/login. JWT 7 días. Si la DB de Render se reinicia, hay que volver a entrar (USER_GONE).'],
    'auth-register': ['Registro', 'Crea cuenta y verifica correo.', 'POST /api/auth/register. Si SMTP falla y AUTO_VERIFY_ON_SMTP_FAIL=1, entra sin código. Código también en Logs [VERIFY CODE].'],
    'agent-app': ['Aplicación de escritorio', 'Escaneo local y laboratorio pesado.', 'Electron en agent/. Login con la misma cuenta. Publica snapshot a /api/agent/snapshot. Exporta JSON para la web.'],
    'lab-ide-app': ['IDE de laboratorio (app)', 'Edición de topología, trazas, estrés, propagación.', 'Solo en la aplicación. Web = visor. Límites de recursos obligatorios. Propagación = evento virtual, no malware.'],
    dashboard: ['Dashboard', 'Resumen de actividad de tu cuenta.', 'Métricas propias: auditoría, herramientas, red del agente. Sin datos de otras cuentas.'],
    topology: ['Topología (sección)', 'Visor web de la red del agente.', 'Ver función topology-viewer. Descargar app para el laboratorio completo.'],
    tools: ['Herramientas (sección)', 'IP, puertos, traceroute, DNS, velocidad.', 'Cada herramienta tiene su entrada en este manual (tool-ip, tool-ports, …).'],
    audit: ['Auditoría', 'Historial de acciones de tu usuario.', 'Timestamp, acción, detalle. En empresa, vista organizativa según rol.'],
    learn: ['Aprender', 'Quizzes de redes con XP.', 'Prompt configurable. Cooldown. Usa IA de tu perfil o banco local.'],
    leaderboard: ['Ranking', 'Orden por XP.', 'XP de herramientas y quizzes propios.'],
    support: ['Soporte', 'Tickets y reseñas.', 'Llegan a SUPPORT_TO. Límite de tickets frecuentes.'],
    account: ['Mi cuenta', 'Perfil, API key, IA.', 'Incluye regenerar API key y settings de IA.'],
    empresa: ['Empresa', 'Roles y permisos.', 'Visible según dueño/rol. No expone datos cross-org.'],
    workspace: ['Workspace', 'Tablero configurable.', 'Ver función workspace.'],
    code: ['Código', 'Módulo dueño.', 'Ver code-intel.'],
    manual: ['Manual', 'Documentación por función.', 'Índice, buscador y anclas #manual-id. Tip ! en la UI resume al pasar el mouse.']
  };
  // ===== Manual v1 ampliado: cada sección explica qué es, cómo se usa paso a paso, qué datos usa, límites y consejos =====
  Object.assign(HELP, {
    dashboard: ['Dashboard', 'Resumen de actividad de tu cuenta.', 'QUÉ ES: la pantalla de inicio. Reúne en un vistazo lo que hiciste y el estado de tu red.\nQUÉ MUESTRA: saludo con tu nombre, tu nivel y XP, cantidad de acciones recientes, herramientas usadas y, si conectaste la app de escritorio, el resumen de tu red (dispositivos, en línea, riesgos).\nCÓMO SE USA: entrá a Inicio; las tarjetas son accesos directos a cada sección. Tocá una métrica para ir a la herramienta que la generó.\nPRIVACIDAD: solo ves datos de tu propia cuenta; nunca de otras cuentas ni de otras empresas.\nCONSEJO: si el panel aparece vacío, usá una herramienta (por ejemplo IP) o conectá la app de escritorio para que haya datos.'],
    topology: ['Topología (sección)', 'Visor de la red publicada por la app, en 5 vistas.', 'QUÉ ES: la vista visual de tu red. La web visualiza; el escaneo real lo hace la app de escritorio, porque un navegador no puede ver tu red local.\nVISTAS: (1) Mapa de red: dispositivos conectados al gateway con animaciones. (2) Global Carrier Explorer: traza una IP pública sobre un globo 3D. (3) IPv6 Radial Hierarchy: jerarquía radial por prefijos. (4) Globo de hosts: todos tus hosts ubicados alrededor de tu sitio; al acercar con la rueda se separan uno por uno. (5) Radial de hosts: anillos concéntricos con TODOS los dispositivos, agrupados por tipo, con zoom y arrastre.\nCÓMO SE USA: elegí la vista arriba; clic en un host para ver IP, MAC, fabricante, tipo, estado, riesgo y puertos; botón "Actualizar desde mi app" para traer lo último que publicó el exe.\nCOLORES: verde = confiable, celeste = riesgo bajo, ámbar = medio, rojo = alto, gris = sin conexión.\nLÍMITE: sin app conectada la web no tiene hosts que mostrar; en ese caso se ve vacía a propósito.'],
    tools: ['Herramientas (sección)', 'IP, puertos, traceroute, DNS, subredes, velocidad e innovadoras.', 'QUÉ ES: la caja de herramientas de diagnóstico de red. Cada una tiene su propia URL (/herramientas/ip, /herramientas/puertos, …) y su entrada en este manual.\nCÓMO SE USA: abrí la herramienta, completá el campo (IP, dominio o host), ejecutá y leé el resultado. Los resultados se guardan en Auditoría.\nXP: cada uso exitoso suma experiencia con un tiempo de espera para evitar abusos.\nÉTICA Y LEGAL: usá las herramientas solo sobre equipos y redes propios o con autorización expresa; escanear redes ajenas puede ser ilegal.'],
    audit: ['Auditoría', 'Historial de acciones de tu usuario.', 'QUÉ ES: el registro de lo que hiciste en IPHub, con fecha y hora, acción y detalle (por ejemplo: "Escaneo de puertos · 192.168.1.1", "Correo cambiado", "Inicio de sesión").\nCÓMO SE USA: filtrá por texto, revisá el detalle y exportá a CSV o PDF para guardarlo o compartirlo.\nEMPRESA: si tu organización lo habilita, un administrador ve una vista organizativa según su rol.\nSEGURIDAD: si ves una acción que no hiciste, cambiá tu contraseña de inmediato y avisá a soporte.'],
    learn: ['Aprender', 'Quizzes de redes con XP, 3 dificultades.', 'QUÉ ES: preguntas de redes generadas por IA (o desde un banco local si no hay clave de IA).\nCÓMO SE USA: elegí dificultad, respondé y mirá la explicación de cada respuesta. Un resultado bueno suma XP.\nPERSONALIZACIÓN: en Mi cuenta podés escribir tu propio "Prompt de Aprender" para pedir temas puntuales (por ejemplo, solo subnetting).\nLÍMITES: hay un tiempo de espera de 10 minutos entre quizzes que suman XP.'],
    leaderboard: ['Ranking', 'Top de usuarios por nivel y XP total.', 'QUÉ ES: la tabla de posiciones de la comunidad. Se ordena por XP total acumulado (niveles superados + XP actual).\nQUÉ VES: el top 20, tu posición, y cuántos XP te faltan para superar al de arriba.\nREGLAS: la cuenta oficial del dueño no participa del ranking, porque solo administra la plataforma. El ranking se reinició para la versión 1.\nCÓMO SUBIR: usá herramientas (cada una suma XP con espera) y completá quizzes de Aprender.'],
    support: ['Soporte', 'Tickets, reseñas y contacto.', 'QUÉ ES: el canal para reportar problemas, pedir ayuda o dejar una reseña.\nCÓMO SE USA: elegí la categoría, describí el problema con pasos para reproducirlo, adjuntá una captura si ayuda y enviá. Recibís la respuesta por correo.\nPRIORIDAD: marcá urgente solo si algo crítico no funciona; hay un límite de tickets seguidos para evitar spam.\nCONSEJO: incluí tu navegador, la hora aproximada y el mensaje de error exacto.'],
    account: ['Mi cuenta', 'Perfil, correo, contraseña, clave API, IA e idioma.', 'DATOS PERSONALES: nombre, empresa y foto de perfil (se aplican al guardar).\nCAMBIAR CORREO (doble verificación): 1) escribís el nuevo correo y tu contraseña; 2) te mandamos un código al correo ACTUAL para autorizar; 3) te mandamos otro código al correo NUEVO para comprobar que es tuyo; 4) al validar el segundo, el cambio queda hecho y tu sesión sigue abierta. Cada código dura 15 minutos y tiene 5 intentos.\nCONTRASEÑA: pedimos la actual y la nueva dos veces.\nCLAVE API: sirve para llamar a la API desde scripts con el encabezado x-api-key; "Regenerar" invalida la anterior.\nIA: elegí proveedor, modelo y tu propia clave si querés.\nELIMINAR CUENTA: acción permanente con código por correo.\nCUENTAS MÚLTIPLES: usá el botón + del selector de cuentas (abajo a la izquierda).'],
    empresa: ['Empresa', 'Roles, permisos y miembros.', 'QUÉ ES: administración de equipos. El dueño crea roles y elige a qué secciones accede cada uno (Dashboard, Topología, Workspace, Tracking, Herramientas, Auditoría, Aprender, Ranking, Soporte, Manual).\nCÓMO SE USA: creá un rol, marcá permisos, invitá miembros y asignales el rol. Los cambios aplican de inmediato.\nPRIVACIDAD: ninguna cuenta ve datos de otra organización.'],
    workspace: ['Workspace', 'Tablero personal configurable con widgets.', 'QUÉ ES: un tablero propio donde armás tu centro de control.\nWIDGETS: resumen de red, últimas acciones, notas, herramientas rápidas y embeds externos (iframe).\nCÓMO SE USA: activá el modo edición, arrastrá y redimensioná los bloques, agregá o quitá widgets y guardá (también se guarda solo). Podés mantener varios arreglos.\nCONSEJO: dejá arriba lo que consultás todos los días; los cambios se guardan por usuario.'],
    manual: ['Manual', 'Documentación completa por función.', 'QUÉ ES: esta guía. Cada función tiene resumen, uso paso a paso, datos que usa y límites.\nCÓMO SE USA: buscá con el cuadro de arriba o tocá el "!" que aparece junto a cada título de la página para saltar directo a su explicación.\nANCLAS: cada artículo tiene un enlace #manual-nombre que podés compartir.'],
    'packet-analyzer': ['Analizador de paquetes (app)', 'Captura y decodifica todos los protocolos de tu placa de red.', 'QUÉ ES: un analizador de protocolos estilo Wireshark dentro de la app de escritorio. Captura paquetes reales de la interfaz de red elegida.\nREQUISITOS: Windows: instalar Wireshark (incluye Npcap) y abrir IPHub como administrador. Linux/macOS: tcpdump o tshark y permisos de red.\nPROTOCOLOS: con tshark se disecciona todo lo que Wireshark conoce (miles de protocolos). Además IPHub decodifica por su cuenta: Ethernet, VLAN 802.1Q, ARP, IPv4, IPv6, TCP, UDP, ICMP/ICMPv6 (incluye Neighbor/Router Discovery), IGMP, GRE, ESP/AH, SCTP, OSPF, EIGRP, VRRP, STP, LLDP, EAPOL, MPLS, PPPoE, DNS/mDNS/LLMNR, DHCP, HTTP, TLS (con nombre SNI), QUIC, SSH, FTP, SMTP, IMAP/POP3, SMB, RDP, SNMP, NTP, SIP, MQTT, RADIUS, LDAP, Kerberos, SSDP, WireGuard, OpenVPN y más de 60 puertos conocidos.\nCÓMO SE USA: elegí la interfaz, opcionalmente un filtro de captura (por ejemplo "port 53" o "host 192.168.1.5"), iniciá, y tocá un paquete para ver sus capas y el volcado hexadecimal. Podés pausar y limpiar.\nSOLO EL DUEÑO: por seguridad, capturar e interceptar está limitado a la cuenta oficial.\nLEGAL: capturá únicamente tráfico de redes propias o autorizadas.'],
    'viz-globe': ['Globo de hosts', 'Todos tus hosts sobre un globo 3D.', 'QUÉ ES: un globo que ubica tu red en el mapa y reparte cada host en espiral alrededor de tu sitio para que ninguno quede tapado.\nCÓMO SE USA: arrastrá para girar, rueda o botones +/− para acercar; al acercar los puntos se separan y aparecen los nombres. Clic en un punto para ver sus datos y centrarlo. Los destinos remotos aparecen como arcos violetas.\nNOTA: los equipos de una LAN no tienen ubicación geográfica propia; se ubican en el sitio de tu IP pública. En la web la vista es más liviana; en la app es la completa.'],
    'viz-radial': ['Radial de hosts', 'Anillos concéntricos con todos los dispositivos.', 'QUÉ ES: el gateway en el centro y todos los dispositivos en anillos, ordenados por tipo para encontrarlos fácil.\nCÓMO SE USA: rueda para zoom (hacia el cursor), arrastrá para mover, ⤢ para encuadrar todo. Pasá el mouse para resaltar el enlace y clic para ver el detalle en el panel lateral, junto con la leyenda y los totales por tipo.'],
    'mod-sandbox': ['Entorno virtual de red', 'Mapa IP editable con trazas y estrés simulados.', 'DISPONIBLE: cuenta oficial (Plan y Estudio).\nQUÉ ES: una red de práctica que armás vos: nodos (router, switch, servidor, PC…), IP, latencia y enlaces.\nTRAZA: calcula el camino más corto entre dos nodos y muestra salto, IP y RTT acumulado.\nESTRÉS CONTROLADO: modelo simulado de saturación por paquetes por segundo (tope 100 000) que indica carga, pérdida y estado de cada nodo.\nSEGURIDAD: todo es simulación en el servidor; no se envía tráfico real a ninguna red.'],
    'mod-apitrack': ['Seguimiento de claves API', 'Qué servicios usa cada clave.', 'DISPONIBLE: cuenta oficial.\nQUÉ MUESTRA: por persona, cantidad de llamadas hechas con su clave API, servicios del sistema que consultó, IPs de origen y última actividad; más la lista de claves emitidas (solo los últimos 4 caracteres) y la actividad reciente.\nALCANCE: registra desde que el módulo está activo, hasta 3000 eventos.'],
    'mod-phish': ['Simulacro de phishing', 'Campañas internas con consentimiento.', 'DISPONIBLE: cuenta oficial.\nCÓMO SE USA: nombrá la campaña, escribí asunto y mensaje, pegá los correos de los participantes y confirmá que aceptaron participar. Cada persona recibe un enlace único.\nMÉTRICAS: enviados, aperturas y clics. El enlace lleva a una página educativa que explica cómo detectar el engaño.\nPRIVACIDAD: nunca se pide ni se guarda una contraseña. Todos los correos indican que es un simulacro.'],
    'mod-commits': ['Commits y foro empresarial', 'Vistas compartibles con commit a GitHub.', 'DISPONIBLE: cuenta oficial.\nCOMMIT: escribí usuario/repositorio, ruta del archivo, rama y un token de GitHub con permiso Contents: write. IPHub crea o actualiza el archivo. El token se usa una vez y no se guarda; sirve para repos privados.\nENLACE COMPARTIBLE: genera /vista/código con el contenido en solo lectura.\nFORO: hilos y respuestas para el equipo.'],
    'desktop-login': ['Iniciar sesión en la app', 'Credenciales, Google o Discord, igual que en la web.', 'CÓMO SE USA: en la tarjeta "Cuenta de la página" tocá Entrar (o Google / Discord). Se abre una ventana con la página real de IPHub; iniciá sesión como siempre y la ventana se cierra sola al terminar. Si escribís correo y contraseña en la app se prueba directo y, si falla, se abre la ventana.\nPOR QUÉ ASÍ: funciona con captcha, verificación en dos pasos y proveedores externos sin guardar tu contraseña en la app.'],
    'languages': ['Idiomas', 'Toda la página y la app se traducen.', 'La página se traduce a más de 60 idiomas con el selector de idioma; la app incluye español, inglés, portugués, francés, alemán e italiano. La elección se recuerda en tu cuenta.']
  });
  const $ = id => document.getElementById(id);

  function mark() {
    document.querySelectorAll('.section-header h2').forEach(h => {
      if (h.querySelector('.help-q') || h.querySelector('.fn-tip') || h.querySelector('.qmark')) return;
      const sec = h.closest('.section');
      const key = sec && sec.id;
      const item = HELP[key]; if (!item) return;
      const a = document.createElement('a');
      a.className = 'fn-tip';
      a.href = '#manual-' + key;
      a.textContent = '!';
      a.title = item[1];
      a.setAttribute('aria-label', 'Ayuda: ' + item[0]);
      a.onclick = (e) => { e.preventDefault(); openHelp(key); };
      h.appendChild(a);
    });
    // Tips ya en HTML con data-fn
    document.querySelectorAll('.fn-tip[data-fn]').forEach(el => {
      const item = HELP[el.getAttribute('data-fn')];
      if (item) el.title = item[1];
      el.onclick = (e) => {
        e.preventDefault();
        openHelp(el.getAttribute('data-fn'));
      };
    });
  }

  function openHelp(key) {
    location.hash = 'manual-' + key;
    const box = $('manual-body');
    if (box) {
      box.dataset.ready = '';
      manual();
      const art = document.getElementById('manual-' + key);
      if (art) art.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (typeof showSection === 'function') showSection('manual');
  }

  function manual() {
    const box = $('manual-body'); if (!box) return;
    if (box.dataset.ready === '1') return;
    box.dataset.ready = '1';
    const entries = Object.entries(HELP);
    const toc = entries.map(([k, v]) => `<li><a href="#manual-${k}">${v[0]}</a></li>`).join('');
    box.innerHTML = `
      <div class="card glass" style="margin-bottom:1rem">
        <h3>Manual por funciones</h3>
        <p class="muted small">El símbolo <strong>!</strong> junto a cada función muestra un resumen al pasar el mouse. Clic abre el detalle aquí. Incluye uso, APIs y límites en lenguaje claro.</p>
        <input class="manual-search" id="manual-q" type="search" placeholder="Buscar función, API, herramienta…">
        <ul id="manual-toc" style="columns:2;gap:1rem;margin:.6rem 0 0;padding-left:1.2rem">${toc}</ul>
      </div>
      <div id="manual-articles">
      ${entries.map(([k, v]) =>
        `<article id="manual-${k}" class="card glass manual-art" data-text="${(v[0] + ' ' + v[1] + ' ' + v[2]).replace(/"/g, '')}" style="margin-bottom:.8rem">
          <h3>${v[0]}</h3>
          <p><strong>Resumen:</strong> ${v[1]}</p>
          <p>${String(v[2]).replace(/\n/g, '<br><br>')}</p>
        </article>`
      ).join('')}
      </div>`;
    const q = $('manual-q');
    if (q) q.oninput = () => {
      const s = q.value.toLowerCase().trim();
      box.querySelectorAll('.manual-art').forEach(art => {
        art.style.display = !s || (art.getAttribute('data-text') || '').toLowerCase().includes(s) ? '' : 'none';
      });
    };
  }

  async function profileCard() {
    const host = $('profile-box'); if (!host || !window.ME) return;
    let d = {};
    try { d = await api('/api/profile'); } catch (_) { return; }
    host.innerHTML = `<h3>Perfil <a class="help-q" href="#manual-account" id="q-profile" title="Ayuda de perfil" aria-label="Ayuda de perfil"></a></h3>
      <p class="muted small">Si no elegís nada, la cuenta queda personal.</p>
      <div class="tool-form">
        <select id="pf-type"><option value="0">Personal</option><option value="1">Empresa</option></select>
        <select id="pf-ai"><option value="auto">IA automática</option><option value="groq">Groq</option><option value="gemini">Gemini</option><option value="openrouter">OpenRouter</option></select>
        <button class="btn btn-primary" id="pf-save" type="button">Guardar perfil</button>
      </div>
      <label>Prompt de Aprender</label>
      <textarea id="pf-prompt" rows="3">${d.learnPrompt || ''}</textarea>
      <p class="muted small">La clave API de esta cuenta sirve para todas las funciones: encabezado <code>X-API-Key</code>.</p>`;
    $('pf-type').value = d.profile && d.profile.isBusiness ? '1' : '0';
    $('pf-ai').value = d.aiProvider || 'auto';
    $('pf-save').onclick = async () => {
      await api('/api/profile', { method: 'PUT', body: { isBusiness: $('pf-type').value === '1', aiProvider: $('pf-ai').value, learnPrompt: $('pf-prompt').value } });
      if (typeof toast === 'function') toast('Perfil guardado');
    };
    const q = $('q-profile'); if (q) q.onclick = (e) => { e.preventDefault(); openHelp('account'); };
  }

  async function traces() {
    const box = $('trace-box'); if (!box) return;
    try {
      const d = await api('/api/agent/snapshot');
      const rows = (d.snapshot && d.snapshot.traces) || [];
      const routes = (d.snapshot && d.snapshot.routes) || [];
      box.innerHTML = `<h3>Trazas de esta cuenta</h3>
        <p class="muted small">${rows.length ? '' : 'Todavía no hay trazas del exe.'}</p>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Cuando</th><th>Protocolo</th><th>IP</th><th>Info</th></tr></thead><tbody>
        ${rows.map(t => `<tr><td>${t.at || ''}</td><td>${t.proto || ''}</td><td>${t.ip || ''}</td><td>${t.info || ''} ${t.ttl ? 'TTL ' + t.ttl : ''}</td></tr>`).join('') || '<tr><td colspan="4">Sin trazas</td></tr>'}
        </tbody></table></div>
        <h3>Tabla de ruteo inferida</h3>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Destino</th><th>Vía</th><th>Protocolo</th></tr></thead><tbody>
        ${routes.map(r => `<tr><td>${r.dest}</td><td>${r.via}</td><td>${r.proto}</td></tr>`).join('') || '<tr><td colspan="3">Sin datos</td></tr>'}
        </tbody></table></div>`;
    } catch (_) {}
  }

  const orig = window.showSection;
  if (orig) window.showSection = function (id) { orig(id); if (id === 'account') profileCard(); if (id === 'manual') manual(); if (id === 'topology') traces(); };
  setInterval(() => { if (window.ME) { mark(); manual(); } }, 1000);
})();
