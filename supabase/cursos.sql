-- =====================================================================
-- Cursos online: inscripciones, pago (transferencia/QR hoy; tarjeta después),
-- alumnas con código de acceso y clases protegidas por RLS.
-- Se ejecuta DESPUÉS de schema.sql y avisos.sql. Es IDEMPOTENTE (se puede volver a correr).
--
-- Resumen de seguridad:
--   * Público (anon): solo crea inscripciones con crear_inscripcion() (valida curso, datos y
--     límites anti-spam). Nunca lee inscripciones, alumnas ni clases.
--   * Alumnas: entran en /alumnas/ con su email + el código que les pasa Tania por WhatsApp.
--     La cuenta solo se puede crear si email + código coinciden con una alumna habilitada
--     (hook "Before User Created" → public.hook_antes_de_crear_usuario). Cada alumna ve SOLO
--     las clases de los cursos a los que Tania le dio acceso (RLS en lecciones y en Storage).
--   * Admin (Tania): todo, desde la pestaña "Cursos" del panel.
--   * Aviso push: cada inscripción crea además una fila en reservas (pendiente, origen web), así
--     el trigger y la Edge Function avisar-reserva que YA están instalados avisan sin redeploy.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Ajustes: imagen del QR de pago (archivo en el bucket público "fotos")
-- ---------------------------------------------------------------------
alter table public.ajustes_privados add column if not exists qr_pago text;
alter table public.ajustes_privados drop constraint if exists ajustes_privados_qr_pago_check;
alter table public.ajustes_privados add constraint ajustes_privados_qr_pago_check
  check (qr_pago is null or qr_pago ~ '^qr-[0-9a-f-]{36}\.(webp|jpg|png)$');
alter table public.ajustes_privados add column if not exists mensaje_acceso text not null default
  '¡Hola {nombre}! 💄 Soy Tania Sanabria. Ya tenés acceso a las clases de *{curso}* ✅' || chr(10) || chr(10) ||
  'Entrá en {enlace}' || chr(10) || 'Email: {email}' || chr(10) || 'Código: *{codigo}*' || chr(10) || chr(10) ||
  'Guardá este mensaje: con ese código entrás siempre. ¡Bienvenida!';

-- ---------------------------------------------------------------------
-- 2. Tablas
-- ---------------------------------------------------------------------
-- Alfabeto sin letras/números confundibles (sin I, O, 0, 1). 32 símbolos.
create or replace function public._aleatorio(n int)
returns text language sql volatile security definer set search_path = public, extensions, pg_temp
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 32) + 1, 1), '' order by i)
  from (select extensions.gen_random_bytes(n) as b) x, generate_series(0, n - 1) i;
$$;
create or replace function public._referencia_nueva()
returns text language sql volatile security definer set search_path = public, pg_temp
as $$ select 'C-' || public._aleatorio(5); $$;

create table if not exists public.inscripciones (
  id uuid primary key default gen_random_uuid(),
  referencia text not null unique default public._referencia_nueva(),
  servicio_id text references public.servicios (id) on delete set null on update cascade,
  variante_id text,
  curso_nombre text not null check (length(curso_nombre) between 2 and 200),
  precio_ref text check (precio_ref is null or length(precio_ref) <= 300),
  monto_gs bigint check (monto_gs is null or monto_gs >= 0),        -- lo que se paga al inscribirse
  cliente_nombre text not null check (length(cliente_nombre) between 2 and 120),
  cliente_telefono text not null check (length(cliente_telefono) between 6 and 30),
  cliente_email text not null check (cliente_email = lower(cliente_email) and length(cliente_email) <= 160
                                     and cliente_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  notas text check (notas is null or length(notas) <= 1000),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'pagada', 'cancelada')),
  acceso boolean not null default false,
  pago_metodo text check (pago_metodo is null or pago_metodo in ('transferencia', 'qr', 'tarjeta', 'efectivo', 'otro')),
  pago_ref text check (pago_ref is null or length(pago_ref) <= 200),   -- nro. de comprobante / id de la pasarela
  pagado_en timestamptz,
  acceso_desde timestamptz,
  origen text not null default 'web' check (origen in ('web', 'admin')),
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index if not exists inscripciones_estado_idx on public.inscripciones (estado, creado desc);
create index if not exists inscripciones_email_idx on public.inscripciones (cliente_email);

