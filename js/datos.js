/*
 * datos.js: punto único de acceso a los datos del sitio (servicios, precios, fotos, galerías).
 *
 * Hoy los datos vienen embebidos en index.html (los genera tools/build.mjs a partir de
 * data/catalogo.json), así la página carga sin pedidos extra.
 *
 * Para pasar a un panel de administración (fase 2), solo hay que cambiar este archivo:
 *   - FUENTE = 'json'     → lee data/catalogo.json en cada visita (cambios sin volver a compilar).
 *   - FUENTE = 'supabase' → lee las tablas de Supabase (ver ejemplo comentado abajo).
 * El resto del sitio (app.js / render.js) no necesita cambios mientras se respete el mismo formato.
 */
const FUENTE = 'embebido';

function leerEmbebido(id) {
  const nodo = document.getElementById(id);
  return nodo ? JSON.parse(nodo.textContent) : null;
}

export async function cargarCatalogo() {
  if (FUENTE === 'json') {
    const r = await fetch('data/catalogo.json', { cache: 'no-cache' });
    if (r.ok) return r.json();
  }
  // if (FUENTE === 'supabase') {
  //   const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  //   const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  //   const [{ data: servicios }, { data: galerias }, { data: negocio }] = await Promise.all([
  //     sb.from('servicios').select('*').order('orden'),
  //     sb.from('galerias').select('*').order('orden'),
  //     sb.from('negocio').select('*').single(),
  //   ]);
  //   return { ...leerEmbebido('datos-catalogo'), servicios, galerias, negocio };
  // }
  return leerEmbebido('datos-catalogo');
}

export async function cargarManifiestoFotos() {
  // Con Supabase Storage, las URLs de las fotos se resolverían aquí.
  return leerEmbebido('datos-fotos') || {};
}
