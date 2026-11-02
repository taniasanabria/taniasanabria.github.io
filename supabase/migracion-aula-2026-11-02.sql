-- =====================================================================
-- AULA VIRTUAL · migración 2026-11-02 (IDEMPOTENTE: se puede correr más de una vez)
-- Requiere: schema.sql, cursos.sql, comprobantes.sql, aula.sql (ya aplicados).
--
-- Qué agrega:
--   1. Materiales por MES/MÓDULO (lecciones.mes) y por NIVEL (lecciones.variante_id = la opción/categoría
--      que eligió la alumna al inscribirse; vacío = para todos los niveles).
--   2. Bloqueo por pago: cada inscripción tiene meses_habilitados (1 al dar acceso = matrícula).
--      El mes siguiente se abre SOLO cuando Tania confirma la transferencia (aula_pagos).
--      Se aplica en la BASE (RLS de lecciones + política del bucket "cursos" + entregas), no solo en pantalla.
--   3. aula_pagos + bucket privado "pagos-aula": la alumna sube el comprobante de la cuota desde el aula;
--      Tania confirma o rechaza (en tiempo real en el panel).
--   4. Entregas: estado 'anulada_ia' (uso de IA en respuestas o fotos), derecho a volver a presentar
--      (reemplaza_id), mes de la clase y metadatos de la captura con cámara en vivo.
--   5. aula_examenes: la alumna online pide su examen por videollamada de WhatsApp; Tania lo agenda.
-- No cambia nada de reservas, app_docs ni la sincronización de la app.
-- =====================================================================

-- 1. Columnas nuevas (con valores por defecto: todo lo existente queda como "mes 1, todos los niveles")
alter table public.lecciones add column if not exists mes int not null default 1;
alter table public.lecciones add column if not exists variante_id text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'lecciones_mes_chk') then
    alter table public.lecciones add constraint lecciones_mes_chk check (mes between 1 and 36); end if;
  if not exists (select 1 from pg_constraint where conname = 'lecciones_variante_chk') then
    alter table public.lecciones add constraint lecciones_variante_chk check (variante_id is null or length(variante_id) <= 120); end if;
end $$;
create index if not exists lecciones_curso_mes_idx on public.lecciones (servicio_id, mes, orden);

alter table public.inscripciones add column if not exists meses_habilitados int not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inscripciones_meses_hab_chk') then
    alter table public.inscripciones add constraint inscripciones_meses_hab_chk check (meses_habilitados between 1 and 36); end if;
end $$;

alter table public.entregas add column if not exists mes int;
alter table public.entregas add column if not exists captura jsonb;
alter table public.entregas add column if not exists reemplaza_id uuid references public.entregas (id) on delete set null;
alter table public.entregas add column if not exists anulada_motivo text;
do $$ begin
  alter table public.entregas drop constraint if exists entregas_estado_check;
  if not exists (select 1 from pg_constraint where conname = 'entregas_estado_chk2') then
    alter table public.entregas add constraint entregas_estado_chk2 check (estado in ('enviada', 'corregida', 'rehacer', 'anulada_ia')); end if;
  if not exists (select 1 from pg_constraint where conname = 'entregas_mes_chk') then
    alter table public.entregas add constraint entregas_mes_chk check (mes is null or mes between 1 and 36); end if;
  if not exists (select 1 from pg_constraint where conname = 'entregas_captura_chk') then
    alter table public.entregas add constraint entregas_captura_chk check (captura is null or (jsonb_typeof(captura) = 'object' and length(captura::text) <= 4000)); end if;
  if not exists (select 1 from pg_constraint where conname = 'entregas_motivo_chk') then
    alter table public.entregas add constraint entregas_motivo_chk check (anulada_motivo is null or length(anulada_motivo) <= 1000); end if;
end $$;
grant insert (mes, captura, reemplaza_id) on public.entregas to authenticated;

-- 2. Reglas de acceso
-- Meses habilitados de la alumna en un curso (0 = sin acceso). Si tiene más de una inscripción, la mayor.
create or replace function public._meses_habilitados(p_curso text, p_variante text default null)
returns int language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(max(i.meses_habilitados), 0)::int
    from public.alumnos a join public.inscripciones i on i.cliente_email = a.email
   where auth.uid() is not null and a.user_id = auth.uid() and a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
     and i.servicio_id = p_curso and i.acceso and i.estado <> 'cancelada'
     and (p_variante is null or i.variante_id = p_variante);
