-- =====================================================================
-- Comprobantes de transferencia (turnos y cursos) · IDEMPOTENTE
-- Correr en el SQL Editor DESPUÉS de schema.sql / cursos.sql. Sin este archivo la web sigue
-- funcionando como antes (no muestra datos de pago del turno ni la subida del comprobante).
--
-- Seguridad:
--  * La "llave" de cada turno/inscripción es su id (uuid aleatorio) que SOLO recibe quien la creó.
--  * datos_pago_reserva(id): devuelve datos_pago + monto únicamente para un turno existente,
--    no cancelado/rechazado y creado hace menos de 30 días.
--  * Bucket PRIVADO "comprobantes": el público solo puede SUBIR (insert) a r/<id>/… o i/<id>/…
--    de un turno/inscripción válido; no puede listar, leer, pisar ni borrar. La admin lee con URL firmada.
--  * registrar_comprobante(): marca el turno/inscripción como "comprobante enviado".
--  * admin_pago_verificado(): solo admin, marca "✅ Pago verificado".
-- =====================================================================

alter table public.reservas      add column if not exists comprobante_ruta text,
                                 add column if not exists comprobante_estado text,
                                 add column if not exists comprobante_en timestamptz;
alter table public.inscripciones add column if not exists comprobante_ruta text,
                                 add column if not exists comprobante_estado text,
                                 add column if not exists comprobante_en timestamptz;
