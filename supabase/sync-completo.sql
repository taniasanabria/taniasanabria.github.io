-- =====================================================================
-- tania-agenda 1.3.0 · Sincronización completa app ⇄ web + cupos y horarios ocupados
-- Ejecutar UNA vez en Supabase (SQL Editor), DESPUÉS de sync-borrado.sql.
-- Idempotente: se puede volver a correr sin perder datos.
--
--  1) Columnas nuevas en reservas e inscripciones (id de la app, horario/turno del curso,
--     progreso de cuotas, deuda, próximo vencimiento, fecha de la última edición hecha en la web).
--  2) app_sincronizar(items): la app (cuenta admin) crea/actualiza/cancela turnos y alumnas.
--     Idempotente por app_id; si la web editó la fila DESPUÉS que la app, gana la web (conflicto).
--  3) disponibilidad_cursos(): cupos ocupados/disponibles por curso y horario (solo números).
--  4) horarios_del_dia(fecha, servicio): todos los horarios del día con libre = true/false
--     (sin nombres ni teléfonos). crear_reserva ya rechaza horarios tomados.
--  5) crear_inscripcion(..., p_horario): valida horario y cupo (CURSO_COMPLETO / HORARIO_COMPLETO).
-- =====================================================================

-- 1) Columnas ------------------------------------------------------------
alter table public.reservas add column if not exists app_id text;
alter table public.reservas add column if not exists app_estado text;
alter table public.reservas add column if not exists total_gs bigint;
alter table public.reservas add column if not exists pagado_gs bigint;
alter table public.reservas add column if not exists web_mod timestamptz;
create unique index if not exists reservas_app_id_idx on public.reservas (app_id) where app_id is not null;

alter table public.inscripciones add column if not exists app_id text;
alter table public.inscripciones add column if not exists app_estado text;
alter table public.inscripciones add column if not exists horario text;
alter table public.inscripciones add column if not exists fecha_inicio date;
alter table public.inscripciones add column if not exists cuota_gs bigint;
alter table public.inscripciones add column if not exists cuotas_total int;
alter table public.inscripciones add column if not exists cuotas_pagadas int;
alter table public.inscripciones add column if not exists deuda_gs bigint;
alter table public.inscripciones add column if not exists proximo_venc date;
alter table public.inscripciones add column if not exists web_mod timestamptz;
create unique index if not exists inscripciones_app_id_idx on public.inscripciones (app_id) where app_id is not null;
create index if not exists inscripciones_cupo_idx on public.inscripciones (servicio_id, estado);

-- Alumnas cargadas en la app pueden no tener email (el email solo hace falta para el aula).
alter table public.inscripciones alter column cliente_email drop not null;

alter table public.reservas drop constraint if exists reservas_origen_check;
alter table public.reservas add constraint reservas_origen_check check (origen in ('web', 'admin', 'app'));
alter table public.inscripciones drop constraint if exists inscripciones_origen_check;
alter table public.inscripciones add constraint inscripciones_origen_check check (origen in ('web', 'admin', 'app'));
alter table public.inscripciones drop constraint if exists inscripciones_horario_check;
alter table public.inscripciones add constraint inscripciones_horario_check check (horario is null or length(horario) <= 80);

-- web_mod = cuándo se editó la fila por ÚLTIMA vez desde la web/panel (no desde la app).
create or replace function public._marcar_web_mod()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('tania.desde_app', true), '') = '1' then
    if tg_op = 'UPDATE' then new.web_mod := old.web_mod; end if;
  else
    new.web_mod := now();
  end if;
  return new;
end $$;
revoke all on function public._marcar_web_mod() from public, anon, authenticated;
drop trigger if exists reservas_web_mod on public.reservas;
create trigger reservas_web_mod before insert or update on public.reservas
  for each row execute function public._marcar_web_mod();
drop trigger if exists inscripciones_web_mod on public.inscripciones;
create trigger inscripciones_web_mod before insert or update on public.inscripciones
  for each row execute function public._marcar_web_mod();

