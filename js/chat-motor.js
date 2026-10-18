/*
 * chat-motor.js: "cerebro" del asistente del sitio. Sin DOM y sin red: recibe el texto de la clienta y el
 * catálogo (el mismo que muestra la página, incluido lo que Tania edita en /admin/) y devuelve la respuesta.
 * Nunca inventa datos: todo sale del catálogo. Si algo no está, deriva a Tania por WhatsApp.
 *
 * responder(texto, catalogo, estado) → { texto, chips, servicio, entendido }
 *   texto: con **negritas** y saltos de línea (la interfaz lo escapa y formatea).
 *   chips: [{ etiqueta, tipo: 'preguntar'|'reservar'|'whatsapp'|'enlace', valor }]
 *   estado: objeto que el motor actualiza entre mensajes ({ ultimoServicio, fallos }).
 */

// ------------------------------------------------------------------ texto
export const normalizar = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/ñ/g, 'n').replace(/[^a-z0-9]+/g, ' ').trim();

const VACIAS = new Set(('de la el los las lo y o u a al del en con para por que q me mi mis te tu un una unos unas es son se ' +
  'hay hola quiero quisiera queria quisieramos necesito saber info informacion consulta consultar sobre cual cuales como ' +
  'esta estan este ese eso ya si no tambien mas muy bien pero porfa porfavor favor gracias buenas buen dia tardes noches ' +
  'tienen tenes tiene hacen haces hace podes puedo pueden ustedes vos usted le les nos su sus ahi aca seria tipo').split(' '));

function distancia(a, b) { // Damerau-Levenshtein (OSA)
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}
const tolerancia = (n) => (n <= 4 ? 0 : n <= 7 ? 1 : 2);

/** ¿La palabra coincide con la clave? Clave con * al final = prefijo. Tolera errores de tipeo. */
function coincide(palabra, clave) {
  if (clave.endsWith('*')) {
    const raiz = clave.slice(0, -1);
    if (palabra.startsWith(raiz)) return true;
    return palabra.length >= raiz.length && raiz.length >= 4 && distancia(palabra.slice(0, raiz.length), raiz) <= 1;
  }
  if (palabra === clave) return true;
  if (palabra[0] !== clave[0]) return false;
  const tol = tolerancia(Math.min(palabra.length, clave.length));
  return tol > 0 && distancia(palabra, clave) <= tol;
}

function tieneAlguna(consulta, claves) {
  for (const c of claves) {
    if (c.includes(' ')) { if ((' ' + consulta.norm + ' ').includes(' ' + c + ' ')) return true; }
    else if (consulta.palabras.some((p) => coincide(p, c))) return true;
  }
  return false;
}