-- Alumnas: una fila por email. El código es su contraseña para /alumnas/ (Tania lo ve y lo reenvía).
create table if not exists public.alumnos (
  email text primary key check (email = lower(email) and length(email) <= 160),
  codigo text not null unique check (codigo ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'),
  user_id uuid unique,                 -- se completa solo cuando ella crea su cuenta
  creado timestamptz not null default now()
);

-- Clases de cada curso: video (YouTube/Drive), archivo (PDF o foto en Storage "cursos") o enlace.
create table if not exists public.lecciones (
  id uuid primary key default gen_random_uuid(),
  servicio_id text not null references public.servicios (id) on delete cascade on update cascade,
  modulo text check (modulo is null or length(modulo) <= 120),
  titulo text not null check (length(titulo) between 1 and 160),
  descripcion text not null default '' check (length(descripcion) <= 4000),
  tipo text not null check (tipo in ('video', 'archivo', 'enlace')),
  url text check (url is null or (url ~ '^https://[^\s]+$' and length(url) <= 1000)),
  archivo text check (archivo is null or archivo ~ '^[a-z0-9-]+/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$'),
  archivo_nombre text check (archivo_nombre is null or length(archivo_nombre) <= 200),
  archivo_bytes bigint,
  orden int not null default 0,
  activo boolean not null default true,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  constraint lecciones_contenido check (
    (tipo = 'archivo' and archivo is not null) or (tipo in ('video', 'enlace') and url is not null))
);
create index if not exists lecciones_curso_idx on public.lecciones (servicio_id, orden);

-- Cada inscripción tiene su "reserva espejo" (solo para el aviso push y el contador de pendientes).
alter table public.reservas add column if not exists inscripcion_id uuid references public.inscripciones (id) on delete cascade;
create unique index if not exists reservas_inscripcion_idx on public.reservas (inscripcion_id) where inscripcion_id is not null;

-- ---------------------------------------------------------------------
-- 3. Funciones auxiliares
-- ---------------------------------------------------------------------
-- "Gs. 450.000 mensual + Matrícula Gs. 100.000" → {curso: 450000, matricula: 100000, total: 550000, mensual: true}
-- "Gs. 350.000 + Matrícula Gs. 100.000 (total Gs. 450.000)" → total 450000 · "Gs. 600.000 (Taller + Matrícula)" → 600000
-- (La misma regla está en js/render.js → montoCurso(); si cambia una, cambiar la otra.)
create or replace function public._monto_curso(p_texto text)
returns jsonb language plpgsql immutable set search_path = public, pg_temp
as $$
declare
  t text := coalesce(p_texto, '');
  v_curso bigint; v_mat bigint; v_total bigint;
  num text := '(\d{1,3}(?:\.\d{3})+|\d+)';
begin
  v_curso := replace((regexp_match(t, num))[1], '.', '')::bigint;
  v_mat := replace((regexp_match(t, 'matr[ií]cula[^0-9(]*gs\.?\s*' || num, 'i'))[1], '.', '')::bigint;
  v_total := replace((regexp_match(t, 'total[^0-9]*gs\.?\s*' || num, 'i'))[1], '.', '')::bigint;
  if v_total is null and v_curso is not null then v_total := v_curso + coalesce(v_mat, 0); end if;
  return jsonb_build_object('curso', v_curso, 'matricula', v_mat, 'total', v_total,
                            'mensual', t ~* '(mensual|/\s*mes|por mes)');
end $$;

create or replace function public._gs(n bigint)
returns text language sql immutable as $$ select 'Gs. ' || replace(to_char(n, 'FM999G999G999G999'), ',', '.'); $$;

-- ¿La usuaria conectada tiene acceso a este curso? (alumna vinculada a su cuenta + acceso habilitado)
create or replace function public.tiene_acceso(p_curso text)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.alumnos a
    join public.inscripciones i on i.cliente_email = a.email
    where a.user_id = auth.uid()
      and a.email = lower(coalesce(auth.jwt() ->> 'email', ''))   -- si cambia el email de la cuenta, pierde el acceso
      and i.servicio_id = p_curso and i.acceso and i.estado <> 'cancelada');
