-- =====================================================================
-- Migración 2026-11-02 · Auditoría (Tania Sanabria Makeup Studio)
-- Ejecutar UNA vez en Supabase → SQL Editor (como postgres). Idempotente: se puede volver a correr.
-- Compatible hacia atrás: el sitio, el panel y la app 1.8/1.9/1.10 siguen funcionando antes y después.
-- Orden:
--   1) Varias cuentas administradoras (Tania + Harold) — lista public.admins
--   2) Autor de cada cambio (reservas, inscripciones, app_docs) + app_docs_bajar devuelve "por"
--   3) Tiempo real: reservas, inscripciones, app_docs, servicios, bloqueos, lista_espera en supabase_realtime
--   4) Límite por IP (anti-spam) para crear_reserva, crear_inscripcion, comprobantes y lista de espera
--   5) Lista de espera para horarios de cursos completos
--   6) Autogestión de la clienta: confirmar o cancelar su turno desde el enlace del recordatorio
--   7) Gancho para captcha (Cloudflare Turnstile): apagado hasta cargar la clave
-- =====================================================================

-- 1) Cuentas administradoras ---------------------------------------------
-- es_admin() ya consulta public.admins. Para que Harold tenga su propia cuenta:
--   a) crear el usuario en Authentication → Users (su email y contraseña),
--   b) descomentar y completar la línea de abajo. La cuenta compartida sigue funcionando.
-- insert into public.admins (email) values ('EMAIL_DE_HAROLD@gmail.com') on conflict (email) do nothing;

-- 2) Autor de los cambios --------------------------------------------------
alter table public.reservas      add column if not exists modificado_por text;
alter table public.inscripciones add column if not exists modificado_por text;

create or replace function public._marcar_autor()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.modificado_por := coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''),
                                 case when coalesce(auth.jwt() ->> 'role', 'anon') = 'anon' then 'web (clienta)' end,
                                 new.modificado_por);
  return new;
end $$;
revoke all on function public._marcar_autor() from public, anon, authenticated;
drop trigger if exists reservas_autor on public.reservas;
create trigger reservas_autor before insert or update on public.reservas for each row execute function public._marcar_autor();
drop trigger if exists inscripciones_autor on public.inscripciones;
create trigger inscripciones_autor before insert or update on public.inscripciones for each row execute function public._marcar_autor();

-- app_docs_bajar: mismo protocolo, solo agrega el campo "por" (la app vieja lo ignora).
create or replace function public.app_docs_bajar(p_desde bigint default 0, p_limite int default 500) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  return jsonb_build_object('ahora', clock_timestamp(), 'filas', coalesce((select jsonb_agg(to_jsonb(x) order by x.rev) from (
    select tipo, uuid, web_id, data, borrado, rev, actualizado, por from public.app_docs
    where rev > coalesce(p_desde,0) order by rev limit least(greatest(coalesce(p_limite,500),1),1000)) x), '[]'::jsonb));
end $$;
revoke all on function public.app_docs_bajar(bigint, int) from public, anon;
grant execute on function public.app_docs_bajar(bigint, int) to authenticated;

-- 5) Lista de espera (antes de la publicación de tiempo real) -------------
create table if not exists public.lista_espera (
  id uuid primary key default gen_random_uuid(),
  servicio_id text not null,
  horario text,
  nombre text not null check (length(nombre) between 3 and 120),
  telefono text not null check (length(telefono) between 8 and 30),
  email text check (email is null or length(email) <= 160),
  estado text not null default 'esperando' check (estado in ('esperando', 'avisada', 'inscripta', 'descartada')),
  ip text,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index if not exists lista_espera_curso_idx on public.lista_espera (servicio_id, estado, creado);
alter table public.lista_espera enable row level security;
revoke all on public.lista_espera from anon;
grant select, update, delete on public.lista_espera to authenticated;
drop policy if exists lista_espera_admin on public.lista_espera;
create policy lista_espera_admin on public.lista_espera for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- 3) Tiempo real -----------------------------------------------------------
do $$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['reservas', 'inscripciones', 'app_docs', 'servicios', 'bloqueos', 'lista_espera'] loop
      if exists (select 1 from pg_tables where schemaname = 'public' and tablename = t)
         and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
-- Para que los avisos de UPDATE/DELETE lleguen con la fila completa al panel:
alter table public.reservas replica identity full;
alter table public.inscripciones replica identity full;

-- 4) Límite por IP -------------------------------------------------------
create table if not exists public.limite_ip (
  ip text not null, tipo text not null, creado timestamptz not null default now());
