/* Perfil, IA, manual detallado y ayuda (icono gris ? sin emoji) al lado de cada sección. */
(function () {
  // [título corto, resumen para tooltip, texto detallado para el manual]
  const HELP = {
    dashboard: [
      'Panel / Dashboard',
      'Resumen de tu actividad, riesgos y alertas recientes.',
      'El dashboard muestra métricas de tu propia cuenta: eventos de auditoría, consultas de IP/DNS, escaneos, estado de la red publicada por el agente y, si tenés organización, resumen de activos, secretos pendientes y simulaciones. Podés reordenar tarjetas (configuración por usuario). Ningún dato de otra cuenta aparece aquí. Icono ? lleva al detalle en Manual.'
    ],
    topology: [
      'Topología / Laboratorio de red',
      'Entorno virtualizado tipo IDE para mapear IP, hosts, rutas y simulaciones.',
      'La sección Topología funciona como un IDE profesional de red: panel izquierdo (árbol de proyectos/redes/subredes/hosts), lienzo central (mapa arrastrable), panel derecho (propiedades del nodo seleccionado). Podés crear proyectos independientes, redes, subredes (CIDR, gateway), hosts, routers, firewalls, VLANs, reglas simuladas, rutas y NAT. Incluye detección de IP duplicadas, subredes superpuestas y rutas inválidas. Trazas simuladas entre nodos, pruebas de estrés controladas (límites de paquetes, duración, CPU) y escenarios de propagación hipotética (gusano virtual, solo simulación, nunca malware real). Importá/exportá topologías, versioná y compará. Datos reales del agente o 100% simulados. Todo en modo laboratorio con límites y auditoría.'
    ],
    tools: [
      'Herramientas',
      'Diagnóstico real: IP, puertos, traceroute, DNS, subredes, ARP y velocidad.',
      'Las herramientas ejecutan consultas desde el servidor o desde tu equipo (según la función) solo contra el objetivo que indiques. No reutilizan datos de otras cuentas. Resultados se pueden guardar en tu auditoría y asociar a un host del laboratorio. El icono ? explica cada herramienta individual cuando está disponible.'
    ],
    audit: [
      'Auditoría',
      'Historial inmutable de lo que hiciste en la plataforma.',
      'Registra inicio de sesión, uso de herramientas, cambios de perfil, exportaciones, creación de simulaciones y acciones administrativas. Incluye timestamp, IP de acceso y recurso afectado. Exportable según permisos. En empresas, los administradores ven la auditoría de su organización con separación de funciones.'
    ],
    learn: [
      'Aprender',
      'Quizzes de redes con feedback inmediato y XP.',
      'Los enunciados usan el prompt de aprendizaje de tu perfil. Si no hay clave del proveedor de IA elegido, se usa el banco local. Cooldown entre quizzes. Suben XP al ranking.'
    ],
    leaderboard: [
      'Ranking',
      'Ordena cuentas por XP obtenido con herramientas y quizzes.',
      'Solo XP de actividad propia. No hay manipulación entre cuentas.'
    ],
    support: [
      'Soporte',
      'Tickets y reseñas.',
      'El ticket se guarda y se notifica al correo de soporte. Categorías predefinidas. Historial por cuenta.'
    ],
    account: [
      'Mi cuenta',
      'Perfil personal o empresa, proveedor de IA y clave API.',
      'Podés marcar la cuenta como personal o empresa, elegir proveedor de IA (auto/Groq/Gemini/OpenRouter) y definir el prompt de Aprender. La clave API autoriza las mismas funciones que la sesión vía encabezado X-API-Key. MFA y gestión de sesiones cuando esté habilitado.'
    ],
    empresa: [
      'Empresa / Organización',
      'Roles, permisos, inventario, secretos, phishing simulado y colaboración.',
      'Solo el dueño o administradores asignan roles (admin, analista, desarrollador, auditor, solo lectura) y permisos por módulo/proyecto/activo. Inventario de endpoints, servidores, APIs, certificados. Monitor de exposición de secretos y API keys (patrones, commits autorizados, variables de entorno de agentes empresariales): nunca se almacenan secretos completos por defecto; se usa fingerprint. Mapa de destinos a los que las aplicaciones envían datos. Campañas de phishing de concientización autorizadas (dominios de laboratorio, pantalla educativa inmediata, sin captura de credenciales reales). Simulaciones sobre dispositivos empresariales autorizados. Foro empresarial vinculado a commits/funciones. Dual repositorio (GitHub + espejo privado). Todo con auditoría y mínimo privilegio.'
    ],
    lab: [
      'Laboratorio virtualizado (IDE)',
      'Construí y analizá redes virtuales sin tocar infraestructura real.',
      'Modo laboratorio separado de datos reales. Crear/clonar/restaurar snapshots. Límites de recursos (paquetes, duración, concurrencia, ancho de banda). Detener manual o automático. Registrar, reproducir y comparar simulaciones. Compartir laboratorio de solo lectura. Aprobado por administrador en entorno empresarial. Ver también Topología.'
    ],
    secrets: [
      'Secretos y API keys',
      'Monitor de exposición de secretos y claves (no captura de contraseñas).',
      'Detecta posibles secretos en repositorios autorizados, configs, logs y commits. Clasifica criticidad, asocia servicio/aplicación/propietario. Alertas por uso anómalo o desde activo no autorizado. Rotación con evidencia. Integración con secret managers. Redacción automática. Solo personal autorizado ve valores (cuando corresponde).'
    ],
    code: [
      'Código / Commits / Code Query',
      'Navegación de repositorios, funciones, grafos y consultas tipo SQL sobre el código.',
      'Conectá GitHub, GitLab, Bitbucket o repositorio privado/espejo. Listá commits, buscá por función/clase/archivo. Abrí cualquier función: firmas, llamadas entrantes/salientes, dependencias, acceso a BD/API/secretos, complejidad. Code Query Explorer: filtrá funciones, clases, dependencias, vulnerabilidades. Grafos de llamadas y dependencias. Modo compartir (vista solo lectura, expiración, sanitización de secretos). Exportar investigación como commit de documentación o PR. Foro empresarial asociado a commits/funciones.'
    ],
    phishing: [
      'Phishing de concientización',
      'Campañas autorizadas de entrenamiento (nunca captura de credenciales reales).',
      'Seleccioná empleados autorizados, plantillas, ventana temporal. Dominios controlados por la empresa. Tras el clic se muestra pantalla educativa. Métricas de interacción y reporte. Informes por departamento. Exclusión de empleados sensibles según política. Aprobación previa y auditoría completa.'
    ],
    simulations: [
      'Simulaciones de seguridad',
      'Propagación hipotética, estrés controlado y pruebas de segmentación.',
      'Todo en modo laboratorio. Representación de “gusano” como evento virtual (no malware ejecutable). Árbol de propagación, barreras de segmentación, puntuación de exposición. Pruebas de estrés con límites duros. Simulación de caída de nodo/enlace. Comparar escenarios. Generar recomendaciones defensivas. Nunca se ejecuta acción real fuera del alcance autorizado.'
    ],
    manual: [
      'Manual',
      'Documentación detallada de cada función.',
      'Cada sección y herramienta tiene un icono gris de interrogación (?) que abre el resumen y enlaza a este manual. El texto aquí es la versión completa. Usá el índice o los anclas #manual-xxx.'
    ]
  };
  const $ = id => document.getElementById(id);

  function mark() {
    document.querySelectorAll('.section-header h2').forEach(h => {
      if (h.querySelector('.help-q') || h.querySelector('.qmark')) return;
      const sec = h.closest('.section');
      const key = sec && sec.id;
      const item = HELP[key]; if (!item) return;
      const a = document.createElement('a');
      a.className = 'help-q';
      a.href = '#manual-' + key;
      a.title = item[1];
      a.setAttribute('aria-label', 'Ayuda: ' + item[0]);
      a.onclick = (e) => { e.preventDefault(); openHelp(key); };
      h.appendChild(a);
    });
  }

  function openHelp(key) {
    const item = HELP[key] || ['Ayuda', '', 'Sin detalle adicional.'];
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
    const toc = Object.entries(HELP).map(([k, v]) =>
      `<li><a href="#manual-${k}">${v[0]}</a></li>`
    ).join('');
    box.innerHTML = `
      <div class="card glass" style="margin-bottom:1rem">
        <h3>Índice del manual</h3>
        <p class="muted small">Cada función de la plataforma tiene un icono gris de interrogación (?) junto al título. Al hacer clic se abre el resumen y se salta a la explicación detallada aquí.</p>
        <ul style="columns:2;gap:1rem;margin:.6rem 0 0;padding-left:1.2rem">${toc}</ul>
      </div>
      ${Object.entries(HELP).map(([k, v]) =>
        `<article id="manual-${k}" class="card glass" style="margin-bottom:.8rem">
          <h3>${v[0]}</h3>
          <p><strong>Resumen:</strong> ${v[1]}</p>
          <p>${v[2]}</p>
        </article>`
      ).join('')}`;
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
