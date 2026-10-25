-- tania-agenda 1.5.0 · Clases por semana (1, 2, …) y horario fijo semanal con varios días
-- Requiere: sync-completo.sql (1.3.0) y horarios-estandar.sql (1.4.0) ya instalados. Idempotente.
-- Volver a correr ESTE archivo si alguna vez se vuelve a correr sync-completo.sql o horarios-estandar.sql.
--
--  * servicios.extra.clases_semana (1..3): cuántos días por semana elige la alumna. Si falta se deduce
--    del texto del curso ("1 clase semanal", "2 veces por semana"…); si no se puede, 1.
--  * inscripciones.horario guarda los días separados por "; ":  "Lunes 09:00–11:00; Jueves 16:00–18:00".
--    Un solo día sigue siendo exactamente igual que antes ("Lunes 09:00–11:00").
--  * Cupos por día + hora de inicio: cada alumna ocupa un lugar en CADA uno de sus días.
--  * disponibilidad_cursos() devuelve además clases_semana y alumnas por curso (la web y el panel
--    activan la elección de varios días SOLO cuando ven ese dato: antes de correr esto todo sigue como 1.4.0).
--  * crear_inscripcion() valida: N días distintos, cada uno de la lista del curso y con lugar.
begin;

alter table public.inscripciones drop constraint if exists inscripciones_horario_check;
alter table public.inscripciones add constraint inscripciones_horario_check check (horario is null or length(horario) <= 200);

create or replace function public._partes_horario(p text)
returns text[] language sql immutable as $$
  select coalesce(array(select btrim(x) from unnest(regexp_split_to_array(coalesce(p, ''), '\s*;\s*')) x where btrim(x) <> ''), '{}') $$;

create or replace function public._clases_de(s public.servicios)
returns int language sql immutable as $$
  select case when coalesce(s.extra ->> 'clases_semana', '') ~ '^\d+$' and (s.extra ->> 'clases_semana')::int between 1 and 3
              then (s.extra ->> 'clases_semana')::int else 1 end $$;

create or replace function public._ocupados(p_curso text, p_horario text)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from public.inscripciones i
  where i.servicio_id = p_curso and i.estado in ('pendiente', 'pagada') and coalesce(i.app_estado, '') <> 'finalizada'
    and (p_horario is null or exists (select 1 from unnest(public._partes_horario(i.horario)) x
                                      where public._norm_horario(x) = public._norm_horario(p_horario))) $$;
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
    res := res || jsonb_build_object(s.id, jsonb_build_object('cupo', tot_c, 'ocupados', tot_o, 'disponibles', greatest(tot_c - tot_o, 0),
      'horarios', arr, 'clases_semana', public._clases_de(s), 'alumnas', public._ocupados(s.id, null)));
  end loop;
  return res;
end $$;
grant execute on function public.disponibilidad_cursos() to anon, authenticated;

create or replace function public.crear_inscripcion(p_curso text, p_nombre text, p_telefono text, p_email text,
                                                    p_notas text default null, p_horario text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare s public.servicios; hs text[]; partes text[]; elegidos text[] := '{}'; p text; v_h text; r jsonb; n int;
begin
  s := public._servicio_de(p_curso);
  if s.id is not null and s.categoria = 'academia' then
    perform pg_advisory_xact_lock(hashtext('crear_inscripcion'));
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

-- Valor inicial de clases_semana (solo cursos que todavía no lo tienen), deducido del texto del curso.
update public.servicios s set extra = jsonb_set(coalesce(s.extra, '{}'::jsonb), '{clases_semana}', to_jsonb(x.n), true)
from (
  select id, coalesce(
    (select case lower(m[1]) when 'una' then 1 when 'un' then 1 when 'dos' then 2 when 'tres' then 3 else least(greatest(m[1]::int, 1), 3) end
     from regexp_match(lower(coalesce(descripcion, '') || ' ' || coalesce(duracion_texto, '') || ' ' || coalesce(extra::text, '')),
                       '(\d|una|un|dos|tres)\s+(?:clases?|veces|d[ií]as?)\s*(?:semanal|semanales|por semana|a la semana|x semana)') m), 1) as n
  from public.servicios where categoria = 'academia') x
where x.id = s.id and not (coalesce(s.extra, '{}'::jsonb) ? 'clases_semana');

commit;
notify pgrst, 'reload schema';
select id, extra -> 'clases_semana' as clases_semana from public.servicios where categoria = 'academia' order by id;
