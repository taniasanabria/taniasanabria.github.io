/*
 * datos.js: punto único de acceso a los datos del sitio (servicios, precios, fotos, galerías, reservas).
 *
 * 1) Al cargar, el sitio usa los datos embebidos en index.html (los genera tools/build.mjs desde
 *    data/catalogo.json): la página se ve completa al instante y funciona aunque Supabase falle.
 * 2) Después consulta Supabase (tablas públicas + funciones RPC). Si responde, se usan esos datos
 *    (lo que Tania cambia desde /admin/). Si no responde, se sigue con los datos embebidos.
 * Se usa la API REST de Supabase con fetch (sin librerías) para que el sitio siga liviano.
 */
import { FUENTE_DATOS, SUPABASE } from './config.js';

const ESPERA_MS = 6000;

function leerEmbebido(id) {
  const nodo = document.getElementById(id);
  return nodo ? JSON.parse(nodo.textContent) : null;
}

export function cargarCatalogo() {
  return leerEmbebido('datos-catalogo');
}

export function cargarManifiestoFotos() {
  return leerEmbebido('datos-fotos') || {};
}

export const supabaseActivo = () => FUENTE_DATOS === 'supabase' && !!SUPABASE.url && !!SUPABASE.anonKey;

/** Error con código legible (ej. HORARIO_NO_DISPONIBLE) para mostrar mensajes claros. */
export class ErrorDatos extends Error {
  constructor(codigo, detalle) { super(codigo); this.codigo = codigo; this.detalle = detalle; }
}

async function pedir(ruta, { metodo = 'GET', cuerpo } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ESPERA_MS);
  try {
    const r = await fetch(`${SUPABASE.url}/rest/v1/${ruta}`, {
      method: metodo,
      signal: ctrl.signal,
      headers: {
        apikey: SUPABASE.anonKey,
        Authorization: `Bearer ${SUPABASE.anonKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const texto = await r.text();
    const datos = texto ? JSON.parse(texto) : null;
    if (!r.ok) throw new ErrorDatos((datos && datos.message) || `HTTP_${r.status}`, datos);
    return datos;
  } catch (e) {
    if (e instanceof ErrorDatos) throw e;
    throw new ErrorDatos('SIN_CONEXION', String(e));
  } finally {
    clearTimeout(t);
  }
}

export const rpc = (nombre, args) => pedir(`rpc/${nombre}`, { metodo: 'POST', cuerpo: args });

const formatoGs = (n) => 'Gs. ' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const urlFotoStorage = (ruta) => `${SUPABASE.url}/storage/v1/object/public/fotos/${ruta}`;

/**
 * Combina los datos de Supabase con el catálogo embebido (que aporta categorías, textos del negocio, bio…).
 * Devuelve { catalogo, manifiesto } en el mismo formato que usa render.js.
 */
export async function cargarDesdeSupabase(base, manifiestoBase) {
  const [servicios, fotos, albumes, ajustes] = await Promise.all([
    pedir('servicios?select=*&order=orden.asc,nombre.asc'),
    pedir('fotos?select=id,servicio_id,album_id,origen,ruta,anchos,formato,ancho,alto,alt,orden&order=orden.asc,creado.asc'),
    pedir('albumes?select=*&order=orden.asc'),
    pedir('ajustes?select=whatsapp,politica_sena,politica_horario,zona_horaria'),
  ]);
  if (!Array.isArray(servicios) || !servicios.length) throw new ErrorDatos('SIN_DATOS');

  const manifiesto = { ...manifiestoBase };
  const claveFoto = (f) => {
    if (f.origen === 'sitio') return manifiestoBase[f.ruta] ? f.ruta : null;
    const clave = 'sb:' + f.id;
    manifiesto[clave] = { anchos: f.anchos, w: f.ancho, h: f.alto, url: urlFotoStorage(f.ruta), ext: f.formato || 'webp', alt: f.alt };
    return clave;
  };
  const fotosDe = (campo, id) => fotos.filter((f) => f[campo] === id).map(claveFoto).filter(Boolean);

  const lista = servicios.map((r) => {
    const extra = r.extra || {};
    return {
      ...extra,
      id: r.id,
      categoria: r.categoria,
      nombre: r.nombre,
      resumen: r.descripcion,
      precio: r.precio_texto,
      ...(r.precio_reserva_texto ? { precioReserva: r.precio_reserva_texto } : {}),
      sena: r.sena_gs ? formatoGs(r.sena_gs) : (extra.variantes ? undefined : ''),
      duracion: r.duracion_texto || undefined,
      duracionMin: r.duracion_min,
      usaTurno: r.usa_turno,
      fotos: fotosDe('servicio_id', r.id),
    };
  });
  const galerias = albumes.map((a) => ({ id: a.id, titulo: a.titulo, fotos: fotosDe('album_id', a.id) }));
  const aj = (ajustes && ajustes[0]) || {};
  const negocio = {
    ...base.negocio,
    ...(aj.whatsapp ? { whatsapp: aj.whatsapp } : {}),
    ...(aj.politica_sena ? { politicaSena: aj.politica_sena } : {}),
    ...(aj.politica_horario ? { politicaHorario: aj.politica_horario } : {}),
    zonaHoraria: aj.zona_horaria || 'Etc/GMT+3',
  };
  return { catalogo: { ...base, negocio, servicios: lista, galerias }, manifiesto };
}