// ------------------------------------------------------------------ intenciones
const INTENCIONES = {
  humano: ['hablar con tania', 'hablar con alguien', 'hablar con una persona', 'persona real', 'humano', 'asesora', 'asesor', 'atencion humana', 'con tania'],
  reservar: ['reserv*', 'agend*', 'turno', 'turnos', 'cita', 'citas', 'sacar turno', 'disponibilidad', 'disponible', 'cupo', 'cupos', 'inscrib*', 'anotar*', 'anotarme', 'agendar'],
  precio: ['precio*', 'cuanto', 'cuesta', 'cuestan', 'costo', 'costos', 'sale', 'salen', 'valor', 'valores', 'tarifa*', 'cobran', 'cobras', 'presupuesto', 'vale', 'promo*'],
  sena: ['sena', 'senas', 'adelanto', 'anticipo', 'deposito', 'reembols*', 'devuelven', 'devolucion'],
  pago: ['pago', 'pagos', 'pagar', 'pago*', 'transferencia*', 'transferir', 'qr', 'tarjeta*', 'efectivo', 'debito', 'credito', 'abonar', 'abono', 'cuotas', 'billetera', 'giro'],
  domingo: ['domingo', 'domingos', 'feriado*', 'fuera de horario', 'fuera del horario', 'de noche', 'a la noche', 'madrugada', 'muy temprano', 'fin de semana', 'otro horario', 'horario especial'],
  horario: ['horario*', 'hora', 'horas', 'abren', 'abre', 'abierto', 'abiertos', 'cierran', 'cierra', 'atienden', 'atencion', 'sabado', 'sabados', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'que dias'],
  ubicacion: ['donde', 'direccion', 'ubicacion', 'ubicad*', 'quedan', 'queda', 'llegar', 'llego', 'mapa', 'local', 'barrio', 'maps', 'como llego', 'studio queda'],
  cursos: ['curso', 'cursos', 'academia', 'clase', 'clases', 'aprender', 'taller', 'talleres', 'masterclass', 'formacion', 'capacitacion', 'alumna*', 'estudiar', 'ensenan', 'matricula*', 'inscripcion'],
  matricula: ['matricula*', 'inscripcion'],
  duracion: ['dura', 'duracion', 'demora', 'tarda', 'cuanto tiempo', 'tiempo'],
  domicilio: ['domicilio', 'a mi casa', 'en mi casa', 'a casa', 'vienen', 'venis', 'traslado', 'viatico', 'movil'],
  puntualidad: ['tolerancia', 'retraso', 'atraso', 'puntual*', 'llego tarde', 'llegar tarde', 'llegue tarde', 'me atraso'],
  cancelar: ['cancel*', 'reprogram*', 'cambiar la fecha', 'cambiar fecha', 'cambiar el turno', 'cambiar mi turno', 'no puedo ir', 'posterg*'],
  contacto: ['whatsapp', 'wpp', 'wsp', 'telefono', 'numero', 'celular', 'contacto', 'llamar', 'instagram', 'insta', 'facebook', 'tiktok', 'redes'],
  servicios: ['servicio', 'servicios', 'que hacen', 'que ofrecen', 'ofrecen', 'catalogo', 'lista', 'opciones', 'menu', 'que hay'],
  incluye: ['incluye', 'incluyen', 'que trae', 'requisito*', 'prepar*', 'llevar', 'rostro limpio', 'antes de ir', 'detalle', 'detalles'],
  saludo: ['hola', 'holi', 'holis', 'buenas', 'buen dia', 'buenos dias', 'buenas tardes', 'buenas noches', 'que tal', 'mba e'],
  gracias: ['gracias', 'genial', 'perfecto', 'listo', 'chau', 'adios', 'joya', 'barbaro', 'ok', 'okey', 'dale'],
};
const CATEGORIA_CLAVES = {
  maquillaje: ['maquillaje', 'maquillajes', 'maquillar', 'maquillarme', 'make', 'makeup'],
  estetica: ['estetica', 'hair', 'pelo', 'cabello'],
  eventos: ['evento', 'eventos', 'fiesta', 'fiestas', 'cumple', 'cumpleanos', 'party'],
  academia: INTENCIONES.cursos,
};
// Palabras del nombre que no hace falta mencionar para que el nombre se considere "completo".
const DECORATIVAS = new Set(['estacion', 'premium', 'experiencia', 'diseno', 'exclusivo', 'profesional', 'vip', 'art', 'makeup', 'infantil', 'aprox']);
// Palabras extra por servicio (además del nombre). Si Tania agrega servicios nuevos, se encuentran por su nombre.
const SINONIMOS = {
  'maquillaje-social': ['social', 'graduacion', 'egreso', 'cena', 'casual', 'invitada'],
  'maquillaje-alta-gama': ['alta gama', 'gama', 'lujo'],
  'maquillaje-aerografo': ['aerografo', 'airbrush', 'hd'],
  'maquillaje-novias': ['novia', 'novias', 'boda', 'casamiento', 'nupcial', 'civil'],
  'maquillaje-quinceaneras': ['quince', 'quinceanera', 'quinceaneras', 'xv', '15', 'debutante', 'debutantes'],
  'maquillaje-artistico-fx': ['fx', 'halloween', 'efectos', 'terror', 'disfraz'],
  'maquillaje-delineados': ['delineado', 'delineados', 'delineador', 'ojos'],
  cejas: ['ceja', 'cejas', 'perfilado', 'depilacion'],
  trenzas: ['trenza', 'trenzas', 'kanekalon', 'braids'],
  tocados: ['tocado', 'tocados', 'accesorio', 'accesorios', 'tiara', 'corona'],
  'glitter-bar': ['glitter', 'brillo', 'brillos', 'brillitos', 'purpurina'],
  'neon-party': ['neon', 'fluor', 'fluo', 'uv'],
  'combo-glitter-neon': ['combo'],
  'caritas-pintadas': ['carita', 'caritas', 'infantil', 'nino', 'ninos', 'nenes', 'pintacaritas', 'chicos'],
  'curso-automaquillaje': ['automaquillaje', 'auto maquillaje', 'maquillarme yo', 'maquillarme sola'],
  'curso-maquillador-inicial': ['inicial', 'principiante', 'desde cero', 'basico'],
  'curso-maquillador-avanzado': ['avanzado', 'perfeccionamiento'],
  'curso-maquillaje-artistico': ['masterclass'],
  'curso-fotografia-beauty': ['fotografia', 'foto', 'fotos', 'fotografo'],
};