create index if not exists limite_ip_idx on public.limite_ip (ip, tipo, creado);
alter table public.limite_ip enable row level security;
revoke all on public.limite_ip from anon, authenticated;

-- IP real de quien llama (PostgREST pasa los encabezados de la petición). null si no hay (SQL Editor, triggers internos).
create or replace function public._ip_cliente()
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare h json;
begin
  begin h := nullif(current_setting('request.headers', true), '')::json; exception when others then return null; end;
  if h is null then return null; end if;
  return nullif(btrim(split_part(coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip', h ->> 'x-forwarded-for', ''), ',', 1)), '');
end $$;
revoke all on function public._ip_cliente() from public, anon, authenticated;

-- Registra y controla: máximo p_max acciones del tipo por IP en p_ventana. Las administradoras no tienen límite.
create or replace function public._limite_ip(p_tipo text, p_max int, p_ventana interval)
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_ip text := public._ip_cliente();
begin
  if v_ip is null or public.es_admin() then return; end if;
  delete from public.limite_ip where creado < now() - interval '2 days';
  if (select count(*) from public.limite_ip where ip = v_ip and tipo = p_tipo and creado > now() - p_ventana) >= p_max then
    raise exception 'DEMASIADAS_SOLICITUDES' using errcode = 'P0001';
  end if;
  insert into public.limite_ip (ip, tipo) values (v_ip, p_tipo);
end $$;
revoke all on function public._limite_ip(text, int, interval) from public, anon, authenticated;

-- Trigger en las altas desde la web (el error P0001 lo convierte crear_reserva/crear_inscripcion en {ok:false, error:'DEMASIADAS_SOLICITUDES'}).
create or replace function public._limite_alta_web()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.origen = 'web' then
    perform public._limite_ip(tg_table_name, 6, interval '1 hour');
    perform public._captcha_ok();
  end if;
  return new;
end $$;

-- 7) Captcha: si ajustes_privados.captcha_obligatorio = true, las altas web necesitan el encabezado x-captcha-ok
--    que agrega la edge function "verificar-captcha" (ver supabase/functions/verificar-captcha). Apagado por defecto.
alter table public.ajustes_privados add column if not exists captcha_obligatorio boolean not null default false;
create or replace function public._captcha_ok()
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
declare h json; v_ob boolean;
begin
  select captcha_obligatorio into v_ob from public.ajustes_privados where id = 1;
  if not coalesce(v_ob, false) or public.es_admin() then return; end if;
  begin h := nullif(current_setting('request.headers', true), '')::json; exception when others then h := null; end;
  if h is null or coalesce(h ->> 'x-captcha-ok', '') <> coalesce(current_setting('app.captcha_clave', true), '#') then
    raise exception 'CAPTCHA_INVALIDO' using errcode = 'P0001';
  end if;
end $$;
revoke all on function public._captcha_ok() from public, anon, authenticated;
revoke all on function public._limite_alta_web() from public, anon, authenticated;

drop trigger if exists reservas_limite_ip on public.reservas;
create trigger reservas_limite_ip before insert on public.reservas for each row execute function public._limite_alta_web();
drop trigger if exists inscripciones_limite_ip on public.inscripciones;
create trigger inscripciones_limite_ip before insert on public.inscripciones for each row execute function public._limite_alta_web();

-- Comprobantes: además de máx. 5 por turno, máx. 12 subidas por IP por hora.
create or replace function public._comprobante_ruta_ok(p_ruta text)
returns boolean language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare m text[];
begin
  m := regexp_match(coalesce(p_ruta, ''), '^([ri])/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9]{10,16}\.(jpg|webp|png|pdf)$');
  if m is null then return false; end if;
  if (select count(*) from storage.objects o where o.bucket_id = 'comprobantes' and o.name like m[1] || '/' || m[2] || '/%') >= 5 then return false; end if;
  if not public._comprobante_destino_ok(m[1], m[2]::uuid) then return false; end if;
  begin perform public._limite_ip('comprobante', 12, interval '1 hour'); exception when sqlstate 'P0001' then return false; end;
  return true;
end $$;
revoke all on function public._comprobante_ruta_ok(text) from public;
grant execute on function public._comprobante_ruta_ok(text) to anon, authenticated;

-- 5b) Anotarse en la lista de espera (solo números/estado vuelven a la web, nunca datos de otras personas)
create or replace function public.anotar_lista_espera(p_curso text, p_horario text, p_nombre text, p_telefono text, p_email text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_dig text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'); v_id uuid;
begin
  if not exists (select 1 from public.servicios where id = p_curso) then return jsonb_build_object('ok', false, 'error', 'CURSO_INVALIDO'); end if;
  if length(btrim(coalesce(p_nombre, ''))) < 3 then return jsonb_build_object('ok', false, 'error', 'NOMBRE_INVALIDO'); end if;
  if length(v_dig) < 8 or length(v_dig) > 15 then return jsonb_build_object('ok', false, 'error', 'TELEFONO_INVALIDO'); end if;
  begin perform public._limite_ip('espera', 5, interval '1 hour'); exception when sqlstate 'P0001' then return jsonb_build_object('ok', false, 'error', 'DEMASIADAS_SOLICITUDES'); end;
  select id into v_id from public.lista_espera where servicio_id = p_curso and coalesce(horario, '') = coalesce(p_horario, '')
    and right(regexp_replace(telefono, '\D', '', 'g'), 9) = right(v_dig, 9) and estado = 'esperando';
  if v_id is null then
    insert into public.lista_espera (servicio_id, horario, nombre, telefono, email, ip)
    values (p_curso, nullif(left(btrim(coalesce(p_horario, '')), 200), ''), left(btrim(p_nombre), 120), left(btrim(p_telefono), 30),
            nullif(lower(left(btrim(coalesce(p_email, '')), 160)), ''), public._ip_cliente())
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id,
    'posicion', (select count(*) from public.lista_espera where servicio_id = p_curso and coalesce(horario, '') = coalesce(p_horario, '') and estado = 'esperando'
                 and creado <= (select creado from public.lista_espera where id = v_id)));
end $$;
revoke all on function public.anotar_lista_espera(text, text, text, text, text) from public;
grant execute on function public.anotar_lista_espera(text, text, text, text, text) to anon, authenticated;

-- 6) Autogestión del turno (enlace del recordatorio: ?turno=<id>). El id es un UUID imposible de adivinar.
alter table public.reservas add column if not exists cliente_confirmo timestamptz;
alter table public.reservas add column if not exists cliente_cancelo timestamptz;

