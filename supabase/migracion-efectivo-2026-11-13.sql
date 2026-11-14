-- Pago en efectivo al iniciar el curso (13/11/2026). Ya aplicada en la base real. Idempotente.

CREATE OR REPLACE FUNCTION public._completar_inscripcion(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare i public.inscripciones;
begin
  update public.inscripciones set estado = 'pendiente', completada_en = now() where id = p_id and estado = 'borrador' returning * into i;
  if i.id is null then return false; end if;
  -- Reserva espejo: dispara el aviso push (trigger avisar_reserva → Edge Function), igual que antes pero recién ahora.
  perform set_config('tania.interno', '1', true);
  insert into public.reservas (servicio_id, variante_id, servicio_nombre, precio_ref, bloquea, cliente_nombre,
    cliente_telefono, cliente_email, notas, pago, estado, origen, inscripcion_id)
  values (i.servicio_id, i.variante_id, 'Inscripción: ' || i.curso_nombre, i.precio_ref, false, i.cliente_nombre,
    i.cliente_telefono, i.cliente_email, 'Ref. ' || i.referencia || case when i.pago_metodo = 'efectivo' then ' · pagará en efectivo al inicio del curso' else '' end || case when coalesce(i.monto_gs, 0) > 0 then ' · matrícula ' || public._gs(i.monto_gs) else ' · sin matrícula (confirmar)' end
    || coalesce(' · ' || i.notas, ''), 'total', 'pendiente', 'web', i.id);
  perform set_config('tania.interno', '', true);
  return true;
end $function$
;

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
update public.inscripciones set comprobante_ruta = p_ruta, comprobante_estado = 'enviado', comprobante_en = now(), actualizado = now(), pago_metodo = case when pago_metodo = 'efectivo' then null else pago_metodo end where id = p_id;
perform public._completar_inscripcion(p_id);
end if;
return jsonb_build_object('ok', true, 'estado', 'enviado');
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
'datos_pago', case when coalesce(i.monto_gs, 0) > 0 then coalesce(p.datos_pago, '') else '' end, 'comprobante_estado', i.comprobante_estado, 'pago_metodo', i.pago_metodo, 'estado', i.estado);
end $function$
;

drop function if exists public.aula_mis_inscripciones();
CREATE OR REPLACE FUNCTION public.aula_mis_inscripciones()
 RETURNS TABLE(id uuid, referencia text, servicio_id text, variante_id text, curso_nombre text, precio_ref text, monto_gs bigint, estado text, acceso boolean, creado timestamp with time zone, pago_metodo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
select i.id, i.referencia, i.servicio_id, i.variante_id, i.curso_nombre, i.precio_ref, i.monto_gs, i.estado, i.acceso, i.creado, i.pago_metodo
from public.inscripciones i
where auth.uid() is not null and i.cliente_email = lower(coalesce(auth.jwt() ->> 'email', '')) and i.estado not in ('cancelada', 'borrador')
order by i.creado desc;
$function$
;
revoke all on function public.aula_mis_inscripciones() from public, anon;
grant execute on function public.aula_mis_inscripciones() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.aula_mis_cuotas()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare i public.inscripciones; doc jsonb; res jsonb := '[]'::jsonb; hoy date := public._hoy_py();
  cuotas jsonb; k int; corr int; v date; base date; m date;
begin
  if auth.uid() is null then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  for i in
    select ins.* from public.alumnos a join public.inscripciones ins on ins.cliente_email = a.email
    where a.user_id = auth.uid() and a.email = lower(coalesce(auth.jwt() ->> 'email', '')) and (ins.acceso or (ins.estado = 'pendiente' and ins.pago_metodo = 'efectivo')) and ins.estado not in ('cancelada', 'borrador')
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
      'matricula', case when coalesce(i.monto_gs, 0) > 0 then jsonb_build_object('monto', i.monto_gs, 'pagada', i.estado = 'pagada', 'fecha', i.pagado_en, 'metodo', i.pago_metodo, 'efectivo_inicio', i.estado = 'pendiente' and i.pago_metodo = 'efectivo') end,
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
end $function$
;


-- Elegir "pago en efectivo al iniciar el curso": completa la inscripción (ya no es borrador), avisa a Tania como cualquier
-- inscripción completa y NO pide comprobante. Tania la marca como pagada cuando cobra (admin_registrar_pago, método efectivo).
create or replace function public.inscripcion_pago_efectivo(p_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare i public.inscripciones; recien boolean;
begin
  perform public._limpiar_borradores();
  select * into i from public.inscripciones where id = p_id for update;
  if i.id is null or i.estado = 'cancelada' or (i.estado = 'borrador' and i.creado < now() - interval '48 hours') then
    return jsonb_build_object('ok', false, 'error', 'NO_ENCONTRADA'); end if;
  if i.estado = 'pagada' or coalesce(i.comprobante_estado, '') in ('enviado', 'verificado') then
    return jsonb_build_object('ok', false, 'error', 'YA_PAGADA_O_COMPROBANTE'); end if;
  update public.inscripciones set pago_metodo = 'efectivo', actualizado = now() where id = p_id;
  recien := public._completar_inscripcion(p_id);
  return jsonb_build_object('ok', true, 'estado', 'pendiente', 'metodo', 'efectivo', 'recien', recien);
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $f$;
revoke all on function public.inscripcion_pago_efectivo(uuid) from public;
grant execute on function public.inscripcion_pago_efectivo(uuid) to anon, authenticated, service_role;
