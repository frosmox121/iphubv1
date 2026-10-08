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
          <p>${v[2]}</p>
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