$$;

-- ¿Puede descargar este archivo de Storage? (lo usa la política del bucket "cursos")
create or replace function public.puede_ver_archivo(p_nombre text)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.es_admin() or exists (
    select 1 from public.lecciones l where l.archivo = p_nombre and l.activo and public.tiene_acceso(l.servicio_id));
$$;

drop trigger if exists inscripciones_actualizado on public.inscripciones;
create trigger inscripciones_actualizado before update on public.inscripciones
  for each row execute function public._tocar_actualizado();
drop trigger if exists lecciones_actualizado on public.lecciones;
create trigger lecciones_actualizado before update on public.lecciones
  for each row execute function public._tocar_actualizado();

-- Mantiene la reserva espejo al día (pendiente / pagada / cancelada) y quita el acceso si se cancela.
create or replace function public._inscripciones_sync()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.estado = 'cancelada' and old.estado <> 'cancelada' then
    new.acceso := false;
  end if;
  if new.estado = 'pagada' and new.pagado_en is null then new.pagado_en := now(); end if;
  if new.acceso and not coalesce(old.acceso, false) and new.acceso_desde is null then new.acceso_desde := now(); end if;
  return new;
end $$;
drop trigger if exists inscripciones_sync on public.inscripciones;
create trigger inscripciones_sync before insert or update on public.inscripciones
  for each row execute function public._inscripciones_sync();

create or replace function public._inscripciones_espejo()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.reservas set estado = new.estado
   where inscripcion_id = new.id and estado is distinct from new.estado;
  return null;
end $$;
drop trigger if exists inscripciones_espejo on public.inscripciones;
create trigger inscripciones_espejo after update of estado on public.inscripciones
  for each row execute function public._inscripciones_espejo();

-- ---------------------------------------------------------------------
-- 4. Inscripción pública (RPC)
-- ---------------------------------------------------------------------
create or replace function public._crear_inscripcion(p_curso text, p_nombre text, p_telefono text, p_email text, p_notas text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  s public.servicios;
  v_var jsonb;
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_tel text := btrim(coalesce(p_telefono, ''));
  v_dig text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_notas text := nullif(btrim(coalesce(p_notas, '')), '');
  v_curso text; v_precio text; v_monto jsonb; v_id uuid; v_ref text;
  p public.ajustes_privados;
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
      where i.origen = 'web' and i.estado = 'pendiente' and i.creado > now() - interval '1 day'
        and (right(regexp_replace(i.cliente_telefono, '\D', '', 'g'), 9) = right(v_dig, 9) or i.cliente_email = v_email)) >= 3
     or (select count(*) from public.inscripciones i where i.origen = 'web' and i.creado > now() - interval '10 minutes') >= 30 then
    raise exception 'DEMASIADAS_SOLICITUDES' using errcode = 'P0001';
  end if;

  v_curso := coalesce(v_var ->> 'nombreReserva', s.extra ->> 'nombreReserva', s.nombre);
  v_precio := coalesce(v_var ->> 'precioReserva', v_var ->> 'precio', s.precio_reserva_texto, s.precio_texto);
  v_monto := public._monto_curso(v_precio);

  insert into public.inscripciones (servicio_id, variante_id, curso_nombre, precio_ref, monto_gs,
                                    cliente_nombre, cliente_telefono, cliente_email, notas, origen)
  values (s.id, case when v_var is not null then p_curso end, v_curso, v_precio, (v_monto ->> 'total')::bigint,
          v_nombre, v_tel, v_email, v_notas, 'web')
  returning id, referencia into v_id, v_ref;

  -- Reserva espejo: dispara el aviso push ya instalado (trigger avisar_reserva → Edge Function).
  insert into public.reservas (servicio_id, variante_id, servicio_nombre, precio_ref, bloquea, cliente_nombre,
                               cliente_telefono, cliente_email, notas, pago, estado, origen, inscripcion_id)
  values (s.id, case when v_var is not null then p_curso end, 'Inscripción: ' || v_curso, v_precio, false, v_nombre,
          v_tel, v_email, 'Ref. ' || v_ref || coalesce(' · a pagar ' || public._gs((v_monto ->> 'total')::bigint), '')
                          || coalesce(' · ' || v_notas, ''), 'total', 'pendiente', 'web', v_id);

  select * into p from public.ajustes_privados where id = 1;
  return jsonb_build_object(
    'ok', true, 'id', v_id, 'referencia', v_ref, 'curso', v_curso, 'precio', v_precio,
    'monto_gs', (v_monto ->> 'total')::bigint, 'matricula_gs', (v_monto ->> 'matricula')::bigint,
    'curso_gs', (v_monto ->> 'curso')::bigint, 'mensual', (v_monto ->> 'mensual')::boolean,
    -- Los datos de pago se entregan recién después de inscribirse (no se publican en el sitio).
    'datos_pago', coalesce(p.datos_pago, ''), 'qr_pago', p.qr_pago);