// ------------------------------------------------------------------ índice de servicios
let cacheIndice = { servicios: null, indice: null };
function indice(servicios) {
  if (cacheIndice.servicios === servicios) return cacheIndice.indice;
  const filas = servicios.map((s) => {
    const nombre = normalizar(s.nombre).split(' ').filter((p) => p.length > 1 && !VACIAS.has(p));
    const extra = (SINONIMOS[s.id] || []).map(normalizar);
    const frases = extra.filter((x) => x.includes(' '));
    const palabras = [...new Set([...nombre, ...extra.filter((x) => !x.includes(' ')),
      ...(s.variantes || []).flatMap((v) => normalizar(v.etiqueta).split(' ').filter((p) => p.length > 3 && !VACIAS.has(p)))])];
    return { s, nombre: [...new Set(nombre)], palabras, frases };
  });
  const df = {};
  for (const f of filas) for (const p of f.palabras) df[p] = (df[p] || 0) + 1;
  const N = filas.length;
  for (const f of filas) f.peso = Object.fromEntries(f.palabras.map((p) => [p, Math.log((N + 1) / df[p])]));
  cacheIndice = { servicios, indice: filas };
  return filas;
}

/** Busca servicios mencionados. Devuelve candidatos ordenados [{ s, puntos, completo }]. */
function buscarServicios(consulta, catalogo, { soloCursos = false } = {}) {
  const filas = indice(catalogo.servicios);
  const palabras = consulta.palabras.filter((p) => !VACIAS.has(p));
  const res = [];
  for (const f of filas) {
    let puntos = 0; const usados = new Set();
    for (const p of palabras) {
      let mejor = 0, cual = null;
      for (const k of f.palabras) if (!usados.has(k) && coincide(p, k) && f.peso[k] > mejor) { mejor = f.peso[k]; cual = k; }
      if (cual) { usados.add(cual); puntos += mejor; }
    }
    for (const fr of f.frases) if ((' ' + consulta.norm + ' ').includes(' ' + fr + ' ')) puntos += 2.5;
    if (!puntos) continue;
    const completo = f.nombre.every((k) => usados.has(k) || DECORATIVAS.has(k));
    if (f.s.categoria === 'academia' && !soloCursos) puntos *= 0.7;
    if (soloCursos && f.s.categoria !== 'academia') puntos *= 0.6;
    res.push({ s: f.s, puntos: puntos + (completo ? 0.3 : 0), completo });
  }
  return res.sort((a, b) => b.puntos - a.puntos);
}

// ------------------------------------------------------------------ armado de respuestas
const UMBRAL = 1.2;
const chip = (etiqueta, tipo, valor) => ({ etiqueta, tipo, valor });
const pedirTania = (texto) => chip('💬 Hablar con Tania', 'whatsapp', texto || '');
const lista = (items) => items.map((x) => '• ' + x).join('\n');
const sinPunto = (t) => String(t || '').trim().replace(/[.\s]+$/, '');

