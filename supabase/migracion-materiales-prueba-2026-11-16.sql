-- Materiales editables + cuenta de prueba (2026-11-16)
-- 1) Versiones anteriores del PDF de cada clase (copia de respaldo en el bucket "cursos"; la alumna nunca las ve)
alter table public.lecciones add column if not exists versiones_previas jsonb not null default '[]'::jsonb;

-- 2) Marca de cuenta de prueba: la inscripción de prueba no aparece en la agenda, en el panel ni en estadísticas/pagos
alter table public.inscripciones add column if not exists es_prueba boolean not null default false;
alter table public.alumnos add column if not exists es_prueba boolean not null default false;

drop policy if exists inscripciones_admin on public.inscripciones;
create policy inscripciones_admin on public.inscripciones for all to authenticated
  using (es_admin() and estado <> 'borrador' and not es_prueba)
  with check (es_admin() and estado <> 'borrador' and not es_prueba);

CREATE OR REPLACE FUNCTION public.admin_alumnas()
 RETURNS TABLE(inscripcion_id uuid, referencia text, email text, nombre text, telefono text, servicio_id text, curso text, estado text, acceso boolean, tiene_cuenta boolean, entregas integer, pendientes integer, promedio numeric, creado timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
return query select i.id, i.referencia, i.cliente_email, coalesce(p.nombre, i.cliente_nombre), coalesce(nullif(p.telefono, ''), i.cliente_telefono),
i.servicio_id, i.curso_nombre, i.estado, i.acceso, u.id is not null,
(select count(*)::int from public.entregas e where e.email = i.cliente_email and e.servicio_id = i.servicio_id),
(select count(*)::int from public.entregas e where e.email = i.cliente_email and e.servicio_id = i.servicio_id and e.estado = 'enviada'),
(select round(avg(e.calificacion), 1) from public.entregas e where e.email = i.cliente_email and e.servicio_id = i.servicio_id and e.calificacion is not null),
i.creado
from public.inscripciones i
left join auth.users u on lower(u.email) = i.cliente_email
left join public.perfiles p on p.user_id = u.id
where i.estado not in ('cancelada', 'borrador') and not i.es_prueba
order by i.acceso, i.creado desc limit 1000;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_aula_seguimiento()
 RETURNS TABLE(inscripcion_id uuid, nombre text, telefono text, curso text, servicio_id text, mes integer, clases integer, aprobadas integer, enviadas integer, ultima_entrega timestamp with time zone, plazo date, atrasada boolean, examen_estado text, certificado text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare hoy date := (now() at time zone 'America/Asuncion')::date;
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  return query
  with b as (select i.*, public._aula_uid_de(i.id) uid from public.inscripciones i where i.acceso and i.estado <> 'cancelada' and not i.es_prueba)
  select b.id, coalesce(pf.nombre, b.cliente_nombre), coalesce(nullif(pf.telefono, ''), b.cliente_telefono), b.curso_nombre, b.servicio_id, b.meses_habilitados,
         c.total, c.aprobadas, c.enviadas,
         (select max(e.creado) from public.entregas e where e.user_id = b.uid and e.servicio_id = b.servicio_id),
         pl.vence,
         pl.vence is not null and pl.vence < hoy and not coalesce((select true from public.aula_examenes x where x.user_id = b.uid and x.servicio_id = b.servicio_id and x.mes = b.meses_habilitados and x.estado = 'aprobado' limit 1), false),
         (select x.estado from public.aula_examenes x where x.user_id = b.uid and x.servicio_id = b.servicio_id and x.mes = b.meses_habilitados and x.estado <> 'cancelado' order by x.creado desc limit 1),
         (select ce.codigo from public.aula_certificados ce where ce.inscripcion_id = b.id)
    from b left join public.perfiles pf on pf.user_id = b.uid
    left join public.aula_plazos pl on pl.servicio_id = b.servicio_id and pl.mes = b.meses_habilitados
    cross join lateral public._aula_clases_mes(b.id, b.meses_habilitados) c
   order by 12 desc, 2;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_pagos_aula(p_estado text DEFAULT 'pendiente'::text)
 RETURNS TABLE(id uuid, inscripcion_id uuid, mes integer, ruta text, monto_gs bigint, nota text, estado text, respuesta text, creado timestamp with time zone, nombre text, telefono text, email text, curso text, variante_id text, meses_habilitados integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  return query select p.id, p.inscripcion_id, p.mes, p.ruta, p.monto_gs, p.nota, p.estado, p.respuesta, p.creado,
         coalesce(pf.nombre, i.cliente_nombre), coalesce(nullif(pf.telefono, ''), i.cliente_telefono), i.cliente_email, i.curso_nombre, i.variante_id, i.meses_habilitados
    from public.aula_pagos p join public.inscripciones i on i.id = p.inscripcion_id
    left join public.perfiles pf on pf.user_id = p.user_id
   where (p_estado is null or p.estado = p_estado) and not i.es_prueba
   order by p.creado desc limit 500;
end $function$
;
