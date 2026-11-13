-- Migración 2026-11-13: pausa (suspensión) de alumnas, inscripciones/turnos incompletos (borradores sin alerta),
-- limpieza de datos de alumnas eliminadas y cuotas visibles para la alumna. Se puede ejecutar más de una vez.



alter table public.inscripciones add column if not exists suspendida_desde date;
alter table public.inscripciones add column if not exists pausa_dias integer not null default 0;
alter table public.inscripciones add column if not exists completada_en timestamptz;
alter table public.reservas add column if not exists completada_en timestamptz;
alter table public.inscripciones drop constraint if exists inscripciones_estado_check;
alter table public.inscripciones add constraint inscripciones_estado_check check (estado = any (array['pendiente','pagada','cancelada','borrador']));
alter table public.reservas drop constraint if exists reservas_estado_check;
alter table public.reservas add constraint reservas_estado_check check (estado = any (array['pendiente','aprobada','rechazada','pagada','cancelada','borrador']));
alter table public.reservas drop constraint if exists reservas_sin_superposicion;
alter table public.reservas add constraint reservas_sin_superposicion exclude using gist (tstzrange(inicio, fin, '[)') with &&)
  where (bloquea and estado = any (array['pendiente','aprobada','pagada','borrador']));
create index if not exists inscripciones_borrador_idx on public.inscripciones (creado) where estado = 'borrador';
create index if not exists reservas_borrador_idx on public.reservas (creado) where estado = 'borrador';



drop policy if exists inscripciones_admin on public.inscripciones;
create policy inscripciones_admin on public.inscripciones for all to authenticated
  using (public.es_admin() and estado <> 'borrador') with check (public.es_admin() and estado <> 'borrador');
drop policy if exists reservas_admin on public.reservas;
create policy reservas_admin on public.reservas for all to authenticated
  using (public.es_admin() and estado <> 'borrador') with check (public.es_admin() and estado <> 'borrador');



create or replace function public._hoy_py() returns date language sql stable as $f$ select (now() at time zone 'America/Asuncion')::date $f$;

-- Libera el turno de los borradores de más de 3 h y borra los de más de 48 h (no hay pg_cron: se llama al crear/completar).
create or replace function public._limpiar_borradores() returns void
language plpgsql security definer set search_path to 'public','pg_temp' as $f$
begin
  update public.reservas set bloquea = false where estado = 'borrador' and bloquea and creado < now() - interval '3 hours';
  delete from public.reservas where estado = 'borrador' and creado < now() - interval '48 hours';
  delete from public.inscripciones where estado = 'borrador' and creado < now() - interval '48 hours';
end $f$;


CREATE OR REPLACE FUNCTION public._registrar_eliminado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
begin
if old.estado = 'borrador' then return null; end if;
insert into public.eliminados (tabla, id) values (tg_table_name, old.id)
on conflict (tabla, id) do update set eliminado = now();
return null;
end $function$
;

CREATE OR REPLACE FUNCTION public._limite_alta_web()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
begin
if new.origen = 'web' and coalesce(current_setting('tania.interno', true), '') <> '1' then
perform public._limite_ip(tg_table_name, 6, interval '1 hour');
perform public._captcha_ok();
end if;
return new;
end $function$
;

CREATE OR REPLACE FUNCTION public._ocupados(p_curso text, p_horario text)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
select count(*)::int from public.inscripciones i
where i.servicio_id = p_curso and (i.estado in ('pendiente', 'pagada') or (i.estado = 'borrador' and i.creado > now() - interval '48 hours')) and coalesce(i.app_estado, '') <> 'finalizada'
and (p_horario is null or exists (select 1 from unnest(public._partes_horario(i.horario)) x
where public._norm_horario(x) = public._norm_horario(p_horario))) $function$
;