create or replace function public.turno_cliente(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.reservas; z text := public._zona();
begin
  select * into r from public.reservas where id = p_id;
  if r.id is null then return jsonb_build_object('ok', false, 'error', 'NO_ENCONTRADA'); end if;
  return jsonb_build_object('ok', true, 'servicio', r.servicio_nombre, 'estado', r.estado,
    'fecha', coalesce(to_char(r.inicio at time zone z, 'YYYY-MM-DD'), r.fecha_preferida::text),
    'hora', coalesce(to_char(r.inicio at time zone z, 'HH24:MI'), r.hora_preferida),
    'nombre', split_part(coalesce(r.cliente_nombre, ''), ' ', 1),
    'confirmo', r.cliente_confirmo, 'cancelo', r.cliente_cancelo,
    'pasado', coalesce(r.inicio < now(), false));
end $$;
revoke all on function public.turno_cliente(uuid) from public;
grant execute on function public.turno_cliente(uuid) to anon, authenticated;

create or replace function public.turno_cliente_responder(p_id uuid, p_accion text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare r public.reservas;
begin
  select * into r from public.reservas where id = p_id for update;
  if r.id is null then return jsonb_build_object('ok', false, 'error', 'NO_ENCONTRADA'); end if;
  if r.estado in ('cancelada', 'rechazada') then return jsonb_build_object('ok', false, 'error', 'YA_CANCELADA'); end if;
  if r.inicio is not null and r.inicio < now() then return jsonb_build_object('ok', false, 'error', 'TURNO_PASADO'); end if;
  if p_accion = 'confirmar' then
    update public.reservas set cliente_confirmo = now(),
      notas = left(concat_ws(E'\n', notas, '✅ La clienta confirmó asistencia (' || to_char(now() at time zone public._zona(), 'DD/MM HH24:MI') || ')'), 2000)
      where id = p_id;
  elsif p_accion = 'cancelar' then
    update public.reservas set cliente_cancelo = now(), estado = 'cancelada',
      notas = left(concat_ws(E'\n', notas, '❌ La clienta canceló desde el enlace (' || to_char(now() at time zone public._zona(), 'DD/MM HH24:MI') || ')'), 2000)
      where id = p_id;
  else return jsonb_build_object('ok', false, 'error', 'ACCION_INVALIDA'); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.turno_cliente_responder(uuid, text) from public;
grant execute on function public.turno_cliente_responder(uuid, text) to anon, authenticated;

select 'migracion-2026-11-02 OK' as resultado;