-- 2) Escritura desde la app ---------------------------------------------
create or replace function public._txt(p jsonb, k text, n int)
returns text language sql immutable as $$ select nullif(left(btrim(coalesce(p ->> k, '')), n), '') $$;
create or replace function public._big(p jsonb, k text)
returns bigint language sql immutable as $$
  select case when coalesce(p ->> k, '') ~ '^-?\d+(\.\d+)?$' then greatest((p ->> k)::numeric, 0)::bigint end $$;

create or replace function public._app_reserva(it jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  d jsonb := coalesce(it -> 'd', '{}'::jsonb);
  v_app text := public._txt(it, 'app_id', 64);
  v_web uuid := case when coalesce(it ->> 'web_id', '') ~ '^[0-9a-f-]{36}$' then (it ->> 'web_id')::uuid end;
  v_mod timestamptz := to_timestamp(coalesce(nullif(it ->> 'mod', '')::numeric, 0) / 1000.0);
  r public.reservas; s public.servicios;
  v_est_app text := coalesce(public._txt(d, 'estado', 20), 'pendiente');
  v_est text; v_ini timestamptz; v_fin timestamptz; v_fecha date; v_hora text; v_dur int; v_coord boolean;
  v_nombre text; v_tel text; v_email text; v_bloq boolean; v_existe boolean;
begin
  if v_app is null and v_web is null then raise exception 'SIN_ID' using errcode = '22023'; end if;
  perform set_config('tania.desde_app', '1', true);
  if v_web is not null then select * into r from public.reservas where id = v_web for update; end if;
  if r.id is null and v_app is not null then select * into r from public.reservas where app_id = v_app for update; end if;
  v_existe := r.id is not null;

  if coalesce((it ->> 'borrado')::boolean, false) then
    if not v_existe then return jsonb_build_object('ok', true, 'resultado', 'no_existe'); end if;
    if r.inscripcion_id is not null then
      update public.inscripciones set estado = 'cancelada' where id = r.inscripcion_id and estado <> 'cancelada';
    elsif r.estado not in ('cancelada', 'rechazada') then
      update public.reservas set estado = 'cancelada', app_estado = 'cancelada' where id = r.id;
    end if;
    select * into r from public.reservas where id = r.id;
    return jsonb_build_object('ok', true, 'resultado', 'borrado', 'fila', to_jsonb(r));
  end if;

  -- Conflicto: la web/panel editó esta fila después del último cambio hecho en la app → gana la web.
  if v_existe and r.web_mod is not null and r.web_mod > v_mod then
    return jsonb_build_object('ok', true, 'resultado', 'conflicto', 'fila', to_jsonb(r));
  end if;

  v_est := case v_est_app when 'confirmada' then 'aprobada' when 'realizada' then 'pagada' when 'cancelada' then 'cancelada' else 'pendiente' end;
  v_fecha := case when coalesce(d ->> 'fecha', '') ~ '^\d{4}-\d{2}-\d{2}$' then (d ->> 'fecha')::date end;
  v_hora := case when coalesce(d ->> 'hora', '') ~ '^\d{1,2}:\d{2}$' then lpad(d ->> 'hora', 5, '0') end;
  v_coord := coalesce((d ->> 'a_coordinar')::boolean, false);
  v_dur := least(greatest(coalesce(nullif(d ->> 'dur', '')::numeric, 60)::int, 10), 720);
  if v_fecha is not null and v_hora is not null and not v_coord then
    v_ini := (v_fecha + v_hora::time) at time zone public._zona();
    v_fin := v_ini + make_interval(mins => v_dur);
  end if;
  v_nombre := coalesce(public._txt(d, 'nombre', 120), 'Sin nombre');
  if length(v_nombre) < 2 then v_nombre := v_nombre || '.'; end if;
  v_tel := public._txt(d, 'tel', 30); if v_tel is null or length(v_tel) < 6 then v_tel := 'sin teléfono'; end if;
  v_email := lower(public._txt(d, 'email', 160));
  v_bloq := v_ini is not null and v_est in ('pendiente', 'aprobada', 'pagada');

  if not v_existe then
    s := public._servicio_de(public._txt(d, 'servicio', 80));
    begin
      insert into public.reservas (servicio_id, servicio_nombre, inicio, fin, fecha_preferida, hora_preferida, bloquea,
        cliente_nombre, cliente_telefono, cliente_email, personas, notas, pago, estado, origen, app_id, app_estado, total_gs, pagado_gs)
      values (s.id, coalesce(public._txt(d, 'servicio_nombre', 200), s.nombre, 'Turno'), v_ini, v_fin, v_fecha,
        case when v_coord then 'a coordinar' else v_hora end, v_bloq, v_nombre, v_tel, v_email,
        least(greatest(coalesce(nullif(d ->> 'personas', '')::numeric, 1)::int, 1), 500), public._txt(d, 'notas', 2000),
        'sena', v_est, 'app', v_app, v_est_app, public._big(d, 'precio'), public._big(d, 'pagado'))
      returning * into r;
    exception when exclusion_violation then   -- se superpone con otro turno: se guarda igual, sin bloquear dos veces
      insert into public.reservas (servicio_id, servicio_nombre, inicio, fin, fecha_preferida, hora_preferida, bloquea,
        cliente_nombre, cliente_telefono, cliente_email, personas, notas, pago, estado, origen, app_id, app_estado, total_gs, pagado_gs)
      values (s.id, coalesce(public._txt(d, 'servicio_nombre', 200), s.nombre, 'Turno'), v_ini, v_fin, v_fecha,
        case when v_coord then 'a coordinar' else v_hora end, false, v_nombre, v_tel, v_email,
        least(greatest(coalesce(nullif(d ->> 'personas', '')::numeric, 1)::int, 1), 500), public._txt(d, 'notas', 2000),
        'sena', v_est, 'app', v_app, v_est_app, public._big(d, 'precio'), public._big(d, 'pagado'))
      returning * into r;
    end;
    return jsonb_build_object('ok', true, 'resultado', 'creada', 'fila', to_jsonb(r));
  end if;

  if r.inscripcion_id is not null then   -- reserva espejo de una inscripción: no se edita como turno
    return jsonb_build_object('ok', true, 'resultado', 'sin_cambios', 'fila', to_jsonb(r));
  end if;
  begin
    update public.reservas set
      estado = case when r.estado = 'rechazada' and v_est = 'cancelada' then r.estado else v_est end,
      app_estado = v_est_app,
      inicio = case when v_coord then null else coalesce(v_ini, r.inicio) end,
      fin = case when v_coord then null else coalesce(v_fin, r.fin) end,
      fecha_preferida = coalesce(v_fecha, r.fecha_preferida),
      hora_preferida = case when v_coord then coalesce(r.hora_preferida, 'a coordinar') when v_hora is not null then v_hora else r.hora_preferida end,
      bloquea = (case when v_coord then false else coalesce(v_ini, r.inicio) is not null end) and v_est in ('pendiente', 'aprobada', 'pagada')
                and (r.origen = 'app' or coalesce(r.bloquea, false) or v_ini is not null),
      cliente_nombre = v_nombre,
      cliente_telefono = case when v_tel = 'sin teléfono' then r.cliente_telefono else v_tel end,
      cliente_email = coalesce(v_email, r.cliente_email),
      personas = coalesce(least(greatest(nullif(d ->> 'personas', '')::numeric::int, 1), 500), r.personas),
      total_gs = coalesce(public._big(d, 'precio'), r.total_gs),
      pagado_gs = coalesce(public._big(d, 'pagado'), r.pagado_gs),
      app_id = coalesce(r.app_id, v_app)
    where id = r.id returning * into r;
  exception when exclusion_violation then
    update public.reservas set estado = v_est, app_estado = v_est_app, inicio = v_ini, fin = v_fin, bloquea = false,
      fecha_preferida = coalesce(v_fecha, r.fecha_preferida), hora_preferida = coalesce(v_hora, r.hora_preferida)
    where id = r.id returning * into r;
  end;
  return jsonb_build_object('ok', true, 'resultado', 'actualizada', 'fila', to_jsonb(r));
end $$;

create or replace function public._app_inscripcion(it jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp
as $$
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
      deuda_gs, proximo_venc, pagado_en)
    values (s.id, case when v_var is not null then d ->> 'curso' end, v_curso,
      left(concat_ws(' · ', case when v_cuota is not null then 'Curso: ' || public._gs(v_cuota) || case when coalesce((d ->> 'mensual')::boolean, false) then ' / mes' else '' end end,
                     case when coalesce(v_mat, 0) > 0 then 'Matrícula: ' || public._gs(v_mat) else 'Sin matrícula' end), 300),
      coalesce(v_mat, 0), v_nombre, v_tel, v_email, public._txt(d, 'notas', 1000), v_est, 'app', v_app, v_est_app,
      public._txt(d, 'horario', 80), case when coalesce(d ->> 'inicio', '') ~ '^\d{4}-\d{2}-\d{2}$' then (d ->> 'inicio')::date end,
      v_cuota, nullif(d ->> 'cuotas_total', '')::numeric::int, nullif(d ->> 'cuotas_pagadas', '')::numeric::int, public._big(d, 'deuda'),
      case when coalesce(d ->> 'proximo_venc', '') ~ '^\d{4}-\d{2}-\d{2}$' then (d ->> 'proximo_venc')::date end,
      case when coalesce((d ->> 'mat_pagada')::boolean, false) and v_est = 'pagada' then now() end)
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
    app_id = coalesce(app_id, v_app)
  where id = i.id returning * into i;
  return jsonb_build_object('ok', true, 'resultado', 'actualizada', 'fila', to_jsonb(i));
end $$;

-- Lote de cambios de la app. Cada ítem va en su propia sub-transacción: uno inválido no frena al resto.
-- Ítem: {tipo:'r'|'i', app_id, web_id?, mod (ms desde 1970, hora del cambio en la app), borrado?, d:{...}}
create or replace function public.app_sincronizar(p_items jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare it jsonb; res jsonb := '[]'::jsonb; x jsonb;
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then raise exception 'LOTE_INVALIDO' using errcode = '22023'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    begin
      if it ->> 'tipo' = 'r' then x := public._app_reserva(it);
      elsif it ->> 'tipo' = 'i' then x := public._app_inscripcion(it);
      else x := jsonb_build_object('ok', false, 'error', 'TIPO_INVALIDO'); end if;
    exception when others then
      x := jsonb_build_object('ok', false, 'error', sqlerrm, 'codigo', sqlstate);
    end;
    perform set_config('tania.desde_app', '', true);
    res := res || jsonb_build_array(x || jsonb_build_object('tipo', it ->> 'tipo', 'app_id', it ->> 'app_id', 'web_id', it ->> 'web_id'));
  end loop;
  return res;
end $$;
revoke all on function public._app_reserva(jsonb) from public, anon, authenticated;
revoke all on function public._app_inscripcion(jsonb) from public, anon, authenticated;
revoke all on function public.app_sincronizar(jsonb) from public, anon;
grant execute on function public.app_sincronizar(jsonb) to authenticated;

-- 3) Cupos de cursos (público, solo números) -------------------------------
-- Cupo máximo: servicios.extra.cupo_max (por horario si el curso tiene horarios; si no, del curso). Sin cargar → 10.
-- Ocupan lugar: inscripciones pendientes o confirmadas que no terminaron el curso.
create or replace function public._cupo_de(s public.servicios)
returns int language sql immutable as $$
  select case when coalesce(s.extra ->> 'cupo_max', '') ~ '^\d+$' and (s.extra ->> 'cupo_max')::int > 0
              then (s.extra ->> 'cupo_max')::int else 10 end $$;
create or replace function public._horarios_de(s public.servicios)
returns text[] language sql immutable as $$
  select coalesce(array(select btrim(h) from jsonb_array_elements_text(
           case when jsonb_typeof(s.extra -> 'horarios') = 'array' then s.extra -> 'horarios' else '[]'::jsonb end) h
         where btrim(h) <> ''), '{}') $$;
create or replace function public._ocupados(p_curso text, p_horario text)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from public.inscripciones i
  where i.servicio_id = p_curso and i.estado in ('pendiente', 'pagada') and coalesce(i.app_estado, '') <> 'finalizada'
    and (p_horario is null or lower(btrim(coalesce(i.horario, ''))) = lower(btrim(p_horario))) $$;
revoke all on function public._ocupados(text, text) from public, anon, authenticated;

create or replace function public.disponibilidad_cursos()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare s public.servicios; res jsonb := '{}'::jsonb; hs text[]; h text; cupo int; occ int; arr jsonb; tot_c int; tot_o int;
begin
  for s in select * from public.servicios where categoria = 'academia' and activo loop
    cupo := public._cupo_de(s); hs := public._horarios_de(s); arr := '[]'::jsonb;
    if array_length(hs, 1) is null then
      occ := public._ocupados(s.id, null); tot_c := cupo; tot_o := occ;
    else
      tot_c := 0; tot_o := 0;
      foreach h in array hs loop
        occ := public._ocupados(s.id, h);
        arr := arr || jsonb_build_array(jsonb_build_object('horario', h, 'cupo', cupo, 'ocupados', occ, 'disponibles', greatest(cupo - occ, 0)));
        tot_c := tot_c + cupo; tot_o := tot_o + least(occ, cupo);
      end loop;
    end if;
    res := res || jsonb_build_object(s.id, jsonb_build_object('cupo', tot_c, 'ocupados', tot_o, 'disponibles', greatest(tot_c - tot_o, 0), 'horarios', arr));
  end loop;
  return res;
end $$;
grant execute on function public.disponibilidad_cursos() to anon, authenticated;

-- 4) Todos los horarios del día con libre/ocupado (público, sin datos de clientas) -------
create or replace function public.horarios_del_dia(p_fecha date, p_servicio text)
returns table (inicio timestamptz, hora text, costo_extra boolean, libre boolean)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
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
                     where r.bloquea and r.estado in ('pendiente', 'aprobada', 'pagada')
                       and tstzrange(r.inicio, r.fin, '[)') && tstzrange(g.ini, g.ini + make_interval(mins => v_dur), '[)'))
  from agrupados g
  where g.ini >= now() + make_interval(hours => a.anticipacion_horas)
  order by g.ini;
