-- Avisos a Tania cuando una alumna del aula: presenta un trabajo, pide el examen por videollamada, entrega el examen o sube un comprobante de pago.
-- Lista de avisos (la lee la agenda de Android) + push web por la Edge Function "avisar-aula" (misma mecánica que avisar-reserva).
create table if not exists public.avisos_tania (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('entrega', 'examen_pedido', 'examen_entregado', 'pago')),
  ref_id uuid not null,
  titulo text not null,
  cuerpo text not null,
  url text not null,
  es_prueba boolean not null default false,
  push_enviado boolean not null default false,
  creado timestamptz not null default now(),
  unique (tipo, ref_id)
);
create index if not exists avisos_tania_creado on public.avisos_tania (creado);
alter table public.avisos_tania enable row level security;
revoke all on public.avisos_tania from anon, authenticated;
grant select on public.avisos_tania to authenticated;
drop policy if exists avisos_tania_admin on public.avisos_tania;
create policy avisos_tania_admin on public.avisos_tania for select to authenticated using (public.es_admin());

create or replace function public._aviso_aula(p_tipo text, p_ref uuid, p_user uuid, p_servicio text, p_titulo text, p_detalle text, p_ruta text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_nom text; v_curso text; v_prueba boolean; v_id uuid; v_titulo text;
begin
  select coalesce(nullif(btrim(pf.nombre), ''), u.email) into v_nom from auth.users u left join public.perfiles pf on pf.user_id = u.id where u.id = p_user;
  select s.nombre into v_curso from public.servicios s where s.id = p_servicio;
  v_prueba := exists (select 1 from public.alumnos a where a.user_id = p_user and a.es_prueba);
  v_titulo := p_titulo || ': ' || coalesce(v_nom, 'una alumna') || ' – ' || coalesce(v_curso, p_servicio) || case when p_detalle <> '' then ', ' || p_detalle else '' end || case when v_prueba then ' (prueba)' else '' end;
  insert into public.avisos_tania (tipo, ref_id, titulo, cuerpo, url, es_prueba)
  values (p_tipo, p_ref, left(v_titulo, 200), case p_tipo when 'entrega' then 'Tocá para corregirla.' when 'pago' then 'Tocá para revisar el comprobante.' else 'Tocá para verlo en el panel.' end || case when v_prueba then ' (cuenta de prueba)' else '' end,
          'https://taniasanabria.github.io/aula/#/admin' || p_ruta, v_prueba)
  on conflict (tipo, ref_id) do nothing returning id into v_id;
  if v_id is not null then
    begin
      perform net.http_post(url := 'https://wfngdgqihtiqkokhxjqv.supabase.co/functions/v1/avisar-aula', body := jsonb_build_object('id', v_id),
        headers := '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds := 8000);
    exception when others then raise warning 'No se pudo pedir el aviso push: %', sqlerrm; end;
  end if;
exception when others then raise warning 'aviso del aula falló: %', sqlerrm;   -- el aviso nunca debe impedir la entrega
end $$;
revoke all on function public._aviso_aula(text, uuid, uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public._aviso_entrega() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.estado = 'enviada' then perform public._aviso_aula('entrega', new.id, new.user_id, new.servicio_id, 'Nueva entrega', coalesce(nullif(btrim(new.titulo), ''), 'trabajo'), ''); end if;
  return null;
end $$;
drop trigger if exists aviso_entrega on public.entregas;
create trigger aviso_entrega after insert on public.entregas for each row execute function public._aviso_entrega();

create or replace function public._aviso_examen() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' and new.estado = 'solicitado' then
    perform public._aviso_aula('examen_pedido', new.id, new.user_id, new.servicio_id, 'Pidió examen por videollamada', 'Mes ' || new.mes, '/examenes');
  elsif tg_op = 'UPDATE' and new.estado = 'entregado' and old.estado is distinct from 'entregado' then
    perform public._aviso_aula('examen_entregado', new.id, new.user_id, new.servicio_id, 'Examen entregado', 'Mes ' || new.mes, '/examenes');
  end if;
  return null;
end $$;
drop trigger if exists aviso_examen on public.aula_examenes;
create trigger aviso_examen after insert or update of estado on public.aula_examenes for each row execute function public._aviso_examen();

create or replace function public._aviso_pago_aula() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_serv text;
begin
  if new.estado = 'pendiente' then
    select i.servicio_id into v_serv from public.inscripciones i where i.id = new.inscripcion_id;
    perform public._aviso_aula('pago', new.id, new.user_id, v_serv, 'Comprobante de pago', 'Mes ' || new.mes, '/pagos');
  end if;
  return null;
end $$;
drop trigger if exists aviso_pago_aula on public.aula_pagos;
create trigger aviso_pago_aula after insert on public.aula_pagos for each row execute function public._aviso_pago_aula();
