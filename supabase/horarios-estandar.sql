-- tania-agenda 1.4.0 · Horarios estándar de los cursos (rangos "Lunes 09:00–11:00") + edición de horarios
-- Requiere: supabase/sync-completo.sql (1.3.0) ya instalado. Idempotente: se puede correr más de una vez.
--
--  1) _norm_horario(): clave "dia|HH:MM" (sin tildes, por hora de inicio). Así "Martes 18:00" (formato viejo)
--     y "Martes 18:00–20:00" (nuevo) ocupan el MISMO cupo, y "sabado 9:00 - 11:00" = "Sábado 09:00–11:00".
--  2) _ocupados() y crear_inscripcion() comparan horarios con esa clave (antes: texto exacto).
--  3) Carga los horarios estándar en TODOS los cursos (servicios.categoria = 'academia'):
--       Lunes a viernes: 09:00–11:00, 12:00–14:00, 16:00–18:00, 18:00–20:00
--       Sábados:         09:00–11:00, 12:00–14:00, 16:00–18:00
--     Después Tania los edita por curso en el panel (Cursos › Editar).
--  4) Las inscripciones con horario viejo ("Martes 18:00") pasan al texto nuevo equivalente
--     ("Martes 18:00–20:00") si existe en su curso; la app de agenda toma el cambio sola.
--  Editar horario de una alumna o día/hora de una cita desde el panel o la app: no requiere nada más
--  (el panel actualiza la fila y app_sincronizar ya sube horario/fecha/hora; gana el último cambio).
begin;

create or replace function public._norm_horario(p text)
returns text language sql immutable as $$
  select case
    when m is null then nullif(lower(btrim(coalesce(p, ''))), '')
    else lower(translate(m[1], 'ÁÉÍÓÚáéíóú', 'AEIOUaeiou')) || '|' || lpad(m[2], 2, '0') || ':' || m[3]
  end
  from (select regexp_match(btrim(coalesce(p, '')), '^([A-Za-zÁÉÍÓÚáéíóú]+)\.?\s+(\d{1,2}):(\d{2})') as m) x $$;

create or replace function public._ocupados(p_curso text, p_horario text)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from public.inscripciones i
  where i.servicio_id = p_curso and i.estado in ('pendiente', 'pagada') and coalesce(i.app_estado, '') <> 'finalizada'
    and (p_horario is null or public._norm_horario(i.horario) = public._norm_horario(p_horario)) $$;
revoke all on function public._ocupados(text, text) from public, anon, authenticated;

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
      select h into v_h from unnest(hs) h where public._norm_horario(h) = public._norm_horario(v_h) limit 1;
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

-- 3) Horarios estándar en todos los cursos (solo si cambian: no toca "actualizado" si ya están iguales)
with est as (
  select jsonb_agg(d || ' ' || b order by o, b) as hs from (
    select d, o, b from unnest(array['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado']) with ordinality as t(d, o)
    cross join unnest(array['09:00–11:00','12:00–14:00','16:00–18:00','18:00–20:00']) b
    where not (d = 'Sábado' and b = '18:00–20:00')) x)
update public.servicios s set extra = jsonb_set(coalesce(s.extra, '{}'::jsonb), '{horarios}', est.hs, true)
from est where s.categoria = 'academia' and coalesce(s.extra -> 'horarios', 'null'::jsonb) is distinct from est.hs;

-- 4) Inscripciones con horario viejo → texto nuevo equivalente de su curso
update public.inscripciones i set horario = h.nuevo
from (select s.id, x as nuevo from public.servicios s, unnest(public._horarios_de(s)) x where s.categoria = 'academia') h
where h.id = i.servicio_id and i.horario is not null and i.horario <> h.nuevo
  and public._norm_horario(i.horario) = public._norm_horario(h.nuevo);

commit;

select id, jsonb_array_length(extra -> 'horarios') as horarios from public.servicios where categoria = 'academia' order by id;
