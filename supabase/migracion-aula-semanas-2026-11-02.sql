-- =====================================================================
-- AULA · LIBERACIÓN SEMANAL (2026-11-02) · IDEMPOTENTE · correr DESPUÉS de migracion-aula-merito-2026-11-02.sql
-- La clase de la semana N (lecciones.semana, contada desde el inicio del curso) se abre recién el día
--   fecha de aprobación (inscripciones.acceso_desde, hora de Paraguay) + 7·(N-1) días.
-- Se suma a las reglas existentes (mes habilitado por mérito + pago). semana NULL = sin restricción semanal.
-- Se aplica en la BASE: RLS de lecciones, archivos del bucket "cursos", entregas y cuestionarios.
-- =====================================================================
alter table public.lecciones add column if not exists semana int;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'lecciones_semana_chk') then
    alter table public.lecciones add constraint lecciones_semana_chk check (semana is null or semana between 1 and 160); end if; end $$;

-- Fecha (Paraguay) en que se abre la semana N para la alumna conectada; NULL si no tiene acceso
create or replace function public._semana_abre(p_curso text, p_variante text, p_semana int)
returns date language sql stable security definer set search_path = public, pg_temp
as $$
  select min((coalesce(i.acceso_desde, i.creado) at time zone 'America/Asuncion')::date + 7 * (greatest(coalesce(p_semana, 1), 1) - 1))
    from public.alumnos a join public.inscripciones i on i.cliente_email = a.email
   where auth.uid() is not null and a.user_id = auth.uid() and a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
     and i.servicio_id = p_curso and i.acceso and i.estado <> 'cancelada'
     and (p_variante is null or i.variante_id = p_variante);
$$;
create or replace function public._semana_abierta(p_curso text, p_variante text, p_semana int)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select public.es_admin() or p_semana is null
          or coalesce(public._semana_abre(p_curso, p_variante, p_semana) <= (now() at time zone 'America/Asuncion')::date, false); $$;

drop policy if exists lecciones_alumna on public.lecciones;
create policy lecciones_alumna on public.lecciones for select to authenticated
  using (activo and public.puede_ver_leccion(servicio_id, variante_id, mes) and public._semana_abierta(servicio_id, variante_id, semana));

create or replace function public.puede_ver_archivo(p_nombre text)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.es_admin() or exists (
    select 1 from public.lecciones l where l.archivo = p_nombre and l.activo and public.puede_ver_leccion(l.servicio_id, l.variante_id, l.mes)
       and public._semana_abierta(l.servicio_id, l.variante_id, l.semana));
$$;

-- No se puede entregar ni hacer el cuestionario de una semana que todavía no se abrió
create or replace function public._entrega_semana() returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$ declare l public.lecciones; begin
  if new.leccion_id is not null and not public.es_admin() then
    select * into l from public.lecciones where id = new.leccion_id;
    if l.id is not null and not public._semana_abierta(l.servicio_id, l.variante_id, l.semana) then
      raise exception 'SEMANA_BLOQUEADA' using errcode = '42501'; end if;
  end if; return new; end $$;
drop trigger if exists entregas_semana on public.entregas; drop trigger if exists a0_entregas_semana on public.entregas;
create trigger a0_entregas_semana before insert on public.entregas for each row execute function public._entrega_semana();
do $$ begin
  if to_regclass('public.aula_quiz_resultados') is not null and exists (select 1 from information_schema.columns where table_name = 'aula_quiz_resultados' and column_name = 'leccion_id') then
    execute 'drop trigger if exists quiz_semana on public.aula_quiz_resultados';
    execute 'create trigger quiz_semana before insert on public.aula_quiz_resultados for each row execute function public._entrega_semana()';
  end if; end $$;

-- Calendario para la alumna: qué semanas vienen y cuándo abren (solo título, sin el contenido)
create or replace function public.aula_semanas(p_curso text)
returns table (semana int, mes int, titulo text, abre date, abierta boolean)
language sql stable security definer set search_path = public, pg_temp
as $$
  select l.semana, l.mes, l.titulo, public._semana_abre(l.servicio_id, l.variante_id, l.semana),
         public._semana_abierta(l.servicio_id, l.variante_id, l.semana)
    from public.lecciones l
   where l.servicio_id = p_curso and l.activo and l.semana is not null and public.puede_ver_leccion(l.servicio_id, l.variante_id, l.mes)
     and (public.es_admin() or public._semana_abre(l.servicio_id, l.variante_id, l.semana) is not null)
   order by l.semana, l.orden;
$$;
revoke all on function public._semana_abre(text, text, int), public._semana_abierta(text, text, int), public.aula_semanas(text), public._entrega_semana() from public, anon;
grant execute on function public._semana_abierta(text, text, int), public.aula_semanas(text) to authenticated;
grant execute on function public._semana_abre(text, text, int) to authenticated;

-- Guías PDF base ya cargadas: semana = (mes-1)·4 + número de clase (títulos "Clase N · …")
update public.lecciones set semana = (mes - 1) * 4 + substring(titulo from '^Clase ([0-9]+) ·')::int
 where semana is null and archivo_nombre ~ '^[A-Z]+-M[0-9]+-C[0-9]+-.*\.pdf$' and titulo ~ '^Clase [0-9]+ ·';
notify pgrst, 'reload schema';