$$;
-- ¿Puede ver esta clase? Curso con acceso + su nivel (o material para todos) + mes ya pagado y confirmado.
create or replace function public.puede_ver_leccion(p_curso text, p_variante text, p_mes int)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select public.es_admin() or coalesce(p_mes, 1) <= public._meses_habilitados(p_curso, p_variante); $$;

drop policy if exists lecciones_alumna on public.lecciones;
create policy lecciones_alumna on public.lecciones for select to authenticated
  using (activo and public.puede_ver_leccion(servicio_id, variante_id, mes));

-- Archivos del bucket "cursos": mismas reglas (un PDF de un mes bloqueado no se puede descargar)
create or replace function public.puede_ver_archivo(p_nombre text)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.es_admin() or exists (
    select 1 from public.lecciones l where l.archivo = p_nombre and l.activo and public.puede_ver_leccion(l.servicio_id, l.variante_id, l.mes));
$$;

-- Programa del curso para la alumna: qué meses hay y cuáles están abiertos (sin mostrar el contenido bloqueado)
create or replace function public.aula_programa(p_curso text)
returns table (mes int, modulos text[], clases int, abierto boolean)
language sql stable security definer set search_path = public, pg_temp
as $$
  with mias as (
    select i.variante_id, i.meses_habilitados from public.alumnos a join public.inscripciones i on i.cliente_email = a.email
     where auth.uid() is not null and a.user_id = auth.uid() and a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
       and i.servicio_id = p_curso and i.acceso and i.estado <> 'cancelada')
  select l.mes, array_agg(distinct coalesce(l.modulo, 'General')), count(*)::int,
         bool_or(public.puede_ver_leccion(l.servicio_id, l.variante_id, l.mes))
    from public.lecciones l
   where l.servicio_id = p_curso and l.activo and exists (select 1 from mias)
     and (l.variante_id is null or l.variante_id in (select variante_id from mias))
   group by l.mes order by l.mes;
$$;

-- 3. Pagos mensuales por transferencia
create table if not exists public.aula_pagos (
  id uuid primary key default gen_random_uuid(),
  inscripcion_id uuid not null references public.inscripciones (id) on delete cascade,
  user_id uuid not null,
  mes int not null check (mes between 2 and 36),
  ruta text not null check (ruta ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'),
  monto_gs bigint check (monto_gs is null or monto_gs >= 0),
  nota text check (nota is null or length(nota) <= 500),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'confirmado', 'rechazado')),
  respuesta text check (respuesta is null or length(respuesta) <= 1000),
  revisado_en timestamptz,
  creado timestamptz not null default now()
);
create unique index if not exists aula_pagos_unico_idx on public.aula_pagos (inscripcion_id, mes) where estado <> 'rechazado';
create index if not exists aula_pagos_estado_idx on public.aula_pagos (estado, creado desc);
alter table public.aula_pagos enable row level security;
revoke all on public.aula_pagos from anon, authenticated;
grant select on public.aula_pagos to authenticated;
drop policy if exists aula_pagos_leer on public.aula_pagos;
create policy aula_pagos_leer on public.aula_pagos for select to authenticated using (user_id = auth.uid() or public.es_admin());
drop policy if exists aula_pagos_admin on public.aula_pagos;
create policy aula_pagos_admin on public.aula_pagos for all to authenticated using (public.es_admin()) with check (public.es_admin());
grant insert, update, delete on public.aula_pagos to authenticated;  -- solo admin por la política; la alumna usa aula_enviar_pago()

-- Avance de la alumna: una fila por inscripción con acceso
create or replace function public.aula_mi_avance()
returns table (inscripcion_id uuid, servicio_id text, variante_id text, curso_nombre text, meses_habilitados int,
               meses_curso int, cuota_gs bigint, pago_pendiente_mes int)
language sql stable security definer set search_path = public, pg_temp
as $$
  select i.id, i.servicio_id, i.variante_id, i.curso_nombre, i.meses_habilitados,
         greatest(coalesce((select max(l.mes) from public.lecciones l where l.servicio_id = i.servicio_id and l.activo
                             and (l.variante_id is null or l.variante_id = i.variante_id)), 1), i.meses_habilitados)::int,
         nullif((public._monto_curso(i.precio_ref) ->> 'curso')::bigint, 0),
         (select min(p.mes) from public.aula_pagos p where p.inscripcion_id = i.id and p.estado = 'pendiente')
    from public.alumnos a join public.inscripciones i on i.cliente_email = a.email
   where auth.uid() is not null and a.user_id = auth.uid() and a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
     and i.acceso and i.estado <> 'cancelada'
   order by i.creado;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pagos-aula', 'pagos-aula', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists pagos_aula_subir on storage.objects;
