-- =====================================================================
-- AULA VIRTUAL (Sala de clases) · Tania Sanabria Academy
-- Se ejecuta DESPUÉS de schema.sql, avisos.sql, cursos.sql y comprobantes.sql. IDEMPOTENTE.
--
-- Qué agrega:
--   * Registro abierto con email + contraseña (antes: solo con código de Tania). El acceso a las
--     CLASES sigue igual: solo a los cursos que Tania habilitó (inscripciones.acceso = true).
--   * perfiles: nombre y teléfono de cada alumna.
--   * aula_inscribirme(): la alumna ya registrada pide inscribirse a un curso desde el aula.
--   * entregas: trabajos prácticos SACADOS CON LA CÁMARA (bucket privado "entregas"),
--     con calificación (1 a 5) y comentario de la profesora.
-- Seguridad:
--   * Cada alumna ve SOLO su perfil, sus inscripciones y sus entregas (RLS).
--   * Solo puede entregar en cursos a los que tiene acceso. No puede ponerse nota ni editar la corrección.
--   * Fotos de entregas: cada una en la carpeta <user_id>/..., solo la dueña y Tania las ven.
--   * IMPORTANTE (panel de Supabase): Authentication → Sign In / Providers → Email → "Confirm email" = ON,
--     para que nadie pueda crear una cuenta con un email ajeno.
-- =====================================================================

-- 1. Hook "Before User Created": ahora deja registrarse a cualquier email (menos el de las admins,
--    que ya tienen cuenta). Si viene un código válido, lo sigue vinculando como antes.
create or replace function public.hook_antes_de_crear_usuario(event jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_email text := lower(coalesce(event -> 'user' ->> 'email', ''));
  v_id uuid;
begin
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'Email inválido.'));
  end if;
  if exists (select 1 from public.admins ad where ad.email = v_email) then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Este email no puede registrarse.'));
  end if;
  begin v_id := (event -> 'user' ->> 'id')::uuid; exception when others then v_id := null; end;
  if v_id is not null then update public.alumnos set user_id = v_id where email = v_email and user_id is null; end if;
  return '{}'::jsonb;
end $$;

-- Si Tania habilita a una alumna que YA tenía cuenta, vincularla al crear su ficha.
create or replace function public._alumno_vincular_existente()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.user_id is null then
    select u.id into new.user_id from auth.users u where lower(u.email) = new.email limit 1;
  end if;
  return new;
end $$;
drop trigger if exists alumno_vincular_existente on public.alumnos;
create trigger alumno_vincular_existente before insert on public.alumnos
  for each row execute function public._alumno_vincular_existente();

