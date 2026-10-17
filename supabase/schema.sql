-- =====================================================================
-- Tania Sanabria · Makeup Studio — esquema de Supabase
-- Archivo IDEMPOTENTE: se puede ejecutar varias veces en el SQL Editor
-- sin perder datos (crea solo lo que falta y actualiza funciones/políticas).
--
-- Seguridad (resumen):
--   * Público (anon): lee servicios/fotos/álbumes activos y ajustes públicos.
--     Ve horarios libres SOLO vía la función horarios_libres() (sin datos de clientes)
--     y crea reservas SOLO vía crear_reserva() (valida que el horario esté libre).
--     Nunca puede leer la tabla de reservas.
--   * Admin: usuaria autenticada cuyo email está en public.admins
--     (tanialomaqui18@gmail.com). Tiene control total + subir/borrar fotos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Administradoras
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  email text primary key check (email = lower(email)),
  creado timestamptz not null default now()
);
insert into public.admins (email) values ('tanialomaqui18@gmail.com') on conflict (email) do nothing;

create or replace function public.es_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
     and exists (select 1 from public.admins a where a.email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

-- ---------------------------------------------------------------------
-- 2. Ajustes (una sola fila, id = 1)
-- ---------------------------------------------------------------------
create table if not exists public.ajustes (
  id smallint primary key default 1 check (id = 1),
  whatsapp text not null default '595976122979' check (whatsapp ~ '^[0-9]{8,15}$'),
  politica_sena text not null default '',
  politica_horario text not null default '',
  -- Paraguay: UTC-3 todo el año desde oct/2024. 'Etc/GMT+3' (= UTC-3) no depende de
  -- que el servidor o el celular tengan la base de zonas horarias actualizada.
  zona_horaria text not null default 'Etc/GMT+3',
  intervalo_min int not null default 30 check (intervalo_min in (15, 20, 30, 45, 60)),
  anticipacion_horas int not null default 2 check (anticipacion_horas between 0 and 168),
  dias_reserva_max int not null default 60 check (dias_reserva_max between 1 and 365),
  actualizado timestamptz not null default now()
);

-- Datos solo para la admin (no se publican): datos de pago y plantillas de mensajes.
create table if not exists public.ajustes_privados (
  id smallint primary key default 1 check (id = 1),
  datos_pago text not null default '',
  mensaje_aprobacion text not null default '¡Hola {nombre}! 💄 Soy Tania Sanabria. Tu turno de *{servicio}* para el *{fecha}* a las *{hora}* está aprobado ✅.' || chr(10) || chr(10) ||
    'Para confirmarlo, aboná {pago} de *{monto}* a:' || chr(10) || '{datos_pago}' || chr(10) || chr(10) ||
    'Enviame el comprobante por aquí. ¡Gracias!',
  mensaje_rechazo text not null default '¡Hola {nombre}! Soy Tania Sanabria. Lamentablemente no tengo disponible el turno de *{servicio}* para el *{fecha}* a las *{hora}*. ¿Te puedo ofrecer otro día u horario?',
  actualizado timestamptz not null default now()
);
insert into public.ajustes (id) values (1) on conflict (id) do nothing;
insert into public.ajustes_privados (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 3. Catálogo: servicios, álbumes y fotos
-- ---------------------------------------------------------------------
create table if not exists public.servicios (
  id text primary key check (id ~ '^[a-z0-9-]+$'),
  categoria text not null check (categoria in ('maquillaje', 'estetica', 'eventos', 'academia')),
  nombre text not null,
  descripcion text not null default '',
  precio_texto text not null default '',          -- lo que se muestra: "Gs. 250.000", "A partir de…"
  precio_reserva_texto text,                       -- opcional: texto para el mensaje de reserva
  precio_gs bigint check (precio_gs >= 0),         -- número de referencia (opcional)
  sena_gs bigint check (sena_gs >= 0),             -- seña en guaraníes; null = sin seña
  duracion_texto text,
  duracion_min int not null default 60 check (duracion_min between 10 and 720), -- para la agenda
  usa_turno boolean not null default true,         -- false: eventos/cursos (fecha a coordinar)
  activo boolean not null default true,
  orden int not null default 0,
  extra jsonb not null default '{}'::jsonb,        -- detalles, normas, variantes… (contenido del sitio)
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

create table if not exists public.albumes (
  id text primary key check (id ~ '^[a-z0-9-]+$'),
  titulo text not null,
  orden int not null default 0,
  activo boolean not null default true
);

create table if not exists public.fotos (
  id uuid primary key default gen_random_uuid(),
  servicio_id text references public.servicios (id) on delete cascade on update cascade,
  album_id text references public.albumes (id) on delete cascade on update cascade,
  origen text not null default 'storage' check (origen in ('storage', 'sitio')),
  ruta text not null,             -- storage: "<uuid>" (archivos <uuid>-480.webp…); sitio: "social-1" (img/ del repo)
  anchos int[] not null default '{480,960,1440}',
  formato text not null default 'webp' check (formato in ('webp', 'jpg')),   -- jpg si el navegador no sabe generar WebP (Safari)
  ancho int not null default 1000 check (ancho > 0),
  alto int not null default 1500 check (alto > 0),
  alt text not null default '',
  orden int not null default 0,
  activo boolean not null default true,
  creado timestamptz not null default now(),
  constraint fotos_un_destino check (num_nonnulls(servicio_id, album_id) = 1)
);
alter table public.fotos add column if not exists formato text not null default 'webp' check (formato in ('webp', 'jpg'));
create index if not exists fotos_servicio_idx on public.fotos (servicio_id, orden);
create index if not exists fotos_album_idx on public.fotos (album_id, orden);

-- ---------------------------------------------------------------------
-- 4. Disponibilidad
-- ---------------------------------------------------------------------
create table if not exists public.horario_semanal (
  dia smallint not null check (dia between 0 and 6),   -- 0 = domingo … 6 = sábado
  abre time not null,
  cierra time not null,
  primary key (dia, abre),
  check (abre < cierra)
);

create table if not exists public.bloqueos (
  fecha date primary key,
  motivo text not null default ''
);

create table if not exists public.turnos_extra (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  inicio time not null,
  fin time not null,
  costo_extra boolean not null default true,
  nota text not null default '',
  check (inicio < fin)
);
create index if not exists turnos_extra_fecha_idx on public.turnos_extra (fecha);

-- ---------------------------------------------------------------------
-- 5. Reservas (nunca visibles para el público)
-- ---------------------------------------------------------------------
create table if not exists public.reservas (
  id uuid primary key default gen_random_uuid(),
  servicio_id text references public.servicios (id) on delete set null on update cascade,
  variante_id text,
  servicio_nombre text not null,
  precio_ref text,
  sena_ref text,
  inicio timestamptz,
  fin timestamptz,
  fecha_preferida date,
  hora_preferida text,
  bloquea boolean,                 -- ocupa la agenda (lo completa el trigger)
  costo_extra boolean not null default false,   -- domingo / fuera de horario
  cliente_nombre text not null check (length(cliente_nombre) between 2 and 120),
  cliente_telefono text not null check (length(cliente_telefono) between 6 and 30),
  cliente_email text check (cliente_email is null or length(cliente_email) <= 160),
  personas int check (personas is null or personas between 1 and 500),
  notas text check (notas is null or length(notas) <= 2000),
  pago text not null default 'sena' check (pago in ('sena', 'total')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada', 'pagada', 'cancelada')),
  origen text not null default 'admin' check (origen in ('web', 'admin')),
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  constraint reservas_bloquea_def check (bloquea is not null),
  constraint reservas_rango check (fin is null or (inicio is not null and fin > inicio)),
  constraint reservas_bloquea_rango check (not bloquea or (inicio is not null and fin is not null)),
  -- Dos citas activas que ocupan agenda no pueden superponerse.
  constraint reservas_sin_superposicion exclude using gist (tstzrange(inicio, fin, '[)') with &&)
    where (bloquea and estado in ('pendiente', 'aprobada', 'pagada'))
);
create index if not exists reservas_estado_idx on public.reservas (estado, creado desc);
create index if not exists reservas_inicio_idx on public.reservas (inicio);

-- ---------------------------------------------------------------------
-- 6. Funciones auxiliares y triggers
-- ---------------------------------------------------------------------
create or replace function public._zona()
returns text language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce((select zona_horaria from public.ajustes where id = 1), 'Etc/GMT+3'); $$;

-- Servicio a partir de su id o del id de una variante (ej. curso-artistico-regular).
create or replace function public._servicio_de(p_id text)
returns public.servicios language sql stable security definer set search_path = public, pg_temp
as $$
  select s.* from public.servicios s
  where s.id = p_id or s.extra -> 'variantes' @> jsonb_build_array(jsonb_build_object('id', p_id))
  order by (s.id = p_id) desc
  limit 1;
$$;

-- ¿Un instante cae en domingo o fuera del horario semanal? (implica costo adicional)
create or replace function public._fuera_de_horario(p_inicio timestamptz, p_fin timestamptz)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  with l as (select (p_inicio at time zone public._zona()) as i, (coalesce(p_fin, p_inicio) at time zone public._zona()) as f)
  select extract(dow from l.i) = 0
      or not exists (select 1 from public.horario_semanal h
                     where h.dia = extract(dow from l.i) and l.i::time >= h.abre and l.f::time <= h.cierra and l.f::date = l.i::date)
  from l;
$$;

create or replace function public._tocar_actualizado()
returns trigger language plpgsql set search_path = public, pg_temp
as $$ begin new.actualizado := now(); return new; end $$;

create or replace function public._reservas_antes()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_dur int;
  v_usa boolean;
begin
  select duracion_min, usa_turno into v_dur, v_usa from public.servicios where id = new.servicio_id;
  if new.inicio is not null and new.fin is null then
    new.fin := new.inicio + make_interval(mins => coalesce(v_dur, 60));
  end if;
  if new.bloquea is null then
    new.bloquea := coalesce(v_usa, false) and new.inicio is not null;
  end if;
  if new.fecha_preferida is null and new.inicio is not null then
    new.fecha_preferida := (new.inicio at time zone public._zona())::date;
  end if;
  new.actualizado := now();
  return new;
end $$;

drop trigger if exists reservas_antes on public.reservas;
create trigger reservas_antes before insert or update on public.reservas
  for each row execute function public._reservas_antes();

drop trigger if exists servicios_actualizado on public.servicios;
create trigger servicios_actualizado before update on public.servicios
  for each row execute function public._tocar_actualizado();
drop trigger if exists ajustes_actualizado on public.ajustes;
create trigger ajustes_actualizado before update on public.ajustes
  for each row execute function public._tocar_actualizado();
drop trigger if exists ajustes_privados_actualizado on public.ajustes_privados;
create trigger ajustes_privados_actualizado before update on public.ajustes_privados
  for each row execute function public._tocar_actualizado();

-- ---------------------------------------------------------------------
-- 7. Funciones públicas (RPC)
-- ---------------------------------------------------------------------

-- Horarios libres de un día para un servicio. No devuelve datos de clientes.
create or replace function public.horarios_libres(p_fecha date, p_servicio text)
returns table (inicio timestamptz, hora text, costo_extra boolean)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
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
      where r.bloquea and r.estado in ('pendiente', 'aprobada', 'pagada')
        and tstzrange(r.inicio, r.fin, '[)') && tstzrange(g.ini, g.ini + make_interval(mins => v_dur), '[)'))
  order by g.ini;
end $$;

-- Próximos días que tienen al menos un horario libre (para sugerir fechas).
create or replace function public.dias_con_turnos(p_servicio text, p_desde date default null, p_dias int default 14)
returns table (fecha date, libres int, costo_extra boolean)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  d date;
  v_desde date := coalesce(p_desde, (now() at time zone public._zona())::date);
  v_dias int := least(greatest(coalesce(p_dias, 14), 1), 31);
begin
  for i in 0 .. v_dias - 1 loop
    d := v_desde + i;
    return query
      select d, count(*)::int, bool_and(h.costo_extra)
      from public.horarios_libres(d, p_servicio) h
      having count(*) > 0;
  end loop;
end $$;

-- Lógica interna de alta de reservas (lanza excepciones con códigos legibles).
create or replace function public._crear_reserva(
  p_servicio text,
  p_nombre text,
  p_telefono text,
  p_inicio timestamptz default null,
  p_fecha_preferida date default null,
  p_hora_preferida text default null,
  p_email text default null,
  p_notas text default null,
  p_pago text default 'sena',
  p_personas int default null
)
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
  perform pg_advisory_xact_lock(hashtext('crear_reserva'));

  -- Límites anti-spam: máx. 3 solicitudes pendientes por teléfono en 24 h y 30 por cada 10 minutos en total.
  if (select count(*) from public.reservas r
      where r.origen = 'web' and r.estado = 'pendiente' and r.creado > now() - interval '1 day'
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
            v_nombre, v_tel, v_email, p_personas, v_notas, p_pago, 'pendiente', 'web')
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'HORARIO_NO_DISPONIBLE' using errcode = 'P0001';
  end;

  return jsonb_build_object('ok', true, 'id', v_id, 'estado', 'pendiente', 'costo_extra', coalesce(v_extra, false));
end $$;

-- Crear una solicitud de reserva (estado "pendiente"). Única forma de escribir reservas para el público.
-- Los errores de negocio (horario ocupado, datos inválidos…) se devuelven como {"ok": false, "error": "CODIGO"}.
create or replace function public.crear_reserva(
  p_servicio text,
  p_nombre text,
  p_telefono text,
  p_inicio timestamptz default null,
  p_fecha_preferida date default null,
  p_hora_preferida text default null,
  p_email text default null,
  p_notas text default null,
  p_pago text default 'sena',
  p_personas int default null
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  return public._crear_reserva(p_servicio, p_nombre, p_telefono, p_inicio, p_fecha_preferida, p_hora_preferida,
                               p_email, p_notas, p_pago, p_personas);
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

-- Guardar el horario semanal completo de una vez (solo admin). p_horario = [{"dia":1,"abre":"09:00","cierra":"20:00"}, …]
create or replace function public.admin_guardar_horario(p_horario jsonb)
returns void
language plpgsql volatile security invoker
set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  delete from public.horario_semanal where true;
  insert into public.horario_semanal (dia, abre, cierra)
  select (x ->> 'dia')::smallint, (x ->> 'abre')::time, (x ->> 'cierra')::time
  from jsonb_array_elements(coalesce(p_horario, '[]'::jsonb)) x;
end $$;

-- ---------------------------------------------------------------------
-- 8. Permisos y Row Level Security
-- ---------------------------------------------------------------------
alter table public.admins enable row level security;
alter table public.ajustes enable row level security;
alter table public.ajustes_privados enable row level security;
alter table public.servicios enable row level security;
alter table public.albumes enable row level security;
alter table public.fotos enable row level security;
alter table public.horario_semanal enable row level security;
alter table public.bloqueos enable row level security;
alter table public.turnos_extra enable row level security;
alter table public.reservas enable row level security;

-- Privilegios de tabla (además de RLS): el público solo puede LEER el catálogo y los ajustes públicos.
revoke all on public.admins, public.ajustes, public.ajustes_privados, public.servicios, public.albumes, public.fotos,
              public.horario_semanal, public.bloqueos, public.turnos_extra, public.reservas from anon, authenticated;
grant select on public.ajustes, public.servicios, public.albumes, public.fotos to anon;
grant select on public.admins to authenticated;
grant select, insert, update, delete on public.ajustes, public.ajustes_privados, public.servicios, public.albumes, public.fotos,
              public.horario_semanal, public.bloqueos, public.turnos_extra, public.reservas to authenticated;

-- Funciones: solo las públicas quedan abiertas a anon.
revoke all on function public.es_admin(), public._zona(), public._servicio_de(text), public._fuera_de_horario(timestamptz, timestamptz),
                       public._tocar_actualizado(), public._reservas_antes(),
                       public.horarios_libres(date, text), public.dias_con_turnos(text, date, int),
                       public.crear_reserva(text, text, text, timestamptz, date, text, text, text, text, int),
                       public._crear_reserva(text, text, text, timestamptz, date, text, text, text, text, int),
                       public.admin_guardar_horario(jsonb) from public, anon, authenticated;
grant execute on function public.horarios_libres(date, text), public.dias_con_turnos(text, date, int),
                          public.crear_reserva(text, text, text, timestamptz, date, text, text, text, text, int) to anon, authenticated;
-- es_admin() se usa dentro de las políticas de lectura, por eso anon también necesita poder ejecutarla (devuelve false).
grant execute on function public.es_admin() to anon, authenticated;
grant execute on function public.admin_guardar_horario(jsonb) to authenticated;

-- Políticas (se recrean para que el archivo sea idempotente)
drop policy if exists admins_leer on public.admins;
create policy admins_leer on public.admins for select to authenticated using (public.es_admin());

drop policy if exists ajustes_leer on public.ajustes;
create policy ajustes_leer on public.ajustes for select to anon, authenticated using (true);
drop policy if exists ajustes_admin on public.ajustes;
create policy ajustes_admin on public.ajustes for update to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists ajustes_privados_admin on public.ajustes_privados;
create policy ajustes_privados_admin on public.ajustes_privados for all to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists servicios_leer on public.servicios;
create policy servicios_leer on public.servicios for select to anon, authenticated using (activo or public.es_admin());
drop policy if exists servicios_admin on public.servicios;
create policy servicios_admin on public.servicios for all to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists albumes_leer on public.albumes;
create policy albumes_leer on public.albumes for select to anon, authenticated using (activo or public.es_admin());
drop policy if exists albumes_admin on public.albumes;
create policy albumes_admin on public.albumes for all to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists fotos_leer on public.fotos;
create policy fotos_leer on public.fotos for select to anon, authenticated using (activo or public.es_admin());
drop policy if exists fotos_admin on public.fotos;
create policy fotos_admin on public.fotos for all to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists horario_admin on public.horario_semanal;
create policy horario_admin on public.horario_semanal for all to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists bloqueos_admin on public.bloqueos;
create policy bloqueos_admin on public.bloqueos for all to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists turnos_extra_admin on public.turnos_extra;
create policy turnos_extra_admin on public.turnos_extra for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- Reservas: SOLO la admin. (El público usa crear_reserva(); no hay política para anon.)
drop policy if exists reservas_admin on public.reservas;
create policy reservas_admin on public.reservas for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- ---------------------------------------------------------------------
-- 9. Storage: bucket público "fotos" (lectura pública; subir/borrar solo admin)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', true, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists fotos_storage_admin_leer on storage.objects;
create policy fotos_storage_admin_leer on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and public.es_admin());
drop policy if exists fotos_storage_admin_subir on storage.objects;
create policy fotos_storage_admin_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and public.es_admin());
drop policy if exists fotos_storage_admin_modificar on storage.objects;
create policy fotos_storage_admin_modificar on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and public.es_admin()) with check (bucket_id = 'fotos' and public.es_admin());
drop policy if exists fotos_storage_admin_borrar on storage.objects;
create policy fotos_storage_admin_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and public.es_admin());

-- ---------------------------------------------------------------------
-- 10. Realtime: avisar al panel cuando entra una reserva nueva
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reservas') then
    execute 'alter publication supabase_realtime add table public.reservas';
  end if;
end $$;

-- Verificación rápida (debe mostrar la hora actual de Paraguay):
-- zona_ok debe ser true (UTC-3 también en invierno).
select 'Esquema listo' as resultado,
       now() at time zone public._zona() as hora_paraguay,
       (timestamptz '2027-07-01 12:00+00' at time zone public._zona())::time = time '09:00' as zona_ok;