function detalle(s, regex) {
  const d = (s.detalles || []).concat(s.normas || []).find((x) => x.etiqueta && regex.test(normalizar(x.etiqueta)));
  return d ? sinPunto(d.texto) : '';
}
function duracionDe(s) { return sinPunto(s.duracion || detalle(s, /duracion|carga horaria|tiempo/) || (s.categoria === 'academia' ? s.subtitulo : '')); }
function precioDe(s) {
  if (s.variantes && s.variantes.length) {
    return s.variantes.map((v) => `**${v.etiqueta}:** ${v.precioReserva || v.precio}${v.sena ? ` · seña ${v.sena}` : ''}`).join('\n');
  }
  if (!s.precio) return '**a confirmar con Tania**';
  const pr = s.precioReserva && normalizar(s.precioReserva) !== normalizar(s.precio) ? s.precioReserva : '';
  if (pr && normalizar(pr).startsWith(normalizar(s.precio))) return `**${s.precio}**${pr.slice(s.precio.length)}`;
  return `**${s.precio}**${pr ? ` (${pr})` : ''}`;
}
function senaDe(s) {
  if (s.variantes && s.variantes.length) return '';
  return s.sena ? `Seña para reservar: **${s.sena}** (se descuenta del total).` : 'La seña de este servicio te la confirma Tania.';
}
function chipsReserva(s) {
  const verbo = s.categoria === 'academia' ? 'Inscribirme' : 'Reservar';
  if (s.variantes && s.variantes.length) return s.variantes.map((v) => ({ ...chip(`📅 ${verbo}: ${v.etiqueta}`, 'reservar', v.id), principal: true }));
  return [{ ...chip(`📅 ${verbo}`, 'reservar', s.id), principal: true }];
}
function fichaServicio(s, { foco } = {}) {
  const partes = [`**${s.nombre}**`];
  if (s.resumen && foco !== 'precio') partes.push(sinPunto(s.resumen) + '.');
  partes.push((s.variantes ? 'Opciones:\n' : 'Precio: ') + precioDe(s));
  const sena = senaDe(s); if (sena) partes.push(sena);
  const dur = duracionDe(s); if (dur) partes.push(`Duración: ${dur}.`);
  return partes.join('\n');
}
function textosDe(s) {
  const t = [];
  for (const d of (s.detalles || [])) t.push(d.etiqueta ? `**${d.etiqueta}:** ${sinPunto(d.texto)}` : sinPunto(d.texto));
  for (const d of (s.beneficios || [])) t.push(sinPunto(d.texto));
  for (const sec of (s.secciones || [])) t.push(`**${sec.titulo}:** ${(sec.items || []).map(sinPunto).join('; ')}`);
  return t;
}
// Busca palabras de la pregunta dentro de los textos publicados (detalles, beneficios, normas…).
function buscarEnTextos(palabras, servicios) {
  const raices = palabras.filter((p) => p.length >= 5).map((p) => p.slice(0, Math.max(5, p.length - 2)));
  if (!raices.length) return [];
  const hallados = [];
  for (const s of servicios) {
    const textos = [...textosDe(s), ...(s.normas || []).map((n) => `**${n.etiqueta}:** ${sinPunto(n.texto)}`), s.subtitulo || ''].filter(Boolean);
    for (const t of textos) {
      const n = ' ' + normalizar(t) + ' ';
      if (raices.some((r) => n.includes(' ' + r))) hallados.push({ s, t });
    }
  }
  return hallados;
}
function serviciosDeCategoria(catalogo, id) { return catalogo.servicios.filter((s) => s.categoria === id); }
function tituloCategoria(c) { return [c.tituloSeccion, c.resaltado].filter(Boolean).join(' ') || c.titulo; }

function respuestaCategoria(catalogo, cat, modo) {
  const servs = serviciosDeCategoria(catalogo, cat.id);
  if (!servs.length) return null;
  const encabezado = modo === 'reservar' ? `¡Dale! ¿Cuál de ${cat.esCurso ? 'estos cursos' : 'estos servicios'} te interesa? Te abro el formulario ya listo.` : `**${cat.titulo}**:`;
  return {
    texto: encabezado + '\n' + lista(servs.map((s) => `${s.nombre}: ${s.variantes ? s.variantes.map((v) => v.precio).join(' / ') : (s.precio || 'a confirmar')}`)),
    chips: servs.slice(0, 8).map((s) => (modo === 'reservar' && !s.variantes
      ? chip(s.nombre, 'reservar', s.id)
      : chipServicio(s, modo === 'reservar' ? 'reservar' : 'info'))),
  };
}
function chipsCategorias(catalogo, modo) {
  return catalogo.categorias.filter((c) => serviciosDeCategoria(catalogo, c.id).length)
    .map((c) => chip(c.titulo, 'preguntar', `#cat:${c.id}:${modo === 'reservar' ? 'reservar' : 'info'}`));
}
const chipServicio = (s, accion, etiqueta) => chip(etiqueta || s.nombre, 'preguntar', `#srv:${s.id}:${accion}`);

// Órdenes internas de los botones (#cat:id:modo, #srv:id:accion): respuesta exacta, sin adivinar.
function comando(tipo, id, accion, catalogo, estado) {
  if (tipo === 'cat') {
    const cat = catalogo.categorias.find((c) => c.id === id);
    const r = cat && respuestaCategoria(catalogo, cat, accion === 'reservar' ? 'reservar' : 'info');
    estado.fallos = 0;
    return { chips: [], entendido: true, servicio: null, ...(r || bienvenida(catalogo)) };
  }
  const s = catalogo.servicios.find((x) => x.id === id);
  if (!s) return { ...bienvenida(catalogo), entendido: true, servicio: null };
  const frase = { reservar: 'reservar', precio: 'precio', incluye: 'que incluye', info: '' }[accion] ?? '';
  estado.ultimoServicio = s.id;
  return responder(`${frase} ${s.nombre}`.trim(), catalogo, { ...estado, forzarServicio: s.id });
}
const CHIPS_INICIO = [
  chip('💄 Precios', 'preguntar', 'precios'), chip('📅 Reservar turno', 'preguntar', 'quiero reservar'),
  chip('🕒 Horarios', 'preguntar', 'horarios'), chip('📍 ¿Dónde quedan?', 'preguntar', 'dónde quedan'),
  chip('🎓 Cursos', 'preguntar', 'cursos'), chip('💳 Seña y pagos', 'preguntar', 'seña y pagos'),
];