CREATE OR REPLACE FUNCTION public.horarios_del_dia(p_fecha date, p_servicio text)
RETURNS TABLE(inicio timestamp with time zone, hora text, costo_extra boolean, libre boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
declare a public.ajustes; s public.servicios; v_hoy date; v_dur int; v_dow int;
begin
select * into a from public.ajustes where id = 1;
if not found then return; end if;
s := public._servicio_de(p_servicio);
if s.id is null or not s.activo or not s.usa_turno then return; end if;
v_hoy := (now() at time zone a.zona_horaria)::date;
if p_fecha is null or p_fecha < v_hoy or p_fecha > v_hoy + a.dias_reserva_max then return; end if;
if exists (select 1 from public.bloqueos b where b.fecha = p_fecha) then return; end if;
v_dur := s.duracion_min; v_dow := extract(dow from p_fecha)::int;
return query
with ventanas as (
select h.abre as desde, h.cierra as hasta, (v_dow = 0) as extra from public.horario_semanal h where h.dia = v_dow
union all
select t.inicio, t.fin, (t.costo_extra or v_dow = 0) from public.turnos_extra t where t.fecha = p_fecha
), candidatos as (
select (g.t at time zone a.zona_horaria) as ini, w.extra from ventanas w
cross join lateral generate_series(p_fecha + w.desde, p_fecha + w.hasta - make_interval(mins => v_dur), make_interval(mins => a.intervalo_min)) as g(t)
), agrupados as (select c.ini, bool_and(c.extra) as extra from candidatos c group by c.ini)
select g.ini, to_char(g.ini at time zone a.zona_horaria, 'HH24:MI'), g.extra,
not exists (select 1 from public.reservas r
where r.bloquea and (r.estado in ('pendiente', 'aprobada', 'pagada') or (r.estado = 'borrador' and r.creado > now() - interval '3 hours'))
and tstzrange(r.inicio, r.fin, '[)') && tstzrange(g.ini, g.ini + make_interval(mins => v_dur), '[)'))
from agrupados g
where g.ini >= now() + make_interval(hours => a.anticipacion_horas)
order by g.ini;
end $function$
;

CREATE OR REPLACE FUNCTION public.horarios_libres(p_fecha date, p_servicio text)
RETURNS TABLE(inicio timestamp with time zone, hora text, costo_extra boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
declare
a public.ajustes;
s public.servicios;
v_hoy date;
v_dur int;
v_dow int;
begin
select * into a from public.ajustes where id = 1;
if not found then return; end if;
s := public._servicio_de(p_servicio);
if s.id is null or not s.activo or not s.usa_turno then return; end if;
v_hoy := (now() at time zone a.zona_horaria)::date;
if p_fecha is null or p_fecha < v_hoy or p_fecha > v_hoy + a.dias_reserva_max then return; end if;
if exists (select 1 from public.bloqueos b where b.fecha = p_fecha) then return; end if;
v_dur := s.duracion_min;
v_dow := extract(dow from p_fecha)::int;
return query
with ventanas as (
select h.abre as desde, h.cierra as hasta, (v_dow = 0) as extra
from public.horario_semanal h where h.dia = v_dow
union all
select t.inicio, t.fin, (t.costo_extra or v_dow = 0)
from public.turnos_extra t where t.fecha = p_fecha
),
candidatos as (
select (g.t at time zone a.zona_horaria) as ini, w.extra
from ventanas w
cross join lateral generate_series(p_fecha + w.desde,
p_fecha + w.hasta - make_interval(mins => v_dur),
make_interval(mins => a.intervalo_min)) as g(t)
),
agrupados as (
select c.ini, bool_and(c.extra) as extra from candidatos c group by c.ini
)
select g.ini, to_char(g.ini at time zone a.zona_horaria, 'HH24:MI'), g.extra
from agrupados g
where g.ini >= now() + make_interval(hours => a.anticipacion_horas)
and not exists (
select 1 from public.reservas r
where r.bloquea and (r.estado in ('pendiente', 'aprobada', 'pagada') or (r.estado = 'borrador' and r.creado > now() - interval '3 hours'))
and tstzrange(r.inicio, r.fin, '[)') && tstzrange(g.ini, g.ini + make_interval(mins => v_dur), '[)'))
order by g.ini;
end $function$
;

drop function if exists public._crear_inscripcion(text,text,text,text,text);

CREATE OR REPLACE FUNCTION public._crear_inscripcion(p_curso text, p_nombre text, p_telefono text, p_email text, p_notas text DEFAULT NULL::text, p_borrador boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
s public.servicios;
v_var jsonb;
v_nombre text := btrim(coalesce(p_nombre, ''));
v_tel text := btrim(coalesce(p_telefono, ''));
v_dig text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
v_email text := lower(btrim(coalesce(p_email, '')));
v_notas text := nullif(btrim(coalesce(p_notas, '')), '');
v_curso text; v_precio text; v_mat bigint; v_curso_gs bigint; v_id uuid; v_ref text; v_ref_precio text;
p public.ajustes_privados; v_borrador boolean;
begin
if length(v_nombre) < 3 or length(v_nombre) > 120 then raise exception 'NOMBRE_INVALIDO' using errcode = 'P0001'; end if;
if length(v_dig) < 8 or length(v_dig) > 15 then raise exception 'TELEFONO_INVALIDO' using errcode = 'P0001'; end if;
if length(v_email) > 160 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'EMAIL_INVALIDO' using errcode = 'P0001'; end if;
if v_notas is not null and length(v_notas) > 1000 then raise exception 'NOTAS_DEMASIADO_LARGAS' using errcode = 'P0001'; end if;
s := public._servicio_de(p_curso);
if s.id is null or not s.activo or s.categoria <> 'academia' then raise exception 'CURSO_NO_DISPONIBLE' using errcode = 'P0001'; end if;
select v into v_var from jsonb_array_elements(coalesce(s.extra -> 'variantes', '[]'::jsonb)) v where v ->> 'id' = p_curso;
if jsonb_array_length(coalesce(s.extra -> 'variantes', '[]'::jsonb)) > 0 and v_var is null then
raise exception 'ELEGI_UNA_OPCION' using errcode = 'P0001';
end if;
perform pg_advisory_xact_lock(hashtext('crear_inscripcion'));
-- Anti-spam: máx. 3 pendientes por teléfono o email en 24 h y 30 por cada 10 minutos en total.
if (select count(*) from public.inscripciones i
where i.origen = 'web' and i.estado in ('pendiente', 'borrador') and i.creado > now() - interval '1 day'
and (right(regexp_replace(i.cliente_telefono, '\D', '', 'g'), 9) = right(v_dig, 9) or i.cliente_email = v_email)) >= 3
or (select count(*) from public.inscripciones i where i.origen = 'web' and i.creado > now() - interval '10 minutes') >= 30 then
raise exception 'DEMASIADAS_SOLICITUDES' using errcode = 'P0001';
end if;
v_curso := coalesce(v_var ->> 'nombreReserva', s.extra ->> 'nombreReserva', s.nombre);
v_precio := nullif(btrim(coalesce(case when v_var is not null then v_var ->> 'precio' else s.precio_texto end, '')), '');
v_curso_gs := replace((regexp_match(coalesce(v_precio, ''), '(\d{1,3}(?:\.\d{3})+|\d+)'))[1], '.', '')::bigint;
v_mat := public._matricula_de(s, v_var);
v_ref_precio := left(concat_ws(' · ', 'Curso: ' || v_precio, coalesce('Matrícula: ' || public._gs(v_mat), 'Sin matrícula')), 300);
v_borrador := coalesce(p_borrador, false) and coalesce(v_mat, 0) > 0;
insert into public.inscripciones (servicio_id, variante_id, curso_nombre, precio_ref, monto_gs,
cliente_nombre, cliente_telefono, cliente_email, notas, origen, estado)
values (s.id, case when v_var is not null then p_curso end, v_curso, v_ref_precio, coalesce(v_mat, 0),
v_nombre, v_tel, v_email, v_notas, 'web', case when v_borrador then 'borrador' else 'pendiente' end)
returning id, referencia into v_id, v_ref;
-- Reserva espejo: dispara el aviso push ya instalado (trigger avisar_reserva → Edge Function).
if not v_borrador then
insert into public.reservas (servicio_id, variante_id, servicio_nombre, precio_ref, bloquea, cliente_nombre,
cliente_telefono, cliente_email, notas, pago, estado, origen, inscripcion_id)
values (s.id, case when v_var is not null then p_curso end, 'Inscripción: ' || v_curso, v_ref_precio, false, v_nombre,
v_tel, v_email, 'Ref. ' || v_ref || coalesce(' · matrícula ' || public._gs(v_mat), ' · sin matrícula (confirmar)')
|| coalesce(' · ' || v_notas, ''), 'total', 'pendiente', 'web', v_id);
end if;
select * into p from public.ajustes_privados where id = 1;
return jsonb_build_object(
'ok', true, 'id', v_id, 'referencia', v_ref, 'curso', v_curso, 'precio', v_precio,
'monto_gs', coalesce(v_mat, 0), 'matricula_gs', v_mat, 'curso_gs', v_curso_gs,
'borrador', v_borrador, 'mensual', coalesce(v_precio, '') ~* '(mensual|/\s*mes|por mes)', 'sin_matricula', v_mat is null,
-- Los datos de pago se entregan recién después de inscribirse, y solo si hay matrícula que pagar.
'datos_pago', case when v_mat is not null then coalesce(p.datos_pago, '') end,
'qr_pago', case when v_mat is not null then p.qr_pago end);
end $function$
;

revoke all on function public._crear_inscripcion(text,text,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public._crear_inscripcion(text,text,text,text,text,boolean) to service_role;

CREATE OR REPLACE FUNCTION public.crear_inscripcion(p_curso text, p_nombre text, p_telefono text, p_email text, p_notas text DEFAULT NULL::text, p_horario text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare s public.servicios; hs text[]; partes text[]; elegidos text[] := '{}'; p text; v_h text; r jsonb; n int;
begin
s := public._servicio_de(p_curso);
perform public._limpiar_borradores();
if s.id is not null and s.categoria = 'academia' then
perform pg_advisory_xact_lock(hashtext('crear_inscripcion'));
-- si la misma persona vuelve a tocar "Inscribirme", se reemplaza su borrador anterior
delete from public.inscripciones where estado = 'borrador' and servicio_id = s.id and cliente_email = lower(btrim(coalesce(p_email, '')));
hs := public._horarios_de(s); n := public._clases_de(s);
partes := public._partes_horario(p_horario);
if array_length(partes, 1) is not null then
if array_length(hs, 1) is null then return jsonb_build_object('ok', false, 'error', 'HORARIO_INVALIDO'); end if;
foreach p in array partes loop
select h into v_h from unnest(hs) h where public._norm_horario(h) = public._norm_horario(p) limit 1;
if v_h is null then return jsonb_build_object('ok', false, 'error', 'HORARIO_INVALIDO'); end if;
if exists (select 1 from unnest(elegidos) e where split_part(public._norm_horario(e), '|', 1) = split_part(public._norm_horario(v_h), '|', 1)) then
return jsonb_build_object('ok', false, 'error', 'DIAS_REPETIDOS'); end if;
if public._ocupados(s.id, v_h) >= public._cupo_de(s) then return jsonb_build_object('ok', false, 'error', 'HORARIO_COMPLETO'); end if;
elegidos := elegidos || v_h;
end loop;
if array_length(elegidos, 1) <> n then return jsonb_build_object('ok', false, 'error', 'ELEGI_N_DIAS', 'clases_semana', n); end if;
-- orden de la semana (el de la lista del curso)
v_h := array_to_string(array(select h from unnest(hs) with ordinality t(h, o) where h = any(elegidos) order by o), '; ');
elsif array_length(hs, 1) is null then
if public._ocupados(s.id, null) >= public._cupo_de(s) then return jsonb_build_object('ok', false, 'error', 'CURSO_COMPLETO'); end if;
elsif not exists (select 1 from unnest(hs) h where public._ocupados(s.id, h) < public._cupo_de(s)) then
return jsonb_build_object('ok', false, 'error', 'CURSO_COMPLETO');
end if;
end if;
r := public._crear_inscripcion(p_curso, p_nombre, p_telefono, p_email, p_notas, true);
if v_h is not null and (r ->> 'ok')::boolean then
update public.inscripciones set horario = v_h where id = (r ->> 'id')::uuid;
r := r || jsonb_build_object('horario', v_h);
end if;
return r;
exception when sqlstate 'P0001' then
return jsonb_build_object('ok', false, 'error', sqlerrm);
end $function$
;

drop function if exists public.crear_reserva(text,text,text,timestamptz,date,text,text,text,text,integer);

drop function if exists public._crear_reserva(text,text,text,timestamptz,date,text,text,text,text,integer);

CREATE OR REPLACE FUNCTION public._crear_reserva(p_servicio text, p_nombre text, p_telefono text, p_inicio timestamp with time zone DEFAULT NULL::timestamp with time zone, p_fecha_preferida date DEFAULT NULL::date, p_hora_preferida text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_notas text DEFAULT NULL::text, p_pago text DEFAULT 'sena'::text, p_personas integer DEFAULT NULL::integer, p_borrador boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
s public.servicios;
v_var jsonb;
v_nombre text := btrim(coalesce(p_nombre, ''));
v_tel text := btrim(coalesce(p_telefono, ''));
v_dig text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
v_notas text := nullif(btrim(coalesce(p_notas, '')), '');
v_servicio_nombre text;
v_precio text;
v_sena text;
v_extra boolean := false;
v_bloquea boolean := false;
v_fin timestamptz;
v_id uuid;
v_zona text := public._zona();
begin
if length(v_nombre) < 3 or length(v_nombre) > 120 then raise exception 'NOMBRE_INVALIDO' using errcode = 'P0001'; end if;
if length(v_dig) < 8 or length(v_dig) > 15 then raise exception 'TELEFONO_INVALIDO' using errcode = 'P0001'; end if;
if v_email is not null and (length(v_email) > 160 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'EMAIL_INVALIDO' using errcode = 'P0001'; end if;
if v_notas is not null and length(v_notas) > 1000 then raise exception 'NOTAS_DEMASIADO_LARGAS' using errcode = 'P0001'; end if;
if p_pago not in ('sena', 'total') then raise exception 'PAGO_INVALIDO' using errcode = 'P0001'; end if;
if p_personas is not null and (p_personas < 1 or p_personas > 500) then raise exception 'PERSONAS_INVALIDO' using errcode = 'P0001'; end if;
if p_hora_preferida is not null and length(p_hora_preferida) > 20 then raise exception 'HORA_INVALIDA' using errcode = 'P0001'; end if;
-- Serializa las altas para que dos personas no tomen el mismo horario a la vez.
perform public._limpiar_borradores();
perform pg_advisory_xact_lock(hashtext('crear_reserva'));
-- Límites anti-spam: máx. 3 solicitudes pendientes por teléfono en 24 h y 30 por cada 10 minutos en total.
if (select count(*) from public.reservas r
where r.origen = 'web' and r.estado in ('pendiente', 'borrador') and r.creado > now() - interval '1 day'
and right(regexp_replace(r.cliente_telefono, '\D', '', 'g'), 9) = right(v_dig, 9)) >= 3 then
raise exception 'DEMASIADAS_SOLICITUDES' using errcode = 'P0001';
end if;
if (select count(*) from public.reservas r where r.origen = 'web' and r.creado > now() - interval '10 minutes') >= 30 then
raise exception 'DEMASIADAS_SOLICITUDES' using errcode = 'P0001';
end if;
if p_servicio = 'consulta' then
v_servicio_nombre := 'Consulta general';
else
s := public._servicio_de(p_servicio);
if s.id is null or not s.activo then raise exception 'SERVICIO_NO_DISPONIBLE' using errcode = 'P0001'; end if;
select v into v_var from jsonb_array_elements(coalesce(s.extra -> 'variantes', '[]'::jsonb)) v where v ->> 'id' = p_servicio;
v_servicio_nombre := coalesce(v_var ->> 'nombreReserva', s.extra ->> 'nombreReserva', s.nombre);
v_precio := coalesce(v_var ->> 'precioReserva', v_var ->> 'precio', s.precio_reserva_texto, s.precio_texto);
v_sena := case
when v_var is not null then nullif(v_var ->> 'sena', '')
when s.sena_gs is not null then 'Gs. ' || replace(to_char(s.sena_gs, 'FM999G999G999'), ',', '.')
end;
end if;
if p_inicio is not null and p_inicio < now() then raise exception 'FECHA_PASADA' using errcode = 'P0001'; end if;
if s.id is not null and s.usa_turno and p_inicio is not null then
select h.costo_extra into v_extra
from public.horarios_libres((p_inicio at time zone v_zona)::date, p_servicio) h
where h.inicio = p_inicio;
if not found then raise exception 'HORARIO_NO_DISPONIBLE' using errcode = 'P0001'; end if;
v_bloquea := true;
v_fin := p_inicio + make_interval(mins => s.duracion_min);
else
-- Eventos, cursos u "horario a coordinar": no ocupa agenda hasta que Tania la confirme.
if p_inicio is not null then
v_fin := p_inicio + make_interval(mins => coalesce(s.duracion_min, 60));
v_extra := public._fuera_de_horario(p_inicio, v_fin);
elsif p_fecha_preferida is not null then
v_extra := extract(dow from p_fecha_preferida) = 0;
end if;
end if;
begin
insert into public.reservas (servicio_id, variante_id, servicio_nombre, precio_ref, sena_ref, inicio, fin,
fecha_preferida, hora_preferida, bloquea, costo_extra, cliente_nombre, cliente_telefono,
cliente_email, personas, notas, pago, estado, origen)
values (s.id, case when v_var is not null then p_servicio end, v_servicio_nombre, v_precio, v_sena, p_inicio, v_fin,
coalesce(p_fecha_preferida, (p_inicio at time zone v_zona)::date), p_hora_preferida, v_bloquea, coalesce(v_extra, false),
v_nombre, v_tel, v_email, p_personas, v_notas, p_pago, case when coalesce(p_borrador, false) then 'borrador' else 'pendiente' end, 'web')
returning id into v_id;
exception when exclusion_violation then
raise exception 'HORARIO_NO_DISPONIBLE' using errcode = 'P0001';
end;
return jsonb_build_object('ok', true, 'id', v_id, 'estado', case when coalesce(p_borrador, false) then 'borrador' else 'pendiente' end, 'costo_extra', coalesce(v_extra, false));
end $function$
;

revoke all on function public._crear_reserva(text,text,text,timestamptz,date,text,text,text,text,integer,boolean) from public, anon, authenticated;
grant execute on function public._crear_reserva(text,text,text,timestamptz,date,text,text,text,text,integer,boolean) to service_role;

CREATE OR REPLACE FUNCTION public.crear_reserva(p_servicio text, p_nombre text, p_telefono text, p_inicio timestamp with time zone DEFAULT NULL::timestamp with time zone, p_fecha_preferida date DEFAULT NULL::date, p_hora_preferida text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_notas text DEFAULT NULL::text, p_pago text DEFAULT 'sena'::text, p_personas integer DEFAULT NULL::integer, p_borrador boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
begin
return public._crear_reserva(p_servicio, p_nombre, p_telefono, p_inicio, p_fecha_preferida, p_hora_preferida,
p_email, p_notas, p_pago, p_personas, p_borrador);
exception when sqlstate 'P0001' then
return jsonb_build_object('ok', false, 'error', sqlerrm);
end $function$
;

revoke all on function public.crear_reserva(text,text,text,timestamptz,date,text,text,text,text,integer,boolean) from public;
grant execute on function public.crear_reserva(text,text,text,timestamptz,date,text,text,text,text,integer,boolean) to anon, authenticated, service_role;


create or replace function public._completar_inscripcion(p_id uuid) returns boolean
language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare i public.inscripciones;
begin
  update public.inscripciones set estado = 'pendiente', completada_en = now() where id = p_id and estado = 'borrador' returning * into i;
  if i.id is null then return false; end if;
  -- Reserva espejo: dispara el aviso push (trigger avisar_reserva → Edge Function), igual que antes pero recién ahora.
  perform set_config('tania.interno', '1', true);
  insert into public.reservas (servicio_id, variante_id, servicio_nombre, precio_ref, bloquea, cliente_nombre,
    cliente_telefono, cliente_email, notas, pago, estado, origen, inscripcion_id)
  values (i.servicio_id, i.variante_id, 'Inscripción: ' || i.curso_nombre, i.precio_ref, false, i.cliente_nombre,
    i.cliente_telefono, i.cliente_email, 'Ref. ' || i.referencia || case when coalesce(i.monto_gs, 0) > 0 then ' · matrícula ' || public._gs(i.monto_gs) else ' · sin matrícula (confirmar)' end
    || coalesce(' · ' || i.notas, ''), 'total', 'pendiente', 'web', i.id);
  perform set_config('tania.interno', '', true);
  return true;
end $f$;

create or replace function public._completar_reserva(p_id uuid) returns boolean
language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare r public.reservas; v_usa boolean;
begin
  select * into r from public.reservas where id = p_id and estado = 'borrador' for update;
  if r.id is null then return false; end if;
  select usa_turno into v_usa from public.servicios where id = r.servicio_id;
  begin
    -- creado = ahora: el aviso push (Edge Function) solo avisa de solicitudes de los últimos 15 minutos
    update public.reservas set estado = 'pendiente', completada_en = now(), creado = now(),
      bloquea = (coalesce(v_usa, false) and inicio is not null and fin is not null) where id = p_id;
  exception when exclusion_violation then
    raise exception 'HORARIO_NO_DISPONIBLE' using errcode = 'P0001';
  end;
  return true;
end $f$;
revoke all on function public._completar_inscripcion(uuid) from public, anon, authenticated;
revoke all on function public._completar_reserva(uuid) from public, anon, authenticated;
grant execute on function public._completar_inscripcion(uuid), public._completar_reserva(uuid) to service_role;

create or replace function public.completar_solicitud(p_tipo text, p_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare ok boolean; ya boolean;
begin
  if p_tipo not in ('r', 'i') then return jsonb_build_object('ok', false, 'error', 'TIPO_INVALIDO'); end if;
  perform public._limpiar_borradores();
  if p_tipo = 'i' then
    ok := public._completar_inscripcion(p_id);
    ya := not ok and exists (select 1 from public.inscripciones where id = p_id and estado <> 'cancelada');
  else
    ok := public._completar_reserva(p_id);
    ya := not ok and exists (select 1 from public.reservas where id = p_id and estado not in ('cancelada', 'rechazada'));
  end if;
  if not ok and not ya then return jsonb_build_object('ok', false, 'error', 'NO_ENCONTRADA'); end if;
  return jsonb_build_object('ok', true, 'estado', 'pendiente', 'recien', ok);
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $f$;
revoke all on function public.completar_solicitud(text, uuid) from public;
grant execute on function public.completar_solicitud(text, uuid) to anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION public.registrar_comprobante(p_tipo text, p_id uuid, p_ruta text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
begin
if p_tipo not in ('r', 'i') or p_ruta is null or p_ruta not like p_tipo || '/' || p_id::text || '/%' then
return jsonb_build_object('ok', false, 'error', 'RUTA_INVALIDA'); end if;
if not exists (select 1 from storage.objects o where o.bucket_id = 'comprobantes' and o.name = p_ruta) then
return jsonb_build_object('ok', false, 'error', 'ARCHIVO_NO_ENCONTRADO'); end if;
if not public._comprobante_destino_ok(p_tipo, p_id) then return jsonb_build_object('ok', false, 'error', 'NO_ENCONTRADA'); end if;
if p_tipo = 'r' then
update public.reservas set comprobante_ruta = p_ruta, comprobante_estado = 'enviado', comprobante_en = now(), actualizado = now() where id = p_id;
begin perform public._completar_reserva(p_id);
exception when sqlstate 'P0001' then return jsonb_build_object('ok', false, 'error', sqlerrm); end;
else
update public.inscripciones set comprobante_ruta = p_ruta, comprobante_estado = 'enviado', comprobante_en = now(), actualizado = now() where id = p_id;
perform public._completar_inscripcion(p_id);
end if;
return jsonb_build_object('ok', true, 'estado', 'enviado');
end $function$
;

CREATE OR REPLACE FUNCTION public._comprobante_destino_ok(p_tipo text, p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
select case p_tipo
when 'r' then exists (select 1 from public.reservas r where r.id = p_id and r.estado not in ('rechazada', 'cancelada')
and r.creado > now() - interval '30 days' and (r.estado <> 'borrador' or r.creado > now() - interval '48 hours') and coalesce(r.comprobante_estado, '') <> 'verificado')
when 'i' then exists (select 1 from public.inscripciones i where i.id = p_id and i.estado <> 'cancelada'
and i.creado > now() - interval '30 days' and (i.estado <> 'borrador' or i.creado > now() - interval '48 hours') and coalesce(i.comprobante_estado, '') <> 'verificado')
else false end;
$function$
;

CREATE OR REPLACE FUNCTION public.datos_pago_reserva(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare r public.reservas; p public.ajustes_privados; v_txt text; v_monto bigint;
begin
select * into r from public.reservas where id = p_id and estado not in ('rechazada', 'cancelada') and creado > now() - interval '30 days' and (estado <> 'borrador' or creado > now() - interval '48 hours');
if r.id is null then return jsonb_build_object('ok', false, 'error', 'NO_ENCONTRADA'); end if;
select * into p from public.ajustes_privados where id = 1;
-- Monto: la seña si hay y eligió seña; si no, el precio. Se toma el primer número "Gs. 250.000" del texto.
v_txt := case when r.pago = 'sena' and nullif(r.sena_ref, '') is not null then r.sena_ref else r.precio_ref end;
v_monto := nullif(regexp_replace(coalesce(substring(coalesce(v_txt, '') from '(\d{1,3}(?:\.\d{3})+|\d{4,})'), ''), '\D', '', 'g'), '')::bigint;
return jsonb_build_object('ok', true, 'id', r.id, 'datos_pago', coalesce(p.datos_pago, ''),
'es_sena', r.pago = 'sena' and nullif(r.sena_ref, '') is not null, 'monto_texto', v_txt, 'monto_gs', v_monto,
'servicio', r.servicio_nombre, 'comprobante_estado', r.comprobante_estado);
end $function$
;

CREATE OR REPLACE FUNCTION public.datos_pago_inscripcion(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare i public.inscripciones; p public.ajustes_privados;
begin
select * into i from public.inscripciones where id = p_id and estado <> 'cancelada' and creado > now() - interval '30 days' and (estado <> 'borrador' or creado > now() - interval '48 hours');
if i.id is null then return jsonb_build_object('ok', false, 'error', 'NO_ENCONTRADA'); end if;
select * into p from public.ajustes_privados where id = 1;
return jsonb_build_object('ok', true, 'id', i.id, 'referencia', i.referencia, 'curso', i.curso_nombre, 'monto_gs', i.monto_gs,
'datos_pago', case when coalesce(i.monto_gs, 0) > 0 then coalesce(p.datos_pago, '') else '' end, 'comprobante_estado', i.comprobante_estado);
end $function$
;


drop trigger if exists avisar_reserva_completa on public.reservas;
create trigger avisar_reserva_completa after update on public.reservas
  for each row when (old.estado = 'borrador' and new.estado = 'pendiente') execute function public._avisar_reserva();



create or replace function public.admin_incompletas() returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $f$
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  perform public._limpiar_borradores();
  return coalesce((select jsonb_agg(x order by (x ->> 'creado') desc) from (
    select jsonb_build_object('tipo', 'i', 'id', i.id, 'nombre', i.cliente_nombre, 'telefono', i.cliente_telefono, 'email', i.cliente_email,
      'detalle', 'Curso: ' || i.curso_nombre || coalesce(' · ' || i.horario, ''), 'referencia', i.referencia, 'creado', i.creado,
      'expira', i.creado + interval '48 hours') x
      from public.inscripciones i where i.estado = 'borrador'
    union all
    select jsonb_build_object('tipo', 'r', 'id', r.id, 'nombre', r.cliente_nombre, 'telefono', r.cliente_telefono, 'email', r.cliente_email,
      'detalle', r.servicio_nombre || coalesce(' · ' || to_char(r.inicio at time zone public._zona(), 'DD/MM HH24:MI'), coalesce(' · ' || r.fecha_preferida::text, '')),
      'referencia', null, 'creado', r.creado, 'expira', r.creado + interval '48 hours')
      from public.reservas r where r.estado = 'borrador'
  ) q), '[]'::jsonb);
end $f$;
create or replace function public.admin_descartar_incompleta(p_tipo text, p_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare n int;
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  if p_tipo = 'i' then delete from public.inscripciones where id = p_id and estado = 'borrador';
  elsif p_tipo = 'r' then delete from public.reservas where id = p_id and estado = 'borrador';
  else raise exception 'TIPO_INVALIDO' using errcode = '22023'; end if;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'borradas', n);
end $f$;
revoke all on function public.admin_incompletas() from public, anon;
revoke all on function public.admin_descartar_incompleta(text, uuid) from public, anon;
grant execute on function public.admin_incompletas(), public.admin_descartar_incompleta(text, uuid) to authenticated, service_role;


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
where i.estado not in ('cancelada', 'borrador')
order by i.acceso, i.creado desc limit 1000;
end $function$
;

CREATE OR REPLACE FUNCTION public.aula_mis_inscripciones()
RETURNS TABLE(id uuid, referencia text, servicio_id text, variante_id text, curso_nombre text, precio_ref text, monto_gs bigint, estado text, acceso boolean, creado timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
select i.id, i.referencia, i.servicio_id, i.variante_id, i.curso_nombre, i.precio_ref, i.monto_gs, i.estado, i.acceso, i.creado
from public.inscripciones i
where auth.uid() is not null and i.cliente_email = lower(coalesce(auth.jwt() ->> 'email', '')) and i.estado not in ('cancelada', 'borrador')
order by i.creado desc;
$function$
;


create or replace function public._semana_abre(p_curso text, p_variante text, p_semana integer) returns date
language sql stable security definer set search_path to 'public','pg_temp' as $f$
  select min((coalesce(i.acceso_desde, i.creado) at time zone 'America/Asuncion')::date + 7 * (greatest(coalesce(p_semana, 1), 1) - 1)
    + coalesce(i.pausa_dias, 0) + case when i.suspendida_desde is not null then greatest(0, public._hoy_py() - i.suspendida_desde) else 0 end)
  from public.alumnos a join public.inscripciones i on i.cliente_email = a.email
  where auth.uid() is not null and a.user_id = auth.uid() and a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
    and i.servicio_id = p_curso and i.acceso and i.estado not in ('cancelada', 'borrador')
    and (p_variante is null or i.variante_id = p_variante);
$f$;
-- Una semana está abierta si su fecha (corrida por los días de pausa ya cumplidos) llegó; en pausa el reloj queda congelado.
create or replace function public._semana_abierta(p_curso text, p_variante text, p_semana integer) returns boolean
language sql stable security definer set search_path to 'public','pg_temp' as $f$
  select public.es_admin() or p_semana is null or exists (
    select 1 from public.alumnos a join public.inscripciones i on i.cliente_email = a.email
    where auth.uid() is not null and a.user_id = auth.uid() and a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and i.servicio_id = p_curso and i.acceso and i.estado not in ('cancelada', 'borrador')
      and (p_variante is null or i.variante_id = p_variante)
      and (coalesce(i.acceso_desde, i.creado) at time zone 'America/Asuncion')::date + 7 * (greatest(p_semana, 1) - 1) + coalesce(i.pausa_dias, 0)
          <= coalesce(i.suspendida_desde, public._hoy_py()));
$f$;

create or replace function public._aula_pausada(p_curso text) returns boolean
language sql stable security definer set search_path to 'public','pg_temp' as $f$
  select exists (select 1 from public.alumnos a join public.inscripciones i on i.cliente_email = a.email
    where auth.uid() is not null and a.user_id = auth.uid() and a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and i.servicio_id = p_curso and i.acceso and i.estado not in ('cancelada', 'borrador') and i.suspendida_desde is not null)
  and not exists (select 1 from public.alumnos a join public.inscripciones i on i.cliente_email = a.email
    where auth.uid() is not null and a.user_id = auth.uid() and a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and i.servicio_id = p_curso and i.acceso and i.estado not in ('cancelada', 'borrador') and i.suspendida_desde is null);
$f$;
revoke all on function public._aula_pausada(text) from public, anon;
grant execute on function public._aula_pausada(text) to authenticated, service_role;

create or replace function public.admin_suspender_inscripcion(p_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare i public.inscripciones;
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  select * into i from public.inscripciones where id = p_id for update;
  if i.id is null or i.estado in ('cancelada', 'borrador') then raise exception 'INSCRIPCION_NO_EXISTE' using errcode = 'P0001'; end if;
  if i.suspendida_desde is null then
    update public.inscripciones set suspendida_desde = public._hoy_py() where id = p_id returning * into i;
  end if;
  return jsonb_build_object('ok', true, 'suspendida_desde', i.suspendida_desde, 'pausa_dias', i.pausa_dias);
end $f$;
create or replace function public.admin_reanudar_inscripcion(p_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare i public.inscripciones;
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  select * into i from public.inscripciones where id = p_id for update;
  if i.id is null or i.estado in ('cancelada', 'borrador') then raise exception 'INSCRIPCION_NO_EXISTE' using errcode = 'P0001'; end if;
  if i.suspendida_desde is not null then
    update public.inscripciones set pausa_dias = coalesce(pausa_dias, 0) + greatest(0, public._hoy_py() - suspendida_desde), suspendida_desde = null
      where id = p_id returning * into i;
  end if;
  return jsonb_build_object('ok', true, 'suspendida_desde', i.suspendida_desde, 'pausa_dias', i.pausa_dias);
end $f$;
revoke all on function public.admin_suspender_inscripcion(uuid), public.admin_reanudar_inscripcion(uuid) from public, anon;
grant execute on function public.admin_suspender_inscripcion(uuid), public.admin_reanudar_inscripcion(uuid) to authenticated, service_role;


CREATE OR REPLACE FUNCTION public.aula_pedir_examen(p_curso text, p_preferencia text DEFAULT ''::text)
RETURNS aula_examenes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare i public.inscripciones := public._aula_mi_insc(p_curso); r public.aula_examenes; n int; cfg public.aula_config_curso := public._aula_cfg(p_curso);
begin
if i.id is null then raise exception 'SIN_ACCESO_AL_CURSO' using errcode = '42501'; end if;
if i.suspendida_desde is not null then raise exception 'CURSADA_EN_PAUSA' using errcode = 'P0001'; end if;
if not public._aula_mes_completo(i.id, i.meses_habilitados) then raise exception 'FALTAN_CLASES_APROBADAS' using errcode = 'P0001'; end if;
if exists (select 1 from public.aula_examenes x where x.user_id = auth.uid() and x.servicio_id = p_curso and x.mes = i.meses_habilitados and x.estado = 'aprobado') then
raise exception 'EXAMEN_YA_APROBADO' using errcode = 'P0001'; end if;
if exists (select 1 from public.aula_examenes x where x.user_id = auth.uid() and x.servicio_id = p_curso and x.estado in ('solicitado', 'agendado', 'en_curso', 'entregado')) then
raise exception 'EXAMEN_YA_PEDIDO' using errcode = 'P0001'; end if;
select count(*) into n from public.aula_examenes x where x.user_id = auth.uid() and x.servicio_id = p_curso and x.mes = i.meses_habilitados and x.estado = 'desaprobado';
if n >= cfg.max_intentos then raise exception 'SIN_INTENTOS' using errcode = 'P0001'; end if;
insert into public.aula_examenes (user_id, servicio_id, mes, preferencia, intento)
values (auth.uid(), p_curso, i.meses_habilitados, left(btrim(coalesce(p_preferencia, '')), 300), n + 1) returning * into r;
return r;
end $function$
;

CREATE OR REPLACE FUNCTION public.aula_enviar_pago(p_inscripcion uuid, p_ruta text, p_nota text DEFAULT NULL::text)
RETURNS aula_pagos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare i public.inscripciones; r public.aula_pagos;
begin
select ins.* into i from public.inscripciones ins join public.alumnos a on a.email = ins.cliente_email
where ins.id = p_inscripcion and a.user_id = auth.uid() and a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
and ins.acceso and ins.estado <> 'cancelada';
if i.id is null then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
if i.suspendida_desde is not null then raise exception 'CURSADA_EN_PAUSA' using errcode = 'P0001'; end if;
if p_ruta is null or p_ruta !~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$') then raise exception 'COMPROBANTE_INVALIDO' using errcode = 'P0001'; end if;
if not exists (select 1 from storage.objects o where o.bucket_id = 'pagos-aula' and o.name = p_ruta) then raise exception 'COMPROBANTE_INVALIDO' using errcode = 'P0001'; end if;
if exists (select 1 from public.aula_pagos x where x.inscripcion_id = i.id and x.estado = 'pendiente') then raise exception 'PAGO_YA_ENVIADO' using errcode = 'P0001'; end if;
insert into public.aula_pagos (inscripcion_id, user_id, mes, ruta, monto_gs, nota)
values (i.id, auth.uid(), i.meses_habilitados + 1, p_ruta, nullif((public._monto_curso(i.precio_ref) ->> 'curso')::bigint, 0),
nullif(btrim(coalesce(p_nota, '')), ''))
returning * into r;
return r;
end $function$
;

CREATE OR REPLACE FUNCTION public._entrega_validar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare f text;
begin
if tg_op = 'INSERT' and not public.es_admin() then
new.user_id := auth.uid(); new.email := lower(coalesce(auth.jwt() ->> 'email', ''));
new.estado := 'enviada'; new.calificacion := null; new.comentario := null; new.corregida_en := null; new.creado := now();
if not public.tiene_acceso(new.servicio_id) then raise exception 'SIN_ACCESO_AL_CURSO' using errcode = '42501'; end if;
if public._aula_pausada(new.servicio_id) then raise exception 'CURSADA_EN_PAUSA' using errcode = 'P0001'; end if;
foreach f in array new.fotos loop
if f !~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}\.jpg$') then raise exception 'FOTO_INVALIDA' using errcode = 'P0001'; end if;
end loop;
-- anti-abuso: máx. 30 entregas por día
if (select count(*) from public.entregas e where e.user_id = auth.uid() and e.creado > now() - interval '1 day') >= 30 then
raise exception 'DEMASIADAS_ENTREGAS' using errcode = 'P0001'; end if;
end if;
new.actualizado := now();
return new;
end $function$
;

CREATE OR REPLACE FUNCTION public._app_inscripcion(it jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
d jsonb := coalesce(it -> 'd', '{}'::jsonb);
v_app text := public._txt(it, 'app_id', 64);
v_web uuid := case when coalesce(it ->> 'web_id', '') ~ '^[0-9a-f-]{36}$' then (it ->> 'web_id')::uuid end;
v_mod timestamptz := to_timestamp(coalesce(nullif(it ->> 'mod', '')::numeric, 0) / 1000.0);
i public.inscripciones; s public.servicios; v_var jsonb;
v_est_app text := coalesce(public._txt(d, 'estado', 20), 'activa');
v_est text; v_nombre text; v_tel text; v_email text; v_curso text; v_mat bigint; v_cuota bigint; v_existe boolean;
begin
if v_app is null and v_web is null then raise exception 'SIN_ID' using errcode = '22023'; end if;
perform set_config('tania.desde_app', '1', true);
if v_web is not null then select * into i from public.inscripciones where id = v_web for update; end if;
if i.id is null and v_app is not null then select * into i from public.inscripciones where app_id = v_app for update; end if;
v_existe := i.id is not null;
if coalesce((it ->> 'borrado')::boolean, false) then
if not v_existe then return jsonb_build_object('ok', true, 'resultado', 'no_existe'); end if;
if i.estado <> 'cancelada' then update public.inscripciones set estado = 'cancelada', app_estado = 'baja' where id = i.id returning * into i; end if;
return jsonb_build_object('ok', true, 'resultado', 'borrado', 'fila', to_jsonb(i));
end if;
if v_existe and i.web_mod is not null and i.web_mod > v_mod then
return jsonb_build_object('ok', true, 'resultado', 'conflicto', 'fila', to_jsonb(i));
end if;
v_est := case v_est_app when 'baja' then 'cancelada' when 'pendiente' then 'pendiente' else 'pagada' end;
v_nombre := coalesce(public._txt(d, 'nombre', 120), 'Sin nombre');
if length(v_nombre) < 2 then v_nombre := v_nombre || '.'; end if;
v_tel := public._txt(d, 'tel', 30); if v_tel is null or length(v_tel) < 6 then v_tel := 'sin teléfono'; end if;
v_email := lower(public._txt(d, 'email', 160));
if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_email := null; end if;
v_mat := public._big(d, 'matricula'); v_cuota := public._big(d, 'cuota');
if not v_existe then
s := public._servicio_de(public._txt(d, 'curso', 80));
if s.id is not null then
select v into v_var from jsonb_array_elements(coalesce(s.extra -> 'variantes', '[]'::jsonb)) v where v ->> 'id' = d ->> 'curso';
end if;
v_curso := coalesce(public._txt(d, 'curso_nombre', 200), v_var ->> 'nombreReserva', s.extra ->> 'nombreReserva', s.nombre, 'Curso');
if length(v_curso) < 2 then v_curso := 'Curso'; end if;
insert into public.inscripciones (servicio_id, variante_id, curso_nombre, precio_ref, monto_gs, cliente_nombre, cliente_telefono,
cliente_email, notas, estado, origen, app_id, app_estado, horario, fecha_inicio, cuota_gs, cuotas_total, cuotas_pagadas,
deuda_gs, proximo_venc, pagado_en, suspendida_desde, pausa_dias)
values (s.id, case when v_var is not null then d ->> 'curso' end, v_curso,
left(concat_ws(' · ', case when v_cuota is not null then 'Curso: ' || public._gs(v_cuota) || case when coalesce((d ->> 'mensual')::boolean, false) then ' / mes' else '' end end,
case when coalesce(v_mat, 0) > 0 then 'Matrícula: ' || public._gs(v_mat) else 'Sin matrícula' end), 300),
coalesce(v_mat, 0), v_nombre, v_tel, v_email, public._txt(d, 'notas', 1000), v_est, 'app', v_app, v_est_app,
public._txt(d, 'horario', 80), case when coalesce(d ->> 'inicio', '') ~ '^\d{4}-\d{2}-\d{2}$' then (d ->> 'inicio')::date end,
v_cuota, nullif(d ->> 'cuotas_total', '')::numeric::int, nullif(d ->> 'cuotas_pagadas', '')::numeric::int, public._big(d, 'deuda'),
case when coalesce(d ->> 'proximo_venc', '') ~ '^\d{4}-\d{2}-\d{2}$' then (d ->> 'proximo_venc')::date end,
case when coalesce((d ->> 'mat_pagada')::boolean, false) and v_est = 'pagada' then now() end,
case when coalesce(d ->> 'susp', '') ~ '^\d{4}-\d{2}-\d{2}$' then (d ->> 'susp')::date end,
greatest(0, coalesce(nullif(d ->> 'pausaDias', '')::numeric::int, 0)))
returning * into i;
return jsonb_build_object('ok', true, 'resultado', 'creada', 'fila', to_jsonb(i));
end if;
update public.inscripciones set
estado = v_est, app_estado = v_est_app,
cliente_nombre = v_nombre,
cliente_telefono = case when v_tel = 'sin teléfono' then cliente_telefono else v_tel end,
cliente_email = coalesce(v_email, cliente_email),
horario = public._txt(d, 'horario', 80),
fecha_inicio = coalesce(case when coalesce(d ->> 'inicio', '') ~ '^\d{4}-\d{2}-\d{2}$' then (d ->> 'inicio')::date end, fecha_inicio),
cuota_gs = coalesce(v_cuota, cuota_gs),
monto_gs = case when origen = 'app' then coalesce(v_mat, monto_gs) else monto_gs end,
cuotas_total = nullif(d ->> 'cuotas_total', '')::numeric::int,
cuotas_pagadas = nullif(d ->> 'cuotas_pagadas', '')::numeric::int,
deuda_gs = public._big(d, 'deuda'),
proximo_venc = case when coalesce(d ->> 'proximo_venc', '') ~ '^\d{4}-\d{2}-\d{2}$' then (d ->> 'proximo_venc')::date end,
notas = case when origen = 'app' then public._txt(d, 'notas', 1000) else notas end,
app_id = coalesce(app_id, v_app),
suspendida_desde = case when coalesce(d ->> 'susp', '') ~ '^\d{4}-\d{2}-\d{2}$' then (d ->> 'susp')::date else null end,
pausa_dias = greatest(0, coalesce(nullif(d ->> 'pausaDias', '')::numeric::int, pausa_dias))
where id = i.id returning * into i;
return jsonb_build_object('ok', true, 'resultado', 'actualizada', 'fila', to_jsonb(i));
end $function$
;


create or replace function public._alumna_activa(p_user uuid, p_curso text) returns boolean
language sql stable security definer set search_path to 'public','pg_temp' as $f$
  select exists (select 1 from public.alumnos a join public.inscripciones i on i.cliente_email = a.email
    where a.user_id = p_user and i.servicio_id = p_curso and i.estado not in ('cancelada', 'borrador'));
$f$;
revoke all on function public._alumna_activa(uuid, text) from public, anon;
grant execute on function public._alumna_activa(uuid, text) to authenticated, service_role;

-- Borra lo que una alumna dejó en el aula de un curso (pedidos de examen, códigos, trabajos, cuestionarios, pagos y certificados),
-- salvo que todavía tenga otra inscripción vigente a ese mismo curso. Devuelve cuántas filas borró.
create or replace function public._limpiar_alumna(p_email text, p_servicio text) returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare u uuid; ex int := 0; en int := 0; qz int := 0; pg int := 0; ce int := 0;
begin
  if p_servicio is null or p_email is null then return '{}'::jsonb; end if;
  if exists (select 1 from public.inscripciones i where i.cliente_email = p_email and i.servicio_id = p_servicio and i.estado not in ('cancelada', 'borrador')) then
    return jsonb_build_object('omitido', true);
  end if;
  select user_id into u from public.alumnos where email = p_email;
  if u is not null then
    delete from public.aula_examenes where user_id = u and servicio_id = p_servicio; get diagnostics ex = row_count;
    delete from public.entregas where user_id = u and servicio_id = p_servicio; get diagnostics en = row_count;
    delete from public.aula_quiz_resultados q where q.user_id = u and q.leccion_id in (select id from public.lecciones where servicio_id = p_servicio); get diagnostics qz = row_count;
  end if;
  delete from public.aula_pagos where inscripcion_id in (select id from public.inscripciones where cliente_email = p_email and servicio_id = p_servicio); get diagnostics pg = row_count;
  delete from public.aula_certificados where inscripcion_id in (select id from public.inscripciones where cliente_email = p_email and servicio_id = p_servicio); get diagnostics ce = row_count;
  return jsonb_build_object('examenes', ex, 'entregas', en, 'cuestionarios', qz, 'pagos', pg, 'certificados', ce);
end $f$;
revoke all on function public._limpiar_alumna(text, text) from public, anon, authenticated;
grant execute on function public._limpiar_alumna(text, text) to service_role;

create or replace function public._inscripcion_baja() returns trigger
language plpgsql security definer set search_path to 'public','pg_temp' as $f$
begin
  if tg_op = 'DELETE' then perform public._limpiar_alumna(old.cliente_email, old.servicio_id); return old; end if;
  perform public._limpiar_alumna(new.cliente_email, new.servicio_id);
  return new;
end $f$;
drop trigger if exists inscripciones_baja_cancelada on public.inscripciones;
create trigger inscripciones_baja_cancelada after update of estado on public.inscripciones
  for each row when (new.estado = 'cancelada' and old.estado is distinct from 'cancelada') execute function public._inscripcion_baja();
drop trigger if exists inscripciones_baja_borrada on public.inscripciones;
create trigger inscripciones_baja_borrada after delete on public.inscripciones
  for each row when (old.estado not in ('cancelada', 'borrador')) execute function public._inscripcion_baja();


CREATE OR REPLACE FUNCTION public.admin_examenes_aula2()
RETURNS TABLE(id uuid, servicio_id text, curso text, mes integer, intento integer, preferencia text, estado text, fecha timestamp with time zone, nota_profe text, fotos text[], video text, flags jsonb, rubrica jsonb, captura jsonb, creado timestamp with time zone, entregado_en timestamp with time zone, nombre text, telefono text, email text, codigo_vence timestamp with time zone)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
begin
if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
return query select x.id, x.servicio_id, s.nombre, x.mes, x.intento, x.preferencia, x.estado, x.fecha, x.nota_profe, x.fotos, x.video, x.flags, x.rubrica, x.captura,
x.creado, x.entregado_en, coalesce(pf.nombre, ''), coalesce(pf.telefono, ''), coalesce(pf.email, ''),
(select c.vence from public.aula_examen_codigos c where c.examen_id = x.id and not c.usado)
from public.aula_examenes x left join public.servicios s on s.id = x.servicio_id left join public.perfiles pf on pf.user_id = x.user_id
where x.estado <> 'cancelado' and public._alumna_activa(x.user_id, x.servicio_id)
order by (x.estado = 'entregado') desc, (x.estado in ('en_curso', 'solicitado', 'agendado')) desc, x.creado desc limit 300;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_examenes_aula()
RETURNS TABLE(id uuid, servicio_id text, curso text, mes integer, preferencia text, estado text, fecha timestamp with time zone, nota_profe text, creado timestamp with time zone, nombre text, telefono text, email text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
begin
if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
return query select x.id, x.servicio_id, s.nombre, x.mes, x.preferencia, x.estado, x.fecha, x.nota_profe, x.creado,
coalesce(pf.nombre, ''), coalesce(pf.telefono, ''), coalesce(pf.email, '')
from public.aula_examenes x left join public.servicios s on s.id = x.servicio_id left join public.perfiles pf on pf.user_id = x.user_id
where x.estado <> 'cancelado' and public._alumna_activa(x.user_id, x.servicio_id) order by (x.estado in ('solicitado', 'agendado')) desc, x.creado desc limit 300;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_entregas(p_curso text DEFAULT NULL::text, p_estado text DEFAULT NULL::text)
RETURNS TABLE(id uuid, user_id uuid, email text, nombre text, telefono text, servicio_id text, curso text, modulo text, titulo text, mensaje text, fotos text[], estado text, calificacion smallint, comentario text, corregida_en timestamp with time zone, creado timestamp with time zone)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
begin
if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
return query select e.id, e.user_id, e.email, coalesce(p.nombre, e.email), coalesce(p.telefono, ''), e.servicio_id, s.nombre, e.modulo, e.titulo,
e.mensaje, e.fotos, e.estado, e.calificacion, e.comentario, e.corregida_en, e.creado
from public.entregas e left join public.perfiles p on p.user_id = e.user_id left join public.servicios s on s.id = e.servicio_id
where public._alumna_activa(e.user_id, e.servicio_id) and (p_curso is null or e.servicio_id = p_curso) and (p_estado is null or e.estado = p_estado)
order by (e.estado = 'enviada') desc, e.creado desc limit 500;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_entregas2(p_curso text DEFAULT NULL::text, p_estado text DEFAULT NULL::text)
RETURNS TABLE(id uuid, user_id uuid, email text, nombre text, telefono text, servicio_id text, curso text, modulo text, titulo text, mensaje text, fotos text[], estado text, calificacion smallint, comentario text, corregida_en timestamp with time zone, creado timestamp with time zone, mes integer, captura jsonb, reemplaza_id uuid, anulada_motivo text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
begin
if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
return query select e.id, e.user_id, e.email, coalesce(p.nombre, e.email), coalesce(p.telefono, ''), e.servicio_id, s.nombre, e.modulo, e.titulo,
e.mensaje, e.fotos, e.estado, e.calificacion, e.comentario, e.corregida_en, e.creado, e.mes, e.captura, e.reemplaza_id, e.anulada_motivo
from public.entregas e left join public.perfiles p on p.user_id = e.user_id left join public.servicios s on s.id = e.servicio_id
where public._alumna_activa(e.user_id, e.servicio_id) and (p_curso is null or e.servicio_id = p_curso) and (p_estado is null or e.estado = p_estado)
order by (e.estado = 'enviada') desc, e.creado desc limit 500;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_entregas3(p_curso text DEFAULT NULL::text, p_estado text DEFAULT NULL::text)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
begin
if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
return query select to_jsonb(e) || jsonb_build_object('nombre', coalesce(p.nombre, e.email), 'telefono', coalesce(p.telefono, ''), 'curso', s.nombre, 'leccion', l.titulo)
from public.entregas e left join public.perfiles p on p.user_id = e.user_id left join public.servicios s on s.id = e.servicio_id
left join public.lecciones l on l.id = e.leccion_id
where public._alumna_activa(e.user_id, e.servicio_id) and (p_curso is null or e.servicio_id = p_curso) and (p_estado is null or e.estado = p_estado)
order by (e.estado = 'enviada') desc, e.creado desc limit 500;
end $function$
;


create or replace function public.aula_mis_cuotas() returns jsonb
language plpgsql stable security definer set search_path to 'public','pg_temp' as $f$
declare i public.inscripciones; doc jsonb; res jsonb := '[]'::jsonb; hoy date := public._hoy_py();
  cuotas jsonb; k int; corr int; v date; base date; m date;
begin
  if auth.uid() is null then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  for i in
    select ins.* from public.alumnos a join public.inscripciones ins on ins.cliente_email = a.email
    where a.user_id = auth.uid() and a.email = lower(coalesce(auth.jwt() ->> 'email', '')) and ins.acceso and ins.estado not in ('cancelada', 'borrador')
    order by ins.creado
  loop
    select d.data into doc from public.app_docs d where d.tipo = 'i' and not d.borrado and (d.web_id = i.id or (i.app_id is not null and d.uuid = i.app_id))
      order by d.rev desc limit 1;
    cuotas := '[]'::jsonb;
    if doc is not null and jsonb_typeof(doc -> 'cuotas') = 'array' and jsonb_array_length(doc -> 'cuotas') > 0 then
      cuotas := doc -> 'cuotas';
    elsif coalesce(i.cuotas_total, 0) > 0 and i.cuota_gs is not null then
      base := coalesce(i.fecha_inicio, (i.creado at time zone 'America/Asuncion')::date);
      for k in 0 .. i.cuotas_total - 1 loop
        m := (date_trunc('month', base) + make_interval(months => k))::date;
        v := least(make_date(extract(year from m)::int, extract(month from m)::int, 1) + (extract(day from base)::int - 1),
                   (date_trunc('month', m) + interval '1 month - 1 day')::date);
        cuotas := cuotas || jsonb_build_array(jsonb_build_object('mes', to_char(m, 'YYYY-MM'), 'venc', v, 'monto', i.cuota_gs, 'pagado', k < coalesce(i.cuotas_pagadas, 0)));
      end loop;
    end if;
    -- días de pausa que la agenda todavía no corrió en las fechas de las cuotas
    corr := greatest(0, coalesce(i.pausa_dias, 0) - coalesce(nullif(doc ->> 'pausaDias', '')::numeric::int, 0));
    res := res || jsonb_build_array(jsonb_build_object(
      'inscripcion_id', i.id, 'servicio_id', i.servicio_id, 'curso', i.curso_nombre, 'referencia', i.referencia,
      'pausada', i.suspendida_desde is not null, 'suspendida_desde', i.suspendida_desde, 'pausa_dias', coalesce(i.pausa_dias, 0), 'hoy', hoy,
      'matricula', case when coalesce(i.monto_gs, 0) > 0 then jsonb_build_object('monto', i.monto_gs, 'pagada', i.estado = 'pagada', 'fecha', i.pagado_en) end,
      'cuotas', coalesce((select jsonb_agg(c order by (c ->> 'n')::int) from (
        select jsonb_build_object('n', x.ord, 'mes', x.q ->> 'mes',
          'venc', case when coalesce((x.q ->> 'pagado')::boolean, false) or (x.q ->> 'venc') is null then x.q ->> 'venc' else ((x.q ->> 'venc')::date + corr)::text end,
          'monto', coalesce(nullif(x.q ->> 'monto', '')::numeric, 0)::bigint,
          'pagado', coalesce((x.q ->> 'pagado')::boolean, false), 'fecha_pago', nullif(x.q ->> 'fp', ''),
          'estado', case when coalesce((x.q ->> 'pagado')::boolean, false) then 'pagada'
                         when i.suspendida_desde is not null then 'en_suspension'
                         when (x.q ->> 'venc') is not null and (x.q ->> 'venc')::date + corr < hoy then 'vencida'
                         else 'pendiente' end,
          'comprobante', (select p.estado from public.aula_pagos p where p.inscripcion_id = i.id and p.mes = x.ord order by p.creado desc limit 1)) c
        from jsonb_array_elements(cuotas) with ordinality as x(q, ord)) y), '[]'::jsonb)));
  end loop;
  return res;
end $f$;
revoke all on function public.aula_mis_cuotas() from public, anon;
grant execute on function public.aula_mis_cuotas() to authenticated, service_role;