end $$;
grant execute on function public.horarios_del_dia(date, text) to anon, authenticated;

-- 5) Inscripción pública con horario y control de cupo -----------------------
drop function if exists public.crear_inscripcion(text, text, text, text, text);
create or replace function public.crear_inscripcion(p_curso text, p_nombre text, p_telefono text, p_email text,
                                                    p_notas text default null, p_horario text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare s public.servicios; hs text[]; v_h text; r jsonb;
begin
  s := public._servicio_de(p_curso);
  if s.id is not null and s.categoria = 'academia' then
    perform pg_advisory_xact_lock(hashtext('crear_inscripcion'));
    hs := public._horarios_de(s);
    v_h := nullif(btrim(coalesce(p_horario, '')), '');
    if v_h is not null then
      select h into v_h from unnest(hs) h where lower(h) = lower(v_h) limit 1;
      if v_h is null then return jsonb_build_object('ok', false, 'error', 'HORARIO_INVALIDO'); end if;
      if public._ocupados(s.id, v_h) >= public._cupo_de(s) then return jsonb_build_object('ok', false, 'error', 'HORARIO_COMPLETO'); end if;
    elsif array_length(hs, 1) is null then
      if public._ocupados(s.id, null) >= public._cupo_de(s) then return jsonb_build_object('ok', false, 'error', 'CURSO_COMPLETO'); end if;
    elsif not exists (select 1 from unnest(hs) h where public._ocupados(s.id, h) < public._cupo_de(s)) then
      return jsonb_build_object('ok', false, 'error', 'CURSO_COMPLETO');
    end if;
  end if;
  r := public._crear_inscripcion(p_curso, p_nombre, p_telefono, p_email, p_notas);
  if v_h is not null and (r ->> 'ok')::boolean then
    update public.inscripciones set horario = v_h where id = (r ->> 'id')::uuid;
    r := r || jsonb_build_object('horario', v_h);
  end if;
  return r;
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
revoke all on function public.crear_inscripcion(text, text, text, text, text, text) from public;
grant execute on function public.crear_inscripcion(text, text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
select 'sync-completo instalado' as resultado;