export function bienvenida(catalogo) {
  return {
    texto: `¡Hola! 💄 Soy la asistente virtual de ${catalogo.negocio.nombre}. Te ayudo con precios, horarios, cursos y reservas.\n¿Qué querés saber?`,
    chips: [...CHIPS_INICIO, pedirTania()],
  };
}

function abiertoAhora(negocio, ahora = new Date()) {
  const zona = negocio.zonaHoraria || 'Etc/GMT+3';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zona, weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(ahora).map((x) => [x.type, x.value]));
  const min = (Number(p.hour) % 24) * 60 + Number(p.minute);
  const h = (negocio.horario || []).find((x) => x.dias.includes(p.weekday));
  if (!h) return false;
  const aMin = (t) => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
  return min >= aMin(h.abre) && min < aMin(h.cierra);
}

// ------------------------------------------------------------------ respuesta principal
export function responder(textoOriginal, catalogo, estado = {}) {
  const cmd = /^#(cat|srv):([\w-]*):(\w+)$/.exec(String(textoOriginal || '').trim());
  if (cmd) return comando(cmd[1], cmd[2], cmd[3], catalogo, estado);
  const norm = normalizar(textoOriginal);
  const consulta = { norm, palabras: norm.split(' ').filter(Boolean) };
  const neg = catalogo.negocio;
  const quiere = Object.fromEntries(Object.entries(INTENCIONES).map(([k, v]) => [k, tieneAlguna(consulta, v)]));
  // "¿cuánto dura?" no es una pregunta de precio
  if (quiere.precio && quiere.duracion && !tieneAlguna(consulta, INTENCIONES.precio.filter((k) => k !== 'cuanto'))) quiere.precio = false;
  const soloCursos = quiere.cursos;
  const cand = buscarServicios(consulta, catalogo, { soloCursos });
  let servicio = null; let ambiguos = [];
  if (estado.forzarServicio) { servicio = catalogo.servicios.find((x) => x.id === estado.forzarServicio) || null; delete estado.forzarServicio; }
  else if (cand.length && cand[0].puntos >= UMBRAL) {
    const top = cand[0];
    ambiguos = cand.filter((c) => c !== top && c.puntos >= top.puntos * 0.9 && !(top.completo && !c.completo));
    servicio = ambiguos.length ? null : top.s;
    if (ambiguos.length) ambiguos.unshift(top);
  }
  const categoria = catalogo.categorias.find((c) => tieneAlguna(consulta, CATEGORIA_CLAVES[c.id] || [normalizar(c.titulo)]));
  // Palabras con contenido que no se entendieron (ni intención, ni categoría, ni servicio): p. ej. "peinado", "uñas"
  const conocidas = [...Object.values(INTENCIONES).flat(), ...Object.values(CATEGORIA_CLAVES).flat()].filter((k) => !k.includes(' '));
  const delIndice = indice(catalogo.servicios).flatMap((f) => f.palabras);
  const residuo = consulta.palabras.filter((p) => p.length >= 4 && !VACIAS.has(p) && !/^\d+$/.test(p)
    && !conocidas.some((k) => coincide(p, k)) && !delIndice.some((k) => coincide(p, k)));
  // "y la seña?" / "cuánto dura?" → se usa el último servicio del que se habló
  const necesitaServicio = quiere.precio || quiere.reservar || quiere.duracion || quiere.sena || quiere.domicilio || quiere.puntualidad || quiere.incluye;
  const delContexto = !servicio && !ambiguos.length && !categoria && necesitaServicio && estado.ultimoServicio
    ? catalogo.servicios.find((s) => s.id === estado.ultimoServicio) : null;
  const s = servicio || delContexto;
  const fin = (r) => {
    estado.ultimoServicio = s ? s.id : null; // el contexto vale solo para la pregunta siguiente
    estado.fallos = r.entendido === false ? (estado.fallos || 0) + 1 : 0;
    return { chips: [], entendido: true, servicio: s ? s.id : null, ...r };
  };
  const waConsulta = `¡Hola Tania! Te escribo desde la web. ${textoOriginal}`.trim();

  if (!consulta.palabras.length) return fin({ ...bienvenida(catalogo) });

  // 1. Hablar con una persona
  if (quiere.humano) {
    return fin({ texto: `¡Claro! Escribile directo a Tania por WhatsApp al **${neg.telefonoVisible}** y te responde personalmente. 💬`, chips: [pedirTania('¡Hola Tania! Te escribo desde la web.')] });
  }

  // 2. Varios servicios posibles → que elija
  if (ambiguos.length) {
    const accion = quiere.reservar ? 'reservar' : quiere.precio ? 'precio' : 'info';
    return fin({
      texto: '¿Cuál de estos querés decir?',
      chips: ambiguos.slice(0, 5).map((c) => (accion === 'reservar' && !c.s.variantes ? chip(c.s.nombre, 'reservar', c.s.id) : chipServicio(c.s, accion))),
    });
  }

  // 3. Reservar
  if (quiere.reservar && !quiere.cancelar) {
    if (s && s.categoria === 'academia') {
      return fin({ texto: `¡Genial! 🥰 Te abro la **inscripción online** de **${s.nombre}**. Completás nombre, teléfono y email, y al instante ves el total a pagar (curso + matrícula) y los datos para transferencia o QR. Después le mandás el comprobante a Tania por WhatsApp y te habilita las clases.`, chips: [...chipsReserva(s), chipServicio(s, 'incluye', 'Ver detalles')] });
    }
    if (s) {
      const extra = s.categoria === 'eventos' || s.usaTurno === false
        ? 'Elegís la fecha que preferís y Tania te confirma.'
        : 'En el formulario ves los horarios libres y elegís el tuyo.';
      return fin({ texto: `¡Genial! 🥰 Te abro el formulario para **${s.nombre}** ya completo con el servicio. ${extra}\n${senaDe(s)}`.trim(), chips: [...chipsReserva(s), chipServicio(s, 'incluye', 'Ver detalles')] });
    }
    if (categoria) { const r = respuestaCategoria(catalogo, categoria, 'reservar'); if (r) return fin(r); }
    return fin({ texto: '¡Dale! ¿Para qué servicio querés reservar? Elegí una categoría:', chips: [...chipsCategorias(catalogo, 'reservar'), chip('Abrir el formulario', 'reservar', '')] });
  }

  // 4. Cancelar o cambiar fecha
  if (quiere.cancelar) {
    const regla = (neg.politicaSena || '').split(/(?<=\.)\s+/).find((x) => /reembols|cancel/.test(normalizar(x)));
    return fin({ texto: `Para cancelar o cambiar la fecha de tu turno escribile a Tania por WhatsApp.${regla ? '\n' + regla.replace(/^\*\s*/, '') : ''}`, chips: [pedirTania(waConsulta)] });
  }

  // 5. Domingos y fuera de horario
  if (quiere.domingo) {
    return fin({ texto: `${neg.politicaHorario || neg.horarioEspecial} 🗓️\nHorario habitual: ${neg.horarioTexto}`, chips: [...(s ? chipsReserva(s) : [chip('📅 Pedir turno', 'preguntar', 'quiero reservar')]), pedirTania(waConsulta)] });
  }

  // 6. Seña / pagos
  if (quiere.sena || quiere.pago) {
    if (s && quiere.sena && !quiere.pago) return fin({ texto: `${s.nombre}: ${senaDe(s) || 'opciones con seña:\n' + precioDe(s)}`, chips: chipsReserva(s) });
    const pago = neg.pago || {};
    const otro = tieneAlguna(consulta, ['tarjeta*', 'efectivo', 'debito', 'credito', 'cuotas', 'billetera', 'giro']);
    let t = neg.politicaSena || '';
    if (pago.opciones) t += `\nAl reservar elegís: ${pago.opciones.map((o) => (pago.etiquetas && pago.etiquetas[o]) || o).join(' o ')}.`;
    if (otro) t += '\nPara otros medios de pago (tarjeta, efectivo u otros) consultale directamente a Tania.';
    if (s && s.sena) t += `\n${s.nombre}: seña ${s.sena}.`;
    return fin({ texto: t.trim(), chips: [chip('Ver señas por servicio', 'preguntar', 'precios'), ...(otro ? [pedirTania(waConsulta)] : [chip('📅 Reservar', 'preguntar', 'quiero reservar')])] });
  }

  // 7. Cursos / matrícula
  if (quiere.cursos && !s) {
    const cursos = serviciosDeCategoria(catalogo, 'academia');
    if (quiere.matricula) {
      const lineas = cursos.flatMap((c) => (c.variantes ? c.variantes.map((v) => `${v.nombreReserva || v.etiqueta}: ${v.precioReserva || v.precio}`) : [`${c.nombre}: ${c.precioReserva || c.precio}`]));
      return fin({ texto: 'Esto es lo que figura para cada curso (con o sin matrícula):\n' + lista(lineas), chips: cursos.map((c) => chipServicio(c, 'info')) });
    }
    if (residuo.length) {
      const hallados = buscarEnTextos(residuo, cursos);
      if (hallados.length) return fin({ texto: 'Esto es lo que figura en los cursos:\n' + lista(hallados.slice(0, 5).map((h) => `${h.s.nombre}: ${h.t}`)), chips: [...new Set(hallados.map((h) => h.s))].slice(0, 4).map((c) => chipServicio(c, 'info')).concat(pedirTania(waConsulta)) });
      return fin({ texto: `Sobre «${residuo.join(' ')}» no tengo el dato en la información de los cursos. 🙈 Consultale a Tania y te lo confirma.`, chips: [pedirTania(waConsulta), chip('🎓 Ver cursos', 'preguntar', '#cat:academia:info')] });
    }
    const cat = catalogo.categorias.find((c) => c.id === 'academia');
    const r = cat && respuestaCategoria(catalogo, cat, quiere.reservar ? 'reservar' : 'info');
    if (r) return fin({ ...r, texto: `🎓 ${cat.descripcion ? sinPunto(cat.descripcion) + '.\n' : ''}${r.texto.replace(/^\*\*.*\*\*:\n/, 'Cursos disponibles:\n')}` });
  }

  // 8. Servicio concreto (precio, duración, a domicilio, puntualidad, detalles…)
  if (s) {
    if (quiere.puntualidad) { const p = detalle(s, /puntualidad|tolerancia/); return fin({ texto: p ? `${s.nombre} · Puntualidad: ${p}.` : 'Sobre la tolerancia de horario consultale a Tania.', chips: p ? chipsReserva(s) : [pedirTania(waConsulta)] }); }
    if (quiere.duracion && !quiere.precio) { const d = duracionDe(s); return fin({ texto: d ? `${s.nombre}: ${d}.` : `La duración de ${s.nombre} te la confirma Tania.`, chips: [...chipsReserva(s), ...(d ? [] : [pedirTania(waConsulta)])] }); }
    if (quiere.domicilio) {
      const d = (s.detalles || []).find((x) => /domicilio|studio|lugar|logistica|modalidad/.test(normalizar(x.etiqueta + ' ' + x.texto)));
      return fin({ texto: d ? `${s.nombre} · ${d.etiqueta}: ${sinPunto(d.texto)}.` : `Para ${s.nombre} a domicilio consultale a Tania.`, chips: [...chipsReserva(s), pedirTania(waConsulta)] });
    }
    if (quiere.incluye) {
      const filas = textosDe(s);
      const sub = s.subtitulo ? sinPunto(s.subtitulo) + '.\n' : '';
      return fin({ texto: `**${s.nombre}**${s.detallesTitulo ? ' · ' + s.detallesTitulo : ''}\n${sub}${filas.length ? lista(filas) : sinPunto(s.resumen) + '.'}`, chips: [...chipsReserva(s), chip('Ver fotos y detalles', 'detalle', s.id)] });
    }
    const sinDuracion = quiere.duracion && !duracionDe(s) ? '\nLa duración te la confirma Tania.' : '';
    return fin({ texto: fichaServicio(s, { foco: quiere.precio ? 'precio' : '' }) + sinDuracion, chips: [...chipsReserva(s), chip('Ver fotos y detalles', 'detalle', s.id), ...(quiere.precio ? [] : [chipServicio(s, 'incluye', '¿Qué incluye?')])] });
  }

  // 9a. Pidió algo que no está en la lista ("precio de peinado")
  if (residuo.length && (quiere.precio || quiere.servicios || quiere.reservar)) {
    return fin({ entendido: false, texto: `No encontré «${residuo.join(' ')}» entre los servicios publicados. 🙈 Te muestro las categorías, o consultale directo a Tania.`, chips: [...chipsCategorias(catalogo, 'info'), pedirTania(waConsulta)] });
  }
  // 9. Lista de precios / servicios por categoría
  if (categoria && (quiere.precio || quiere.servicios || consulta.palabras.length <= 4)) {
    const r = respuestaCategoria(catalogo, categoria, 'info'); if (r) return fin(r);
  }
  if (quiere.precio || quiere.servicios) {
    return fin({ texto: '¿De qué categoría querés ver los precios? 💄', chips: chipsCategorias(catalogo, 'info') });
  }

  // 10. Horario
  if (quiere.horario) {
    const ahora = tieneAlguna(consulta, ['ahora', 'hoy']) ? (abiertoAhora(neg) ? '\nAhora mismo estamos en horario de atención. 🙌' : '\nAhora mismo estamos fuera del horario habitual.') : '';
    return fin({ texto: `🕒 ${neg.horarioTexto}\n${neg.atencionNota || ''}\n${neg.horarioEspecial || ''}${ahora}`.replace(/\n+/g, '\n').trim(), chips: [chip('📅 Reservar turno', 'preguntar', 'quiero reservar'), chip('¿Atienden domingos?', 'preguntar', '¿atienden los domingos?')] });
  }

  // 11. Ubicación
  if (quiere.ubicacion || quiere.domicilio) {
    let t = `📍 Estamos en **${neg.direccion}**`;
    if (neg.atencionNota) t += `\n${neg.atencionNota}`;
    if (quiere.domicilio) {
      const conDomicilio = catalogo.servicios.map((x) => [x, (x.detalles || []).find((d) => /domicilio/.test(normalizar(d.texto)))]).filter(([, d]) => d);
      t = conDomicilio.length ? 'A domicilio, según el servicio:\n' + lista(conDomicilio.map(([x, d]) => `${x.nombre}: ${sinPunto(d.texto)}`)) + `\nEl Studio está en ${neg.direccion}` : `Para servicios a domicilio consultale a Tania. El Studio está en ${neg.direccion}`;
    }
    return fin({ texto: t, chips: [...(neg.mapa ? [chip('🗺️ Ver en el mapa', 'enlace', neg.mapa)] : []), chip('🕒 Horarios', 'preguntar', 'horarios'), ...(quiere.domicilio ? [pedirTania(waConsulta)] : [])] });
  }

  // 12. Contacto y redes
  if (quiere.contacto) {
    const r = neg.redes || {};
    return fin({ texto: `Podés escribirle a Tania por WhatsApp al **${neg.telefonoVisible}**. También está en redes. 💕`, chips: [pedirTania('¡Hola Tania! Te escribo desde la web.'), ...(r.instagram ? [chip('Instagram', 'enlace', r.instagram)] : []), ...(r.facebook ? [chip('Facebook', 'enlace', r.facebook)] : []), ...(r.tiktok ? [chip('TikTok', 'enlace', r.tiktok)] : [])] });
  }

  // 13. Categoría sola ("maquillaje", "eventos")
  if (categoria) { const r = respuestaCategoria(catalogo, categoria, 'info'); if (r) return fin(r); }

  // 14. Saludo / gracias
  if (quiere.gracias && consulta.palabras.length <= 5) return fin({ texto: '¡De nada! 💖 Si necesitás algo más, acá estoy.', chips: [chip('📅 Reservar turno', 'preguntar', 'quiero reservar'), pedirTania()] });
  if (quiere.saludo && consulta.palabras.length <= 5) return fin({ ...bienvenida(catalogo), texto: '¡Hola! 😊 ¿En qué te puedo ayudar? Contame qué servicio te interesa o elegí una opción.' });

  // 15a. Buscar en los textos publicados (ej. "henna", "kanekalon", "enchufe")
  if (residuo.length) {
    const hallados = buscarEnTextos(residuo, catalogo.servicios);
    if (hallados.length && hallados.length <= 4) {
      return fin({ texto: 'Esto es lo que encontré en los servicios:\n' + lista(hallados.map((h) => `${h.s.nombre}: ${h.t}`)), chips: [...new Set(hallados.map((h) => h.s))].slice(0, 3).map((x) => chipServicio(x, 'info')).concat(pedirTania(waConsulta)) });
    }
  }
  // 15. No entendí → nunca inventar
  const varias = (estado.fallos || 0) >= 1;
  return fin({
    entendido: false,
    texto: varias
      ? 'Perdón, eso no lo sé responder. 🙈 Lo mejor es que se lo preguntes directo a Tania por WhatsApp: te responde ella misma.'
      : 'Mmm, de eso no tengo información. 🙈 Puedo ayudarte con servicios, precios, horarios, ubicación, seña y pagos, cursos o reservas. Si preferís, hablá directo con Tania.',
    chips: varias ? [pedirTania(waConsulta), ...CHIPS_INICIO.slice(0, 3)] : [...CHIPS_INICIO.slice(0, 5), pedirTania(waConsulta)],
  });
}
