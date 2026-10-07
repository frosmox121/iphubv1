/* Manual por funciones + tips (!) + perfil */
(function () {
  const HELP = {
    'topology-viewer': [
      'Visor de topología (web)',
      'Muestra la red publicada por la app de escritorio.',
      'Fuente de datos: POST /api/agent/snapshot (JSON del exe) o importación de archivo. La web NO escanea tu LAN: solo visualiza. Botón Descargar exe → GET /api/download/exe. Campos del snapshot: devices[], gateway, host, online/offline, score. Actualización típica cada pocos segundos mientras el exe esté logueado.'
    ],
    'device-inventory': [
      'Inventario de dispositivos',
      'Lista hosts detectados por el agente o importados.',
      'Campos: IP, MAC, vendor, hostname, puertos, RTT, online. Origen: agente Electron (agent/core.js) o JSON importado. No mezcla cuentas. En el exe podés confiar, ocultar, eliminar y restaurar dispositivos.'
    ],
    'tool-ip': [
      'Analizador de IP',
      'Geolocalización e ISP de una IP pública.',
      'API: POST /api/tools/ip-lookup  Body: { ip }. Backend → http://ip-api.com/json/{ip} (campos: country, city, isp, org, as, proxy, hosting, mobile, lat/lon). Respuesta enriquecida con VPN heuristic, OSM link, reverse DNS. Requiere JWT. Auditoría: "IP lookup". No escanea LAN privada.'
    ],
    'tool-ports': [
      'Escaneo de puertos TCP',
      'Prueba si puertos TCP están abiertos en un host.',
      'API: POST /api/tools/port-scan  Body: { host, ports } (ej. "80,443" o "1-1024"). Implementación: net.Socket.connect desde el servidor Node (concurrencia ~100). Marca críticos: 21,23,445,3389,5900. Guarda en colección scans. Limitación: el escaneo sale desde el servidor (Render/VPS/LAN del server), no desde tu PC.'
    ],
    'tool-traceroute': [
      'Traceroute / Tracepacket',
      'Muestra saltos (hops) hasta un destino.',
      'APIs: POST /api/tools/traceroute y POST /api/tools/tracepacket  Body: { target }. Motor: 1) binario del SO (traceroute/tracert) si existe; 2) fallback Promise.any(Globalping API, HackerTarget MTR). Tracepacket usa más probes (-q 3). Respuesta: { raw, hops?, tool }. En el EXE también hay traceroute/tracepacket local (ICMP/TCP según SO).'
    ],
    'tool-dns': [
      'Consulta DNS',
      'Resuelve registros de un dominio.',
      'API: POST /api/tools/dns-lookup  Body: { domain, type: A|AAAA|MX|TXT|NS|CNAME|SOA }. Usa dns.Resolver de Node apuntando a 1.1.1.1 y 8.8.8.8, con fallback al resolver del sistema. No usa API de terceros de pago.'
    ],
    'tool-subnet': [
      'Calculadora de subredes',
      'Aritmética CIDR pura en el servidor.',
      'API: POST /api/tools/subnet-calc  Body: { cidr: "192.168.1.0/24" }. Calcula network, mask, broadcast, first/last host, usableHosts, wildcard. Sin red externa.'
    ],
    'tool-arp': [
      'Tabla ARP / MAC',
      'Lee vecinos conocidos del sistema del servidor.',
      'API: GET /api/tools/arp-table. Orden: `arp -a` → /proc/net/arp → `ip neigh`. En hosting cloud suele estar vacía (normal). En LAN local del server muestra IP↔MAC.'
    ],
    'tool-speed': [
      'Speedtest',
      'Mide descarga/subida contra este servidor.',
      'GET /api/tools/speedtest/download?mb=N  POST /api/tools/speedtest/upload  POST /api/tools/speedtest/log. El navegador descarga/sube buffers; el RTT es hacia el origen de IPHub, no “todo Internet”.'
    ],
    'tool-innov': [
      'Herramientas innovadoras',
      'Ping matrix, path probe, TLS, headers, ASN, DNS prop, compare traces.',
      'POST /api/tools/ping-matrix {host,samples} — RTT TCP :80/:443.\nPOST /api/tools/path-probe {host} — connect a 443/80/22/53.\nPOST /api/tools/tls-info {host} — tls.connect + certificado.\nPOST /api/tools/http-headers {url} — fetch headers de seguridad.\nPOST /api/tools/asn-lookup {ip} — ip-api.com AS/org.\nPOST /api/tools/dns-propagation {domain} — A en 1.1.1.1, 8.8.8.8, 9.9.9.9, 208.67.222.222.\nCompare TR vs TP — lanza traceroute y tracepacket en paralelo.'
    ],
    'tool-ping-matrix': [
      'Ping matrix TCP',
      'Latencia TCP multi-muestra sin ICMP.',
      'API: POST /api/tools/ping-matrix. Útil cuando ICMP está bloqueado (cloud). Calcula min/avg/max y pérdida sobre muestras a puertos 80/443.'
    ],
    'tool-path-probe': [
      'Path probe',
      'Sondea puertos clave del path.',
      'API: POST /api/tools/path-probe. Reporta ms por puerto y sugerencia de mejor RTT. Complementa traceroute cuando solo TCP responde.'
    ],
    'tool-tls': [
      'TLS certificate',
      'Inspecciona certificado HTTPS.',
      'API: POST /api/tools/tls-info. tls.connect Node: subject, issuer, validTo, protocol, cipher, daysLeft.'
    ],
    'tool-http': [
      'HTTP headers',
      'Cabeceras de seguridad y servidor.',
      'API: POST /api/tools/http-headers. fetch GET; expone server, HSTS, CSP-related, cf-ray, etc.'
    ],
    'tool-asn': [
      'ASN lookup',
      'Sistema autónomo de una IP.',
      'API: POST /api/tools/asn-lookup → ip-api.com fields as/org/isp/country.'
    ],
    'tool-dnsprop': [
      'DNS propagation',
      'Misma consulta A en varios resolvers.',
      'API: POST /api/tools/dns-propagation. Detecta inconsistencias de propagación DNS.'
    ],
    'workspace': [
      'Workspace',
      'Tablero con widgets y embeds.',
      'API: PUT/GET /api/workspace  Body: { layout: { widgets:[{type,size,url?,text?}] } }. Tipos: dashboard, topology, tools-ip, audit, notes, embed. Persistido en el usuario.'
    ],
    'code-intel': [
      'Código e inteligencia',
      'Repos, commits, funciones, query, grafos, foro.',
      'Solo dueño. APIs /api/code/* y /api/forum/*. requireOwner en servidor.'
    ],
    'code-query': [
      'Code Query',
      'Consultas sobre el índice de código.',
      'POST /api/code/query { entity, filters, sort }. Guardar: POST /api/code/query/save.'
    ],
    'code-graph': [
      'Grafo de código',
      'Nodos y enlaces de dependencias.',
      'GET /api/code/graph/:repoId.'
    ],
    'forum': [
      'Foro de código',
      'Posts ligados a repo/commit/función.',
      'POST /api/forum/posts. Solo dueño.'
    ],
    'ai-settings': [
      'Configuración de IA',
      'Proveedor, modelo y clave propia.',
      'PUT /api/ai/settings. Chat: POST /api/chat con historial. System prompt incluye base de conocimiento IPHub + Tracking Studio + herramientas.'
    ],
    'learn-prompt': [
      'Prompt de Aprender',
      'Personaliza quizzes.',
      'Guardado en perfil. Quiz: banco local o IA.'
    ],
    'auth-login': [
      'Inicio de sesión',
      'Correo/contraseña o OAuth.',
      'POST /api/auth/login → JWT 7 días. Google/Discord vía flujos OAuth. USER_GONE si la DB se reinició.'
    ],
    'auth-register': [
      'Registro',
      'Alta de cuenta + verificación.',
      'POST /api/auth/register. SMTP o AUTO_VERIFY_ON_SMTP_FAIL. Código en logs [VERIFY CODE].'
    ],
    'agent-app': [
      'App de escritorio (exe)',
      'Escaneo local, WoL, traceroute local.',
      'Electron agent/. Login cloud + Google/Discord. Publica /api/agent/snapshot. Traceroute/Tracepacket locales en el panel del exe. Restaurar dispositivos eliminados desde filtro Eliminados.'
    ],
    'lab-ide-app': [
      'IDE de laboratorio (app)',
      'Topología pesada en escritorio.',
      'Solo en la aplicación. Web = visor.'
    ],
    'tracking-studio': [
      'Tracking Studio',
      'IDE logístico IoT + analítica.',
      'APIs bajo /api/tracking/*: proyectos, envíos, telemetría, workers, alertas smart, predictive, bridge Virtual Lab, GIS rutas/geofences, simulación, snapshots, incidentes, reportes, consignments, POD, e-seal, carriers, replay, webhooks, RBAC, topology, AI local.'
    ],
    dashboard: [
      'Dashboard',
      'Resumen de actividad de tu cuenta.',
      'GET /api/dashboard/activity: events24h, ipLookups, portScans, dnsQueries, traces, tickets, rating.'
    ],
    topology: [
      'Topología (sección)',
      'Visor web de la red del agente.',
      'Ver topology-viewer. Datos vía snapshot del exe.'
    ],
    tools: [
      'Herramientas (sección)',
      'Suite de diagnóstico de red.',
      'Tabs: IP, Puertos, Traceroute, DNS, Subredes, ARP, Velocidad, Innovadoras. Cada botón llama su /api/tools/* documentado en este manual por función.'
    ],
    audit: [
      'Auditoría',
      'Historial de acciones.',
      'GET /api/audit. Timestamp, acción, detalle por usuario.'
    ],
    learn: [
      'Aprender',
      'Quizzes de redes + XP.',
      'Banco local o IA. Cooldown entre intentos.'
    ],
    leaderboard: [
      'Ranking',
      'Orden por XP.',
      'GET /api/leaderboard.'
    ],
    support: [
      'Soporte',
      'Tickets y reseñas.',
      'POST tickets → SUPPORT_TO. Límite de frecuencia.'
    ],
    empresa: [
      'Empresa',
      'Roles, miembros, permisos por sección.',
      'Permisos: dashboard, topology, workspace, tracking, tools, audit, learn, ranking, support, manual, account. APIs /api/org/*.'
    ],
    manual: [
      'Manual',
      'Documentación por función.',
      'Este panel. Tips (!) en cada función abren el detalle técnico.'
    ],
    account: [
      'Mi cuenta',
      'Perfil, API key, switch de cuentas.',
      'PUT /api/auth/profile. Roster local iphub_roster para multi-cuenta. Dueño: no elimina cuenta ni cambia mail/pass.'
    ],
  };

  function openHelp(key) {
    const item = HELP[key];
    if (!item) return;
    let modal = document.getElementById('fn-help-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'fn-help-modal';
      modal.innerHTML = '<div class="fn-help-backdrop"></div><div class="fn-help-card"><button type="button" class="fn-help-x" aria-label="Cerrar">✕</button><h3></h3><p class="fn-help-sum"></p><pre class="fn-help-detail"></pre></div>';
      document.body.appendChild(modal);
      modal.querySelector('.fn-help-backdrop').onclick = () => modal.classList.remove('open');
      modal.querySelector('.fn-help-x').onclick = () => modal.classList.remove('open');
    }
    modal.querySelector('h3').textContent = item[0];
    modal.querySelector('.fn-help-sum').textContent = item[1];
    modal.querySelector('.fn-help-detail').textContent = item[2];
    modal.classList.add('open');
  }

  function bindTips() {
    document.querySelectorAll('.fn-tip[data-fn]').forEach(el => {
      if (el.dataset.bound) return;
      el.dataset.bound = '1';
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        openHelp(el.getAttribute('data-fn'));
      });
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHelp(el.getAttribute('data-fn')); }
      });
    });
  }

  function renderManual() {
    const root = document.getElementById('manual-body') || document.querySelector('#manual .manual-body') || document.querySelector('#manual');
    if (!root) return;
    // Prefer dedicated container
    let host = document.getElementById('manual-fn-list');
    if (!host) {
      host = document.createElement('div');
      host.id = 'manual-fn-list';
      const section = document.getElementById('manual');
      if (section) {
        const header = section.querySelector('.section-header');
        if (header && header.nextSibling) section.insertBefore(host, header.nextSibling);
        else section.appendChild(host);
      }
    }
    const entries = Object.keys(HELP).map(k => {
      const [title, sum, detail] = HELP[k];
      return `<details class="manual-card" data-fn="${k}">
        <summary><strong>${title}</strong> <span class="muted small">${sum}</span></summary>
        <pre class="manual-tech">${detail.replace(/</g,'&lt;')}</pre>
      </details>`;
    }).join('');
    host.innerHTML = '<h3 class="manual-fn-title">Manual por funciones</h3><p class="muted">Cada entrada documenta la API y el comportamiento real. Los signos <b>!</b> en la UI abren el mismo detalle.</p>' + entries;
  }

  document.addEventListener('click', e => {
    const tip = e.target.closest && e.target.closest('.fn-tip[data-fn]');
    if (tip) {
      e.preventDefault();
      openHelp(tip.getAttribute('data-fn'));
    }
  });

  const boot = () => { bindTips(); renderManual(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  setTimeout(bindTips, 800);
  setTimeout(bindTips, 2500);

  // Re-bind when navigating
  const orig = window.showSection;
  if (typeof orig === 'function') {
    window.showSection = function (id) {
      orig(id);
      setTimeout(bindTips, 50);
      if (id === 'manual') renderManual();
    };
  }

  window.iphubOpenHelp = openHelp;
  window.iphubHELP = HELP;
})();