do $$ begin
  alter table public.reservas add constraint reservas_comprobante_estado_chk check (comprobante_estado is null or comprobante_estado in ('enviado', 'verificado'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.inscripciones add constraint inscripciones_comprobante_estado_chk check (comprobante_estado is null or comprobante_estado in ('enviado', 'verificado'));
exception when duplicate_object then null; end $$;

-- ¿Se puede adjuntar un comprobante a este turno ('r') o inscripción ('i')?
create or replace function public._comprobante_destino_ok(p_tipo text, p_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case p_tipo
    when 'r' then exists (select 1 from public.reservas r where r.id = p_id and r.estado not in ('rechazada', 'cancelada')
                          and r.creado > now() - interval '30 days' and coalesce(r.comprobante_estado, '') <> 'verificado')
    when 'i' then exists (select 1 from public.inscripciones i where i.id = p_id and i.estado <> 'cancelada'
                          and i.creado > now() - interval '30 days' and coalesce(i.comprobante_estado, '') <> 'verificado')
    else false end;
$$;

-- Ruta válida: r/<uuid>/<13 dígitos>.(jpg|webp|png|pdf)
create or replace function public._comprobante_ruta_ok(p_ruta text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare m text[];
begin
  m := regexp_match(coalesce(p_ruta, ''), '^([ri])/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9]{10,16}\.(jpg|webp|png|pdf)$');
  if m is null then return false; end if;
  -- máx. 5 archivos por turno/inscripción (anti abuso)
  if (select count(*) from storage.objects o where o.bucket_id = 'comprobantes' and o.name like m[1] || '/' || m[2] || '/%') >= 5 then return false; end if;
  return public._comprobante_destino_ok(m[1], m[2]::uuid);
end $$;
revoke all on function public._comprobante_destino_ok(text, uuid) from public, anon, authenticated;
revoke all on function public._comprobante_ruta_ok(text) from public;
grant execute on function public._comprobante_ruta_ok(text) to anon, authenticated;

-- Bucket privado (1,5 MB; imagen o PDF)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes', 'comprobantes', false, 1600000, array['image/jpeg', 'image/webp', 'image/png', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists comprobantes_publico_subir on storage.objects;
create policy comprobantes_publico_subir on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'comprobantes' and public._comprobante_ruta_ok(name));
drop policy if exists comprobantes_admin_leer on storage.objects;
create policy comprobantes_admin_leer on storage.objects for select to authenticated
  using (bucket_id = 'comprobantes' and public.es_admin());
drop policy if exists comprobantes_admin_borrar on storage.objects;
create policy comprobantes_admin_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'comprobantes' and public.es_admin());

-- Datos de pago para un turno recién creado (mismo criterio que crear_inscripcion: solo después de reservar).
create or replace function public.datos_pago_reserva(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.reservas; p public.ajustes_privados; v_txt text; v_monto bigint;
begin
  select * into r from public.reservas where id = p_id and estado not in ('rechazada', 'cancelada') and creado > now() - interval '30 days';
  if r.id is null then return jsonb_build_object('ok', false, 'error', 'NO_ENCONTRADA'); end if;
  select * into p from public.ajustes_privados where id = 1;
  -- Monto: la seña si hay y eligió seña; si no, el precio. Se toma el primer número "Gs. 250.000" del texto.
  v_txt := case when r.pago = 'sena' and nullif(r.sena_ref, '') is not null then r.sena_ref else r.precio_ref end;
  v_monto := nullif(regexp_replace(coalesce(substring(coalesce(v_txt, '') from '(\d{1,3}(?:\.\d{3})+|\d{4,})'), ''), '\D', '', 'g'), '')::bigint;
  return jsonb_build_object('ok', true, 'id', r.id, 'datos_pago', coalesce(p.datos_pago, ''),
    'es_sena', r.pago = 'sena' and nullif(r.sena_ref, '') is not null, 'monto_texto', v_txt, 'monto_gs', v_monto,
    'servicio', r.servicio_nombre, 'comprobante_estado', r.comprobante_estado);
end $$;
revoke all on function public.datos_pago_reserva(uuid) from public;
grant execute on function public.datos_pago_reserva(uuid) to anon, authenticated;

-- Datos de pago de una inscripción (para "subir después" desde el enlace).
create or replace function public.datos_pago_inscripcion(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare i public.inscripciones; p public.ajustes_privados;
begin
  select * into i from public.inscripciones where id = p_id and estado <> 'cancelada' and creado > now() - interval '30 days';
  if i.id is null then return jsonb_build_object('ok', false, 'error', 'NO_ENCONTRADA'); end if;
  select * into p from public.ajustes_privados where id = 1;
  return jsonb_build_object('ok', true, 'id', i.id, 'referencia', i.referencia, 'curso', i.curso_nombre, 'monto_gs', i.monto_gs,
    'datos_pago', case when coalesce(i.monto_gs, 0) > 0 then coalesce(p.datos_pago, '') else '' end, 'comprobante_estado', i.comprobante_estado);
end $$;
revoke all on function public.datos_pago_inscripcion(uuid) from public;
grant execute on function public.datos_pago_inscripcion(uuid) to anon, authenticated;

-- Después de subir el archivo: lo vincula y marca "comprobante enviado".
create or replace function public.registrar_comprobante(p_tipo text, p_id uuid, p_ruta text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if p_tipo not in ('r', 'i') or p_ruta is null or p_ruta not like p_tipo || '/' || p_id::text || '/%' then
    return jsonb_build_object('ok', false, 'error', 'RUTA_INVALIDA'); end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'comprobantes' and o.name = p_ruta) then
    return jsonb_build_object('ok', false, 'error', 'ARCHIVO_NO_ENCONTRADO'); end if;
  if not public._comprobante_destino_ok(p_tipo, p_id) then return jsonb_build_object('ok', false, 'error', 'NO_ENCONTRADA'); end if;
  if p_tipo = 'r' then
    update public.reservas set comprobante_ruta = p_ruta, comprobante_estado = 'enviado', comprobante_en = now(), actualizado = now() where id = p_id;
  else
    update public.inscripciones set comprobante_ruta = p_ruta, comprobante_estado = 'enviado', comprobante_en = now(), actualizado = now() where id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'estado', 'enviado');
end $$;
revoke all on function public.registrar_comprobante(text, uuid, text) from public;
grant execute on function public.registrar_comprobante(text, uuid, text) to anon, authenticated;

-- Panel/app: ✅ Pago verificado (o deshacer con p_ok = false).
create or replace function public.admin_pago_verificado(p_tabla text, p_id uuid, p_ok boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v text := case when p_ok then 'verificado' end;
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  if p_tabla = 'reservas' then
    update public.reservas set comprobante_estado = coalesce(v, case when comprobante_ruta is not null then 'enviado' end), actualizado = now() where id = p_id;
  elsif p_tabla = 'inscripciones' then
    update public.inscripciones set comprobante_estado = coalesce(v, case when comprobante_ruta is not null then 'enviado' end), actualizado = now() where id = p_id;
  else raise exception 'TABLA_INVALIDA'; end if;
  return jsonb_build_object('ok', found, 'estado', v);
end $$;
revoke all on function public.admin_pago_verificado(text, uuid, boolean) from public, anon;
grant execute on function public.admin_pago_verificado(text, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';

-- Verificación
select (select public from storage.buckets where id = 'comprobantes') = false as bucket_privado,
       has_function_privilege('anon', 'public.datos_pago_reserva(uuid)', 'execute') as anon_datos_pago,
       not has_function_privilege('anon', 'public.admin_pago_verificado(text, uuid, boolean)', 'execute') as verificar_solo_admin;