create policy pagos_aula_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'pagos-aula' and split_part(name, '/', 1) = auth.uid()::text
              and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$' and public.aula_tiene_algun_curso());
drop policy if exists pagos_aula_leer on storage.objects;
create policy pagos_aula_leer on storage.objects for select to authenticated
  using (bucket_id = 'pagos-aula' and (split_part(name, '/', 1) = auth.uid()::text or public.es_admin()));
drop policy if exists pagos_aula_borrar on storage.objects;
create policy pagos_aula_borrar on storage.objects for delete to authenticated using (bucket_id = 'pagos-aula' and public.es_admin());

-- Datos bancarios: solo a la alumna dueña de una inscripción con acceso, cuando confirma que va a pagar.
create or replace function public.aula_datos_pago(p_inscripcion uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare i public.inscripciones; p public.ajustes_privados;
begin
  select ins.* into i from public.inscripciones ins join public.alumnos a on a.email = ins.cliente_email
   where ins.id = p_inscripcion and a.user_id = auth.uid() and a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
     and ins.acceso and ins.estado <> 'cancelada';
  if i.id is null then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  select * into p from public.ajustes_privados where id = 1;
  return jsonb_build_object('referencia', i.referencia, 'curso', i.curso_nombre, 'datos_pago', coalesce(p.datos_pago, ''),
    'cuota_gs', nullif((public._monto_curso(i.precio_ref) ->> 'curso')::bigint, 0));
end $$;

-- La alumna registra el comprobante del mes siguiente (solo el próximo mes, uno pendiente a la vez).
create or replace function public.aula_enviar_pago(p_inscripcion uuid, p_ruta text, p_nota text default null)
returns public.aula_pagos language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare i public.inscripciones; r public.aula_pagos;
begin
  select ins.* into i from public.inscripciones ins join public.alumnos a on a.email = ins.cliente_email
   where ins.id = p_inscripcion and a.user_id = auth.uid() and a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
     and ins.acceso and ins.estado <> 'cancelada';
  if i.id is null then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  if p_ruta is null or p_ruta !~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$') then raise exception 'COMPROBANTE_INVALIDO' using errcode = 'P0001'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'pagos-aula' and o.name = p_ruta) then raise exception 'COMPROBANTE_INVALIDO' using errcode = 'P0001'; end if;
  if exists (select 1 from public.aula_pagos x where x.inscripcion_id = i.id and x.estado = 'pendiente') then raise exception 'PAGO_YA_ENVIADO' using errcode = 'P0001'; end if;
  insert into public.aula_pagos (inscripcion_id, user_id, mes, ruta, monto_gs, nota)
  values (i.id, auth.uid(), i.meses_habilitados + 1, p_ruta, nullif((public._monto_curso(i.precio_ref) ->> 'curso')::bigint, 0),
          nullif(btrim(coalesce(p_nota, '')), ''))
  returning * into r;
  return r;
end $$;

-- Tania confirma (abre el mes) o rechaza el comprobante.
create or replace function public.admin_revisar_pago_aula(p_id uuid, p_ok boolean, p_respuesta text default null)
returns public.aula_pagos language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare r public.aula_pagos;
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  update public.aula_pagos set estado = case when p_ok then 'confirmado' else 'rechazado' end,
         respuesta = nullif(btrim(coalesce(p_respuesta, '')), ''), revisado_en = now()
   where id = p_id returning * into r;
  if r.id is null then raise exception 'PAGO_NO_EXISTE' using errcode = 'P0001'; end if;
  if p_ok then update public.inscripciones set meses_habilitados = greatest(meses_habilitados, r.mes) where id = r.inscripcion_id; end if;
  return r;
end $$;

-- Tania fija a mano los meses abiertos (pago en efectivo, corrección). Mínimo 1.
create or replace function public.admin_meses_aula(p_inscripcion uuid, p_meses int)
returns int language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare v int;
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  update public.inscripciones set meses_habilitados = greatest(1, least(36, p_meses)) where id = p_inscripcion returning meses_habilitados into v;
  if v is null then raise exception 'INSCRIPCION_NO_EXISTE' using errcode = 'P0001'; end if;
  return v;
end $$;

create or replace function public.admin_pagos_aula(p_estado text default 'pendiente')
returns table (id uuid, inscripcion_id uuid, mes int, ruta text, monto_gs bigint, nota text, estado text, respuesta text, creado timestamptz,
               nombre text, telefono text, email text, curso text, variante_id text, meses_habilitados int)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  return query select p.id, p.inscripcion_id, p.mes, p.ruta, p.monto_gs, p.nota, p.estado, p.respuesta, p.creado,
         coalesce(pf.nombre, i.cliente_nombre), coalesce(nullif(pf.telefono, ''), i.cliente_telefono), i.cliente_email, i.curso_nombre, i.variante_id, i.meses_habilitados
    from public.aula_pagos p join public.inscripciones i on i.id = p.inscripcion_id
    left join public.perfiles pf on pf.user_id = p.user_id
   where p_estado is null or p.estado = p_estado
   order by p.creado desc limit 500;
end $$;

-- 4. Entregas: mes bloqueado, captura con cámara, anulación por IA y reentrega
create or replace function public._entrega_validar_mes()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_hab int; l public.lecciones; prev public.entregas;
begin
  if public.es_admin() then return new; end if;
  v_hab := public._meses_habilitados(new.servicio_id);
  if v_hab < 1 then raise exception 'SIN_ACCESO_AL_CURSO' using errcode = '42501'; end if;
  if new.leccion_id is not null then
    select * into l from public.lecciones where id = new.leccion_id;
    if l.id is null or l.servicio_id <> new.servicio_id or not l.activo or not public.puede_ver_leccion(l.servicio_id, l.variante_id, l.mes) then
      raise exception 'MES_BLOQUEADO' using errcode = '42501'; end if;
    new.mes := l.mes;
  end if;
  if new.mes is null then new.mes := v_hab; end if;
  if new.mes > v_hab then raise exception 'MES_BLOQUEADO' using errcode = '42501'; end if;
  if new.reemplaza_id is not null then
    select * into prev from public.entregas where id = new.reemplaza_id;
    if prev.id is null or prev.user_id <> auth.uid() or prev.estado not in ('anulada_ia', 'rehacer') then
      raise exception 'REENTREGA_INVALIDA' using errcode = 'P0001'; end if;
  end if;
  new.captura := coalesce(new.captura, '{}'::jsonb) || jsonb_build_object('recibida', now());
  new.anulada_motivo := null;
  return new;
end $$;
drop trigger if exists entrega_validar_mes on public.entregas;
create trigger entrega_validar_mes before insert on public.entregas for each row execute function public._entrega_validar_mes();

create or replace function public.admin_calificar(p_id uuid, p_calificacion smallint, p_comentario text, p_estado text default 'corregida')
returns public.entregas language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare e public.entregas;
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  if p_estado not in ('corregida', 'rehacer', 'anulada_ia') then raise exception 'ESTADO_INVALIDO' using errcode = 'P0001'; end if;
  update public.entregas set calificacion = case when p_estado = 'anulada_ia' then null else p_calificacion end,
         comentario = nullif(btrim(coalesce(p_comentario, '')), ''),
         anulada_motivo = case when p_estado = 'anulada_ia' then coalesce(nullif(btrim(coalesce(p_comentario, '')), ''), 'Uso de inteligencia artificial') else null end,
         estado = p_estado, corregida_en = now() where id = p_id returning * into e;
  if not found then raise exception 'ENTREGA_NO_EXISTE' using errcode = 'P0001'; end if;
  return e;
end $$;


-- Lista para Tania con mes, datos de la captura y reentregas (la vieja admin_entregas queda igual)
create or replace function public.admin_entregas2(p_curso text default null, p_estado text default null)
returns table (id uuid, user_id uuid, email text, nombre text, telefono text, servicio_id text, curso text, modulo text, titulo text,
               mensaje text, fotos text[], estado text, calificacion smallint, comentario text, corregida_en timestamptz, creado timestamptz,
               mes int, captura jsonb, reemplaza_id uuid, anulada_motivo text)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  return query select e.id, e.user_id, e.email, coalesce(p.nombre, e.email), coalesce(p.telefono, ''), e.servicio_id, s.nombre, e.modulo, e.titulo,
         e.mensaje, e.fotos, e.estado, e.calificacion, e.comentario, e.corregida_en, e.creado, e.mes, e.captura, e.reemplaza_id, e.anulada_motivo
    from public.entregas e left join public.perfiles p on p.user_id = e.user_id left join public.servicios s on s.id = e.servicio_id
   where (p_curso is null or e.servicio_id = p_curso) and (p_estado is null or e.estado = p_estado)
   order by (e.estado = 'enviada') desc, e.creado desc limit 500;
end $$;

-- 5. Exámenes por videollamada de WhatsApp (alumnas online)
create table if not exists public.aula_examenes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  servicio_id text not null references public.servicios (id) on delete cascade on update cascade,
  mes int not null default 1 check (mes between 1 and 36),
  preferencia text not null default '' check (length(preferencia) <= 300),
  estado text not null default 'solicitado' check (estado in ('solicitado', 'agendado', 'aprobado', 'desaprobado', 'cancelado')),
  fecha timestamptz,
  nota_profe text check (nota_profe is null or length(nota_profe) <= 1000),
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index if not exists aula_examenes_idx on public.aula_examenes (estado, creado desc);
alter table public.aula_examenes enable row level security;
revoke all on public.aula_examenes from anon, authenticated;
grant select on public.aula_examenes to authenticated;
drop policy if exists aula_examenes_leer on public.aula_examenes;
create policy aula_examenes_leer on public.aula_examenes for select to authenticated using (user_id = auth.uid() or public.es_admin());

create or replace function public.aula_pedir_examen(p_curso text, p_preferencia text default '')
returns public.aula_examenes language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare v_hab int := public._meses_habilitados(p_curso); r public.aula_examenes;
begin
  if v_hab < 1 then raise exception 'SIN_ACCESO_AL_CURSO' using errcode = '42501'; end if;
  if exists (select 1 from public.aula_examenes x where x.user_id = auth.uid() and x.servicio_id = p_curso and x.estado in ('solicitado', 'agendado')) then
    raise exception 'EXAMEN_YA_PEDIDO' using errcode = 'P0001'; end if;
  insert into public.aula_examenes (user_id, servicio_id, mes, preferencia)
  values (auth.uid(), p_curso, v_hab, left(btrim(coalesce(p_preferencia, '')), 300)) returning * into r;
  return r;
end $$;

create or replace function public.admin_examen(p_id uuid, p_estado text, p_fecha timestamptz default null, p_nota text default null)
returns public.aula_examenes language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare r public.aula_examenes;
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  update public.aula_examenes set estado = p_estado, fecha = coalesce(p_fecha, fecha), nota_profe = coalesce(nullif(btrim(coalesce(p_nota, '')), ''), nota_profe), actualizado = now()
   where id = p_id returning * into r;
  if r.id is null then raise exception 'EXAMEN_NO_EXISTE' using errcode = 'P0001'; end if;
  return r;
end $$;

create or replace function public.admin_examenes_aula()
returns table (id uuid, servicio_id text, curso text, mes int, preferencia text, estado text, fecha timestamptz, nota_profe text, creado timestamptz,
               nombre text, telefono text, email text)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  return query select x.id, x.servicio_id, s.nombre, x.mes, x.preferencia, x.estado, x.fecha, x.nota_profe, x.creado,
         coalesce(pf.nombre, ''), coalesce(pf.telefono, ''), coalesce(pf.email, '')
    from public.aula_examenes x left join public.servicios s on s.id = x.servicio_id left join public.perfiles pf on pf.user_id = x.user_id
   where x.estado <> 'cancelado' order by (x.estado in ('solicitado', 'agendado')) desc, x.creado desc limit 300;
end $$;

-- Permisos de funciones
revoke all on function public._meses_habilitados(text, text), public.puede_ver_leccion(text, text, int), public.aula_programa(text),
  public.aula_mi_avance(), public.aula_datos_pago(uuid), public.aula_enviar_pago(uuid, text, text),
  public.admin_revisar_pago_aula(uuid, boolean, text), public.admin_meses_aula(uuid, int), public.admin_pagos_aula(text),
  public._entrega_validar_mes(), public.aula_pedir_examen(text, text), public.admin_examen(uuid, text, timestamptz, text),
  public.admin_examenes_aula(), public.admin_entregas2(text, text) from public, anon;
revoke all on function public._entrega_validar_mes() from authenticated;
grant execute on function public._meses_habilitados(text, text), public.puede_ver_leccion(text, text, int), public.aula_programa(text),
  public.aula_mi_avance(), public.aula_datos_pago(uuid), public.aula_enviar_pago(uuid, text, text),
  public.admin_revisar_pago_aula(uuid, boolean, text), public.admin_meses_aula(uuid, int), public.admin_pagos_aula(text),
  public.aula_pedir_examen(text, text), public.admin_examen(uuid, text, timestamptz, text), public.admin_examenes_aula(), public.admin_entregas2(text, text) to authenticated;

-- Tiempo real (panel y aula)
do $$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['aula_pagos', 'aula_examenes', 'entregas'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

select 'migracion-aula OK' as resultado;