-- 2. Perfiles
create table if not exists public.perfiles (
  user_id uuid primary key default auth.uid(),
  email text not null check (email = lower(email) and length(email) <= 160),
  nombre text not null check (length(btrim(nombre)) between 2 and 120),
  telefono text not null default '' check (length(telefono) <= 30),
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
alter table public.perfiles enable row level security;
revoke all on public.perfiles from anon, authenticated;
grant select, insert, update on public.perfiles to authenticated;
drop policy if exists perfiles_propio on public.perfiles;
create policy perfiles_propio on public.perfiles for all to authenticated
  using (user_id = auth.uid() or public.es_admin())
  with check ((user_id = auth.uid() and email = lower(coalesce(auth.jwt() ->> 'email', ''))) or public.es_admin());

-- 3. Inscribirse desde el aula (usa la misma lógica, anti-spam y aviso push que la web)
create or replace function public.aula_inscribirme(p_curso text, p_notas text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare pf public.perfiles; v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  select * into pf from public.perfiles where user_id = auth.uid();
  if pf.user_id is null or length(regexp_replace(pf.telefono, '\D', '', 'g')) < 8 then raise exception 'COMPLETA_TU_PERFIL' using errcode = 'P0001'; end if;
  if exists (select 1 from public.inscripciones i where i.cliente_email = v_email and i.estado <> 'cancelada'
             and coalesce(i.variante_id, i.servicio_id) = p_curso) then raise exception 'YA_INSCRIPTA' using errcode = 'P0001'; end if;
  return public._crear_inscripcion(p_curso, pf.nombre, pf.telefono, v_email, p_notas);
end $$;

-- Mis inscripciones (también las pendientes, para mostrar "esperando aprobación")
create or replace function public.aula_mis_inscripciones()
returns table (id uuid, referencia text, servicio_id text, variante_id text, curso_nombre text, precio_ref text,
               monto_gs bigint, estado text, acceso boolean, creado timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  select i.id, i.referencia, i.servicio_id, i.variante_id, i.curso_nombre, i.precio_ref, i.monto_gs, i.estado, i.acceso, i.creado
  from public.inscripciones i
  where auth.uid() is not null and i.cliente_email = lower(coalesce(auth.jwt() ->> 'email', '')) and i.estado <> 'cancelada'
  order by i.creado desc;
$$;

-- 4. Entregas (trabajos prácticos con foto de cámara)
create table if not exists public.entregas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  servicio_id text not null references public.servicios (id) on delete cascade on update cascade,
  leccion_id uuid references public.lecciones (id) on delete set null,
  modulo text check (modulo is null or length(modulo) <= 120),
  titulo text not null check (length(btrim(titulo)) between 2 and 160),
  mensaje text not null default '' check (length(mensaje) <= 1000),
  fotos text[] not null check (cardinality(fotos) between 1 and 6),
  origen text not null default 'camara' check (origen = 'camara'),
  estado text not null default 'enviada' check (estado in ('enviada', 'corregida', 'rehacer')),
  calificacion smallint check (calificacion is null or calificacion between 1 and 5),
  comentario text check (comentario is null or length(comentario) <= 3000),
  corregida_en timestamptz,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index if not exists entregas_alumna_idx on public.entregas (user_id, creado desc);
create index if not exists entregas_curso_idx on public.entregas (servicio_id, estado, creado desc);

create or replace function public._entrega_validar()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare f text;
begin
  if tg_op = 'INSERT' and not public.es_admin() then
    new.user_id := auth.uid(); new.email := lower(coalesce(auth.jwt() ->> 'email', ''));
    new.estado := 'enviada'; new.calificacion := null; new.comentario := null; new.corregida_en := null; new.creado := now();
    if not public.tiene_acceso(new.servicio_id) then raise exception 'SIN_ACCESO_AL_CURSO' using errcode = '42501'; end if;
    foreach f in array new.fotos loop
      if f !~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}\.jpg$') then raise exception 'FOTO_INVALIDA' using errcode = 'P0001'; end if;
    end loop;
    -- anti-abuso: máx. 30 entregas por día
    if (select count(*) from public.entregas e where e.user_id = auth.uid() and e.creado > now() - interval '1 day') >= 30 then
      raise exception 'DEMASIADAS_ENTREGAS' using errcode = 'P0001'; end if;
  end if;
  new.actualizado := now();
  return new;
end $$;
drop trigger if exists entrega_validar on public.entregas;
create trigger entrega_validar before insert or update on public.entregas for each row execute function public._entrega_validar();

alter table public.entregas enable row level security;
revoke all on public.entregas from anon, authenticated;
grant select, delete on public.entregas to authenticated;
grant insert (servicio_id, leccion_id, modulo, titulo, mensaje, fotos) on public.entregas to authenticated;
grant update on public.entregas to authenticated;   -- solo admin por la política
drop policy if exists entregas_leer on public.entregas;
create policy entregas_leer on public.entregas for select to authenticated using (user_id = auth.uid() or public.es_admin());
drop policy if exists entregas_crear on public.entregas;
create policy entregas_crear on public.entregas for insert to authenticated
  with check ((user_id = auth.uid() and public.tiene_acceso(servicio_id)) or public.es_admin());
drop policy if exists entregas_admin_editar on public.entregas;
create policy entregas_admin_editar on public.entregas for update to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists entregas_borrar on public.entregas;
create policy entregas_borrar on public.entregas for delete to authenticated
  using (public.es_admin() or (user_id = auth.uid() and estado = 'enviada'));

-- Corregir (Tania)
create or replace function public.admin_calificar(p_id uuid, p_calificacion smallint, p_comentario text, p_estado text default 'corregida')
returns public.entregas language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare e public.entregas;
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  if p_estado not in ('corregida', 'rehacer') then raise exception 'ESTADO_INVALIDO' using errcode = 'P0001'; end if;
  update public.entregas set calificacion = p_calificacion, comentario = nullif(btrim(coalesce(p_comentario, '')), ''),
         estado = p_estado, corregida_en = now() where id = p_id returning * into e;
  if not found then raise exception 'ENTREGA_NO_EXISTE' using errcode = 'P0001'; end if;
  return e;
end $$;

-- Lista para Tania: entregas con nombre de la alumna
create or replace function public.admin_entregas(p_curso text default null, p_estado text default null)
returns table (id uuid, user_id uuid, email text, nombre text, telefono text, servicio_id text, curso text, modulo text, titulo text,
               mensaje text, fotos text[], estado text, calificacion smallint, comentario text, corregida_en timestamptz, creado timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  return query select e.id, e.user_id, e.email, coalesce(p.nombre, e.email), coalesce(p.telefono, ''), e.servicio_id, s.nombre, e.modulo, e.titulo,
         e.mensaje, e.fotos, e.estado, e.calificacion, e.comentario, e.corregida_en, e.creado
    from public.entregas e left join public.perfiles p on p.user_id = e.user_id left join public.servicios s on s.id = e.servicio_id
   where (p_curso is null or e.servicio_id = p_curso) and (p_estado is null or e.estado = p_estado)
   order by (e.estado = 'enviada') desc, e.creado desc limit 500;
end $$;

-- Lista para Tania: alumnas / inscripciones con su cuenta y promedio
create or replace function public.admin_alumnas()
returns table (inscripcion_id uuid, referencia text, email text, nombre text, telefono text, servicio_id text, curso text,
               estado text, acceso boolean, tiene_cuenta boolean, entregas int, pendientes int, promedio numeric, creado timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
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
   where i.estado <> 'cancelada'
   order by i.acceso, i.creado desc limit 1000;
end $$;

revoke all on function public.aula_inscribirme(text, text), public.aula_mis_inscripciones(), public._entrega_validar(),
  public.admin_calificar(uuid, smallint, text, text), public.admin_entregas(text, text), public.admin_alumnas(),
  public._alumno_vincular_existente() from public, anon;
grant execute on function public.aula_inscribirme(text, text), public.aula_mis_inscripciones(),
  public.admin_calificar(uuid, smallint, text, text), public.admin_entregas(text, text), public.admin_alumnas() to authenticated;

-- 5. Storage: bucket PRIVADO "entregas" (solo JPG de cámara, máx. 8 MB)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('entregas', 'entregas', false, 8388608, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.aula_tiene_algun_curso()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.mis_cursos()); $$;
revoke all on function public.aula_tiene_algun_curso() from public, anon;
grant execute on function public.aula_tiene_algun_curso() to authenticated;

drop policy if exists entregas_storage_subir on storage.objects;
create policy entregas_storage_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'entregas' and split_part(name, '/', 1) = auth.uid()::text
              and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' and public.aula_tiene_algun_curso());
drop policy if exists entregas_storage_leer on storage.objects;
create policy entregas_storage_leer on storage.objects for select to authenticated
  using (bucket_id = 'entregas' and (split_part(name, '/', 1) = auth.uid()::text or public.es_admin()));
drop policy if exists entregas_storage_borrar on storage.objects;
create policy entregas_storage_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'entregas' and (split_part(name, '/', 1) = auth.uid()::text or public.es_admin()));

select 'Aula lista' as resultado;