end $$;

create or replace function public.crear_inscripcion(p_curso text, p_nombre text, p_telefono text, p_email text, p_notas text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  return public._crear_inscripcion(p_curso, p_nombre, p_telefono, p_email, p_notas);
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

-- ---------------------------------------------------------------------
-- 5. Pago y acceso
-- ---------------------------------------------------------------------
-- Alumna (email) con su código; lo crea si no existe. Devuelve el código.
create or replace function public._asegurar_alumno(p_email text)
returns text language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare v_cod text;
begin
  select codigo into v_cod from public.alumnos where email = lower(p_email);
  if v_cod is not null then return v_cod; end if;
  loop
    v_cod := public._aleatorio(4) || '-' || public._aleatorio(4);
    begin
      insert into public.alumnos (email, codigo) values (lower(p_email), v_cod);
      return v_cod;
    exception when unique_violation then
      select codigo into v_cod from public.alumnos where email = lower(p_email);
      if v_cod is not null then return v_cod; end if;  -- otra transacción la creó
    end;
  end loop;
end $$;

-- Punto único para registrar un pago. Hoy lo usa el panel; mañana, el webhook de la pasarela
-- de tarjeta (uPay/Bancard) desde una Edge Function con la service key:
--   select public._registrar_pago('<id>', 'tarjeta', '<id de la transacción>', true, <monto cobrado>);
create or replace function public._registrar_pago(p_id uuid, p_metodo text, p_ref text default null,
                                                  p_dar_acceso boolean default true, p_monto_gs bigint default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare i public.inscripciones; v_cod text;
begin
  select * into i from public.inscripciones where id = p_id for update;
  if not found then raise exception 'INSCRIPCION_NO_EXISTE' using errcode = 'P0001'; end if;
  if i.estado = 'cancelada' then raise exception 'INSCRIPCION_CANCELADA' using errcode = 'P0001'; end if;
  if p_monto_gs is not null and i.monto_gs is not null and p_monto_gs < i.monto_gs then
    raise exception 'MONTO_INSUFICIENTE' using errcode = 'P0001';
  end if;
  update public.inscripciones
     set estado = 'pagada', pago_metodo = coalesce(p_metodo, pago_metodo), pago_ref = coalesce(nullif(btrim(p_ref), ''), pago_ref),
         acceso = acceso or p_dar_acceso
   where id = p_id returning * into i;
  if i.acceso then v_cod := public._asegurar_alumno(i.cliente_email); end if;
  return jsonb_build_object('ok', true, 'id', i.id, 'estado', i.estado, 'acceso', i.acceso, 'email', i.cliente_email, 'codigo', v_cod);
end $$;

create or replace function public.admin_registrar_pago(p_id uuid, p_metodo text, p_ref text default null, p_dar_acceso boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  if p_metodo is not null and p_metodo not in ('transferencia', 'qr', 'efectivo', 'otro') then
    raise exception 'METODO_INVALIDO' using errcode = 'P0001';
  end if;
  return public._registrar_pago(p_id, p_metodo, p_ref, p_dar_acceso, null);
end $$;

-- Dar o quitar acceso a las clases (sin tocar el estado del pago).
create or replace function public.admin_dar_acceso(p_id uuid, p_acceso boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare i public.inscripciones; v_cod text;
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  update public.inscripciones set acceso = p_acceso where id = p_id and estado <> 'cancelada' returning * into i;
  if not found then raise exception 'INSCRIPCION_NO_DISPONIBLE' using errcode = 'P0001'; end if;
  if i.acceso then v_cod := public._asegurar_alumno(i.cliente_email); end if;
  return jsonb_build_object('ok', true, 'id', i.id, 'acceso', i.acceso, 'email', i.cliente_email, 'codigo', v_cod,
                            'cuenta_creada', exists (select 1 from public.alumnos a where a.email = i.cliente_email and a.user_id is not null));
end $$;

-- ---------------------------------------------------------------------
-- 6. Alumnas: sus cursos (las clases se leen directo de la tabla, con RLS)
-- ---------------------------------------------------------------------
create or replace function public.mis_cursos()
returns table (servicio_id text, nombre text, curso_nombre text, clases int)
language sql stable security definer set search_path = public, pg_temp
as $$
  select distinct on (i.servicio_id) i.servicio_id, s.nombre, i.curso_nombre,
         (select count(*)::int from public.lecciones l where l.servicio_id = i.servicio_id and l.activo)
  from public.alumnos a
  join public.inscripciones i on i.cliente_email = a.email
  join public.servicios s on s.id = i.servicio_id
  where a.user_id = auth.uid() and a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
    and i.acceso and i.estado <> 'cancelada'
  order by i.servicio_id, i.creado;
$$;

-- ---------------------------------------------------------------------
-- 7. Cuentas de alumnas (Supabase Auth)
-- ---------------------------------------------------------------------
-- Hook "Before User Created": SOLO deja crear una cuenta si email + código coinciden con una alumna
-- que tiene al menos un curso habilitado. Bloquea cualquier otro alta (incluso con el registro abierto).
-- Activarlo en: Authentication → Hooks → Before User Created → Postgres → public.hook_antes_de_crear_usuario
create or replace function public.hook_antes_de_crear_usuario(event jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(coalesce(event -> 'user' ->> 'email', ''));
  v_id uuid;
  v_cod text := upper(btrim(coalesce(event -> 'user' -> 'user_metadata' ->> 'codigo', '')));
begin
  if v_email <> '' and v_cod <> ''
     and not exists (select 1 from public.admins ad where ad.email = v_email)
     and exists (select 1 from public.alumnos a join public.inscripciones i on i.cliente_email = a.email
                 where a.email = v_email and a.codigo = v_cod and i.acceso and i.estado <> 'cancelada') then
    -- Vínculo anticipado con el id de la cuenta (el trigger de auth.users lo confirma al crearse).
    begin v_id := (event -> 'user' ->> 'id')::uuid; exception when others then v_id := null; end;
    if v_id is not null then update public.alumnos set user_id = v_id where email = v_email; end if;
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403,
    'message', 'El email o el código de acceso no coinciden con una alumna habilitada.'));
end $$;

-- Vincula la cuenta nueva con su ficha de alumna (por id, así un cambio de email no da acceso a nada).
create or replace function public._vincular_alumno()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.alumnos set user_id = new.id where email = lower(new.email);
  return new;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant usage on schema public to supabase_auth_admin';
    execute 'grant execute on function public.hook_antes_de_crear_usuario(jsonb) to supabase_auth_admin';
  end if;
  if to_regclass('auth.users') is not null then
    begin
      execute 'drop trigger if exists vincular_alumno on auth.users';
      execute 'create trigger vincular_alumno after insert on auth.users for each row execute function public._vincular_alumno()';
    exception when others then
      raise notice 'No se pudo crear el trigger en auth.users (%). El vínculo lo hace el hook.', sqlerrm;
    end;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Permisos y RLS
-- ---------------------------------------------------------------------
alter table public.inscripciones enable row level security;
alter table public.alumnos enable row level security;
alter table public.lecciones enable row level security;

revoke all on public.inscripciones, public.alumnos, public.lecciones from anon, authenticated;
grant select, insert, update, delete on public.inscripciones, public.alumnos, public.lecciones to authenticated;

drop policy if exists inscripciones_admin on public.inscripciones;
create policy inscripciones_admin on public.inscripciones for all to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists alumnos_admin on public.alumnos;
create policy alumnos_admin on public.alumnos for all to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists lecciones_admin on public.lecciones;
create policy lecciones_admin on public.lecciones for all to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists lecciones_alumna on public.lecciones;
create policy lecciones_alumna on public.lecciones for select to authenticated using (activo and public.tiene_acceso(servicio_id));

revoke all on function public._aleatorio(int), public._referencia_nueva(), public._monto_curso(text), public._gs(bigint),
                       public.tiene_acceso(text), public.puede_ver_archivo(text), public._inscripciones_sync(), public._inscripciones_espejo(),
                       public._crear_inscripcion(text, text, text, text, text), public.crear_inscripcion(text, text, text, text, text),
                       public._asegurar_alumno(text), public._registrar_pago(uuid, text, text, boolean, bigint),
                       public.admin_registrar_pago(uuid, text, text, boolean), public.admin_dar_acceso(uuid, boolean),
                       public.mis_cursos(), public.hook_antes_de_crear_usuario(jsonb), public._vincular_alumno()
  from public, anon, authenticated;
grant execute on function public.crear_inscripcion(text, text, text, text, text) to anon, authenticated;
grant execute on function public.mis_cursos(), public.admin_registrar_pago(uuid, text, text, boolean),
                          public.admin_dar_acceso(uuid, boolean) to authenticated;
-- Usadas dentro de políticas / valores por defecto (devuelven false o un texto al azar; no exponen datos).
grant execute on function public.tiene_acceso(text), public.puede_ver_archivo(text), public._referencia_nueva() to authenticated;
-- _registrar_pago queda SOLO para la service key (futuro webhook de la pasarela de tarjeta).
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public._registrar_pago(uuid, text, text, boolean, bigint) to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 9. Storage: bucket PRIVADO "cursos" (PDF y fotos de las clases)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cursos', 'cursos', false, 26214400, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists cursos_storage_leer on storage.objects;
create policy cursos_storage_leer on storage.objects for select to authenticated
  using (bucket_id = 'cursos' and public.puede_ver_archivo(name));
drop policy if exists cursos_storage_admin_subir on storage.objects;
create policy cursos_storage_admin_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'cursos' and public.es_admin());
drop policy if exists cursos_storage_admin_modificar on storage.objects;
create policy cursos_storage_admin_modificar on storage.objects for update to authenticated
  using (bucket_id = 'cursos' and public.es_admin()) with check (bucket_id = 'cursos' and public.es_admin());
drop policy if exists cursos_storage_admin_borrar on storage.objects;
create policy cursos_storage_admin_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'cursos' and public.es_admin());

select 'Cursos listos' as resultado,
       public._monto_curso('Gs. 350.000 + Matrícula Gs. 100.000 (total Gs. 450.000)') ->> 'total' = '450000' as monto_ok,
       to_regclass('auth.users') is not null as auth_ok,
       exists (select 1 from pg_trigger where tgname = 'vincular_alumno') as vinculo_ok;
