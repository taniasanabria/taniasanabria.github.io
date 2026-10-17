#!/usr/bin/env node
/*
 * Genera supabase/seed.sql a partir de data/catalogo.json e img/manifiesto.json.
 * El seed es idempotente y NO pisa cambios hechos desde el panel:
 * solo inserta lo que todavía no existe.
 *   node tools/generar-seed.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalogo = JSON.parse(readFileSync(join(raiz, 'data/catalogo.json'), 'utf8'));
const manifiesto = JSON.parse(readFileSync(join(raiz, 'img/manifiesto.json'), 'utf8'));

const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const jb = (o) => `${q(JSON.stringify(o))}::jsonb`;
const gs = (t) => { const m = String(t || '').match(/\d{1,3}(?:\.\d{3})+|\d+/); return m ? Number(m[0].replace(/\./g, '')) : null; };

// Duración en minutos para la agenda: se toma el máximo del texto ("1.5 a 2 horas" → 120). Editable en el panel.
function minutos(texto) {
  if (!texto) return 60;
  const nums = (texto.match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(',', '.')));
  if (!nums.length) return 60;
  const max = Math.max(...nums);
  return Math.round(/min/i.test(texto) ? max : max * 60);
}

const CORE = ['id', 'categoria', 'nombre', 'resumen', 'precio', 'precioReserva', 'sena', 'duracion', 'fotos'];
const lineas = [
  '-- Seed generado por tools/generar-seed.mjs desde data/catalogo.json. Idempotente: no pisa cambios del panel.',
  'begin;',
  '',
  '-- Ajustes públicos',
  `update public.ajustes set whatsapp = ${q(catalogo.negocio.whatsapp)}, politica_sena = ${q(catalogo.negocio.politicaSena)}, politica_horario = ${q(catalogo.negocio.politicaHorario)}`,
  `  where id = 1 and politica_sena = '' and politica_horario = '';`,
  '',
  '-- Servicios',
];
catalogo.servicios.forEach((s, i) => {
  const extra = Object.fromEntries(Object.entries(s).filter(([k]) => !CORE.includes(k)));
  const usaTurno = !(s.categoria === 'eventos' || s.categoria === 'academia');
  lineas.push(
    `insert into public.servicios (id, categoria, nombre, descripcion, precio_texto, precio_reserva_texto, precio_gs, sena_gs, duracion_texto, duracion_min, usa_turno, activo, orden, extra) values (` +
      [q(s.id), q(s.categoria), q(s.nombre), q(s.resumen || ''), q(s.precio || ''), q(s.precioReserva || null), gs(s.precioTotal || s.precio) ?? 'null',
        s.sena ? gs(s.sena) : 'null', q(s.duracion || null), minutos(s.duracion), usaTurno, true, (i + 1) * 10, jb(extra)].join(', ') +
      ') on conflict (id) do nothing;',
  );
});

lineas.push('', '-- Álbumes');
catalogo.galerias.forEach((g, i) => {
  lineas.push(`insert into public.albumes (id, titulo, orden, activo) values (${q(g.id)}, ${q(g.titulo)}, ${(i + 1) * 10}, true) on conflict (id) do nothing;`);
});

lineas.push('', '-- Fotos que ya están en el repositorio (img/). Solo se insertan si no existen para ese destino.');
const foto = (destCol, destId, base, orden, alt) => {
  const m = manifiesto[base];
  if (!m) return null;
  return `insert into public.fotos (${destCol}, origen, ruta, anchos, ancho, alto, alt, orden)
  select ${q(destId)}, 'sitio', ${q(base)}, '{${m.anchos.join(',')}}', ${m.w}, ${m.h}, ${q(alt)}, ${orden}
  where not exists (select 1 from public.fotos where ${destCol} = ${q(destId)} and origen = 'sitio' and ruta = ${q(base)});`;
};
for (const s of catalogo.servicios) (s.fotos || []).forEach((f, i) => { const l = foto('servicio_id', s.id, f, (i + 1) * 10, `${s.nombre}: trabajo de Tania Sanabria`); if (l) lineas.push(l); });
for (const g of catalogo.galerias) (g.fotos || []).forEach((f, i) => { const l = foto('album_id', g.id, f, (i + 1) * 10, `${g.titulo}: foto ${i + 1}`); if (l) lineas.push(l); });

lineas.push('', '-- Horario semanal (solo si todavía no se cargó ninguno)');
const DIAS = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
const valores = catalogo.negocio.horario.flatMap((h) => h.dias.map((d) => `(${DIAS[d]}, '${h.abre}', '${h.cierra}')`));
lineas.push(`insert into public.horario_semanal (dia, abre, cierra)
  select v.dia, v.abre::time, v.cierra::time from (values ${valores.join(', ')}) as v(dia, abre, cierra)
  where not exists (select 1 from public.horario_semanal);`);

lineas.push('', 'commit;', '', "select (select count(*) from public.servicios) as servicios, (select count(*) from public.fotos) as fotos, (select count(*) from public.albumes) as albumes, (select count(*) from public.horario_semanal) as franjas_horario;", '');
writeFileSync(join(raiz, 'supabase/seed.sql'), lineas.join('\n'));
console.log(`supabase/seed.sql: ${catalogo.servicios.length} servicios, ${catalogo.galerias.length} álbumes.`);
