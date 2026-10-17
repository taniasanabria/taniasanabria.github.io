-- =====================================================================
-- Avisos push al celular de Tania cuando entra una solicitud de reserva.
-- Se ejecuta DESPUÉS de schema.sql. Es idempotente (se puede volver a correr).
-- Requiere además desplegar la Edge Function "avisar-reserva" (ver PASOS.md).
-- =====================================================================

-- pg_net: permite que la base haga una llamada HTTP (asíncrona) a la Edge Function.
do $$ begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net no disponible (%). Los avisos push no se van a disparar.', sqlerrm;
end $$;

-- Dispositivos de Tania que aceptaron recibir avisos (uno por navegador/celular).
create table if not exists public.push_suscripciones (
  endpoint text primary key check (endpoint like 'https://%' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) between 40 and 200),
  auth text not null check (length(auth) between 10 and 100),
  dispositivo text check (dispositivo is null or length(dispositivo) <= 300),
  email text default auth.email(),
  creado timestamptz not null default now(),
  ultimo_envio timestamptz
);
alter table public.push_suscripciones enable row level security;
revoke all on public.push_suscripciones from anon, authenticated;
grant select, insert, update, delete on public.push_suscripciones to authenticated;
drop policy if exists push_suscripciones_admin on public.push_suscripciones;
create policy push_suscripciones_admin on public.push_suscripciones for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- Registro de reservas ya avisadas (para no avisar dos veces). Solo la usa la Edge Function (service role).
create table if not exists public.avisos_enviados (
  reserva_id uuid primary key references public.reservas (id) on delete cascade,
  enviado timestamptz not null default now()
);
alter table public.avisos_enviados enable row level security;
revoke all on public.avisos_enviados from anon, authenticated;

-- Trigger: cada solicitud nueva desde la web llama a la Edge Function con el id (nada más).
-- Si algo falla acá, la reserva se guarda igual (el aviso es secundario).
create or replace function public._avisar_reserva()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.estado = 'pendiente' and new.origen = 'web' then
    begin
      perform net.http_post(
        url := 'https://wfngdgqihtiqkokhxjqv.supabase.co/functions/v1/avisar-reserva',
        body := jsonb_build_object('id', new.id),
        headers := '{"Content-Type": "application/json"}'::jsonb,
        timeout_milliseconds := 8000
      );
    exception when others then
      raise warning 'No se pudo pedir el aviso push: %', sqlerrm;
    end;
  end if;
  return new;
end $$;
revoke all on function public._avisar_reserva() from public, anon, authenticated;

drop trigger if exists avisar_reserva on public.reservas;
create trigger avisar_reserva after insert on public.reservas
  for each row execute function public._avisar_reserva();

select 'Avisos listos' as resultado,
       exists (select 1 from pg_extension where extname = 'pg_net') as pg_net_ok;
