-- =====================================================================
-- AULA VIRTUAL · PROGRESIÓN POR MÉRITO (2026-11-02) · IDEMPOTENTE
-- Requiere: aula.sql, migracion-aula-2026-11-02.sql.
-- Regla: el mes siguiente se abre SOLO si (a) todas las clases prácticas del mes fueron entregadas con fotos de cámara
--        y aprobadas por Tania, (b) la alumna rindió el examen del mes por videollamada (fotos + video subidos con el
--        código de 4 dígitos que Tania genera, válido 15 min), (c) Tania lo aprobó, y (d) Tania confirmó el pago del mes
--        siguiente. Pagar solo ya NO abre el mes. Intentos de examen por curso (por defecto 3).
-- Además: rúbrica por curso, mini cuestionario antes de cada práctica, alertas de fotos (tiempo / dispositivo),
--         plazos por mes y alumnas atrasadas, certificado con código y verificación pública, portafolio.
-- =====================================================================

-- 1. Configuración por curso, plazos, columnas nuevas
create table if not exists public.aula_config_curso (
  servicio_id text primary key references public.servicios (id) on delete cascade on update cascade,
  max_intentos int not null default 3 check (max_intentos between 1 and 10),
  criterios text[] not null default array['Prolijidad', 'Difuminado', 'Piel', 'Cejas', 'Ojos'] check (cardinality(criterios) between 1 and 10),
  video_requerido boolean not null default true,
  meses_total int check (meses_total is null or meses_total between 1 and 36),
  actualizado timestamptz not null default now()
);
alter table public.aula_config_curso enable row level security;
revoke all on public.aula_config_curso from anon, authenticated;
grant select, insert, update, delete on public.aula_config_curso to authenticated;
drop policy if exists aula_config_leer on public.aula_config_curso;
create policy aula_config_leer on public.aula_config_curso for select to authenticated using (true);
drop policy if exists aula_config_admin on public.aula_config_curso;
create policy aula_config_admin on public.aula_config_curso for all to authenticated using (public.es_admin()) with check (public.es_admin());

create table if not exists public.aula_plazos (
  servicio_id text not null references public.servicios (id) on delete cascade on update cascade,
  mes int not null check (mes between 1 and 36),
  vence date not null,
  primary key (servicio_id, mes)
);
alter table public.aula_plazos enable row level security;
revoke all on public.aula_plazos from anon, authenticated;
grant select, insert, update, delete on public.aula_plazos to authenticated;
drop policy if exists aula_plazos_leer on public.aula_plazos;
create policy aula_plazos_leer on public.aula_plazos for select to authenticated using (true);
drop policy if exists aula_plazos_admin on public.aula_plazos;
create policy aula_plazos_admin on public.aula_plazos for all to authenticated using (public.es_admin()) with check (public.es_admin());

alter table public.lecciones add column if not exists requiere_entrega boolean not null default true;
alter table public.entregas add column if not exists rubrica jsonb;
alter table public.entregas add column if not exists flags jsonb not null default '{}'::jsonb;
alter table public.entregas add column if not exists portafolio boolean not null default false;

alter table public.aula_examenes add column if not exists intento int not null default 1;
alter table public.aula_examenes add column if not exists fotos text[];
alter table public.aula_examenes add column if not exists video text;
alter table public.aula_examenes add column if not exists captura jsonb;
alter table public.aula_examenes add column if not exists flags jsonb not null default '{}'::jsonb;
alter table public.aula_examenes add column if not exists rubrica jsonb;
alter table public.aula_examenes add column if not exists entregado_en timestamptz;
alter table public.aula_examenes add column if not exists calificado_en timestamptz;
do $$ begin
  alter table public.aula_examenes drop constraint if exists aula_examenes_estado_check;
  if not exists (select 1 from pg_constraint where conname = 'aula_examenes_estado_chk2') then
    alter table public.aula_examenes add constraint aula_examenes_estado_chk2
      check (estado in ('solicitado', 'agendado', 'en_curso', 'entregado', 'aprobado', 'desaprobado', 'cancelado')); end if;
end $$;

-- 2. Ayudantes: inscripción principal de la alumna, config, mes completo
create or replace function public._aula_mi_insc(p_curso text)
returns public.inscripciones language sql stable security definer set search_path = public, pg_temp
as $$
  select i.* from public.alumnos a join public.inscripciones i on i.cliente_email = a.email
   where auth.uid() is not null and a.user_id = auth.uid() and a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
     and i.servicio_id = p_curso and i.acceso and i.estado <> 'cancelada'
   order by i.meses_habilitados desc, i.creado limit 1;
$$;
create or replace function public._aula_uid_de(p_insc uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp
as $$ select a.user_id from public.inscripciones i join public.alumnos a on a.email = i.cliente_email where i.id = p_insc; $$;
create or replace function public._aula_cfg(p_curso text)
returns public.aula_config_curso language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce((select c from public.aula_config_curso c where c.servicio_id = p_curso), row(p_curso, 3, array['Prolijidad', 'Difuminado', 'Piel', 'Cejas', 'Ojos'], true, null, now())::public.aula_config_curso); $$;
create or replace function public._aula_meses_total(p_insc uuid)
returns int language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce((public._aula_cfg(i.servicio_id)).meses_total,
                  (select max(l.mes) from public.lecciones l where l.servicio_id = i.servicio_id and l.activo and (l.variante_id is null or l.variante_id = i.variante_id)), 1)
    from public.inscripciones i where i.id = p_insc;
$$;
-- Clases prácticas del mes (de su nivel) y cuántas tiene aprobadas
create or replace function public._aula_clases_mes(p_insc uuid, p_mes int)
returns table (total int, aprobadas int, enviadas int)
language sql stable security definer set search_path = public, pg_temp
as $$
  with i as (select * from public.inscripciones where id = p_insc), u as (select public._aula_uid_de(p_insc) uid),
  ls as (select l.id from public.lecciones l, i where l.servicio_id = i.servicio_id and l.activo and l.requiere_entrega and l.mes = p_mes
           and (l.variante_id is null or l.variante_id = i.variante_id))
  select (select count(*) from ls)::int,
         (select count(*) from ls where exists (select 1 from public.entregas e, u where e.leccion_id = ls.id and e.user_id = u.uid and e.estado = 'corregida'))::int,
         (select count(*) from ls where exists (select 1 from public.entregas e, u where e.leccion_id = ls.id and e.user_id = u.uid))::int;
$$;
create or replace function public._aula_mes_completo(p_insc uuid, p_mes int)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select c.aprobadas >= c.total from public._aula_clases_mes(p_insc, p_mes) c; $$;

-- 3. Certificados
create table if not exists public.aula_certificados (
  codigo text primary key check (codigo ~ '^TS-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'),
  inscripcion_id uuid not null unique references public.inscripciones (id) on delete cascade,
  user_id uuid,
  nombre text not null,
  curso text not null,
  fecha date not null default (now() at time zone 'America/Asuncion')::date,
  creado timestamptz not null default now()
);
alter table public.aula_certificados enable row level security;
revoke all on public.aula_certificados from anon, authenticated;
grant select on public.aula_certificados to authenticated;
drop policy if exists aula_cert_leer on public.aula_certificados;
create policy aula_cert_leer on public.aula_certificados for select to authenticated using (user_id = auth.uid() or public.es_admin());

create or replace function public._aula_emitir_cert(p_insc uuid)
returns text language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare i public.inscripciones; v text; pf public.perfiles; u uuid := public._aula_uid_de(p_insc);
begin
  select codigo into v from public.aula_certificados where inscripcion_id = p_insc; if v is not null then return v; end if;
  select * into i from public.inscripciones where id = p_insc; if i.id is null then return null; end if;
  select * into pf from public.perfiles where user_id = u;
  loop
    v := 'TS-' || public._aleatorio(4) || '-' || public._aleatorio(4);
    exit when not exists (select 1 from public.aula_certificados where codigo = v);
  end loop;
  insert into public.aula_certificados (codigo, inscripcion_id, user_id, nombre, curso)
  values (v, p_insc, u, coalesce(pf.nombre, i.cliente_nombre), coalesce((select s.nombre from public.servicios s where s.id = i.servicio_id), i.curso_nombre));
  return v;
end $$;

-- Verificación pública: solo nombre, curso y fecha
create or replace function public.verificar_certificado(p_codigo text)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce((select jsonb_build_object('ok', true, 'nombre', c.nombre, 'curso', c.curso, 'fecha', c.fecha, 'codigo', c.codigo)
                     from public.aula_certificados c where c.codigo = upper(btrim(coalesce(p_codigo, '')))), jsonb_build_object('ok', false));
$$;

-- 4. Abrir el mes: examen aprobado + pago confirmado (lo llaman pagos y calificación de examen)
create or replace function public._aula_intentar_abrir(p_insc uuid)
returns int language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare i public.inscripciones; u uuid := public._aula_uid_de(p_insc); aprob boolean;
begin
  select * into i from public.inscripciones where id = p_insc; if i.id is null then return null; end if;
  aprob := exists (select 1 from public.aula_examenes x where x.user_id = u and x.servicio_id = i.servicio_id and x.mes = i.meses_habilitados and x.estado = 'aprobado');
  if aprob and i.meses_habilitados >= public._aula_meses_total(p_insc) then perform public._aula_emitir_cert(p_insc); return i.meses_habilitados; end if;
  if aprob and public._aula_mes_completo(p_insc, i.meses_habilitados)
     and exists (select 1 from public.aula_pagos p where p.inscripcion_id = p_insc and p.mes = i.meses_habilitados + 1 and p.estado = 'confirmado') then
    update public.inscripciones set meses_habilitados = meses_habilitados + 1 where id = p_insc returning meses_habilitados into i.meses_habilitados;
  end if;
  return i.meses_habilitados;
end $$;

-- El pago ya no abre el mes por sí solo
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
  if p_ok then perform public._aula_intentar_abrir(r.inscripcion_id); end if;
  return r;
end $$;

-- 5. Alertas de fotos: tomadas muy separadas en el tiempo o desde otro dispositivo
create or replace function public._aula_flags(p_uid uuid, p_captura jsonb, p_horas numeric default 3)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare f jsonb := '{}'::jsonb; t1 timestamptz; t2 timestamptz; disp text := p_captura ->> 'dispositivo'; previo text;
begin
  if p_captura is null then return f; end if;
  begin
    select min((x ->> 'tomada')::timestamptz), max((x ->> 'tomada')::timestamptz) into t1, t2
      from jsonb_array_elements(coalesce(p_captura -> 'fotos', '[]'::jsonb)) x where x ? 'tomada';
  exception when others then t1 := null; end;
  if t1 is not null and t2 - t1 > make_interval(secs => p_horas * 3600) then
    f := f || jsonb_build_object('fotos_separadas', round(extract(epoch from t2 - t1) / 3600.0, 1)); end if;
  if t2 is not null and now() - t2 > interval '6 hours' then f := f || jsonb_build_object('fotos_viejas', true); end if;
  if (select count(distinct x ->> 'dispositivo') from jsonb_array_elements(coalesce(p_captura -> 'fotos', '[]'::jsonb)) x where x ? 'dispositivo') > 1 then
    f := f || jsonb_build_object('varios_dispositivos', true); end if;
  if disp is not null then
    select d into previo from (
      select e.captura ->> 'dispositivo' d, e.creado from public.entregas e where e.user_id = p_uid and e.captura ? 'dispositivo'
      union all select x.captura ->> 'dispositivo', x.creado from public.aula_examenes x where x.user_id = p_uid and x.captura ? 'dispositivo') q
     group by d order by count(*) desc, max(creado) desc limit 1;
    if previo is not null and previo <> disp then f := f || jsonb_build_object('otro_dispositivo', true); end if;
  end if;
  return f;
end $$;

-- 6. Mini cuestionario antes de cada práctica (las respuestas correctas nunca salen de la base)
create table if not exists public.aula_preguntas (
  id uuid primary key default gen_random_uuid(),
  servicio_id text references public.servicios (id) on delete cascade on update cascade,   -- null = todos los cursos
  leccion_id uuid references public.lecciones (id) on delete cascade,                     -- null = banco general del curso
  tema text not null default '' check (length(tema) <= 80),
  pregunta text not null check (length(btrim(pregunta)) between 5 and 400),
  opciones text[] not null check (cardinality(opciones) between 2 and 5),
  correcta smallint not null check (correcta >= 0 and correcta < 5),
  activa boolean not null default true,
  creado timestamptz not null default now()
);
alter table public.aula_preguntas enable row level security;
revoke all on public.aula_preguntas from anon, authenticated;
grant select, insert, update, delete on public.aula_preguntas to authenticated;
drop policy if exists aula_preguntas_admin on public.aula_preguntas;
create policy aula_preguntas_admin on public.aula_preguntas for all to authenticated using (public.es_admin()) with check (public.es_admin());

create table if not exists public.aula_quiz_resultados (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  leccion_id uuid not null references public.lecciones (id) on delete cascade,
  correctas int not null, total int not null,
  respuestas jsonb not null default '{}'::jsonb,
  creado timestamptz not null default now()
);
create index if not exists aula_quiz_res_idx on public.aula_quiz_resultados (user_id, leccion_id);
alter table public.aula_quiz_resultados enable row level security;
revoke all on public.aula_quiz_resultados from anon, authenticated;
grant select on public.aula_quiz_resultados to authenticated;
drop policy if exists aula_quiz_res_leer on public.aula_quiz_resultados;
create policy aula_quiz_res_leer on public.aula_quiz_resultados for select to authenticated using (user_id = auth.uid() or public.es_admin());

-- Selección fija de hasta 4 preguntas por clase: primero las de la clase, después las del curso, después las generales
create or replace function public._quiz_sel(p_leccion uuid)
returns setof public.aula_preguntas language sql stable security definer set search_path = public, pg_temp
as $$
  select q.* from public.aula_preguntas q join public.lecciones l on l.id = p_leccion
   where q.activa and (q.leccion_id = l.id or (q.leccion_id is null and (q.servicio_id = l.servicio_id or q.servicio_id is null)))
   order by (q.leccion_id is not null) desc, (q.servicio_id is not null) desc, md5(q.id::text || p_leccion::text) limit 4;
$$;
create or replace function public.aula_quiz(p_leccion uuid)
returns table (id uuid, tema text, pregunta text, opciones text[])
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare l public.lecciones;
begin
  select * into l from public.lecciones where lecciones.id = p_leccion;
  if l.id is null or not public.puede_ver_leccion(l.servicio_id, l.variante_id, l.mes) then raise exception 'MES_BLOQUEADO' using errcode = '42501'; end if;
  return query select q.id, q.tema, q.pregunta, q.opciones from public._quiz_sel(p_leccion) q;
end $$;
create or replace function public.aula_responder_quiz(p_leccion uuid, p_respuestas jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare l public.lecciones; q record; ok int := 0; n int := 0; det jsonb := '[]'::jsonb; r int;
begin
  select * into l from public.lecciones where id = p_leccion;
  if l.id is null or not public.puede_ver_leccion(l.servicio_id, l.variante_id, l.mes) then raise exception 'MES_BLOQUEADO' using errcode = '42501'; end if;
  if (select count(*) from public.aula_quiz_resultados x where x.user_id = auth.uid() and x.creado > now() - interval '1 hour') >= 30 then
    raise exception 'DEMASIADOS_INTENTOS' using errcode = 'P0001'; end if;
  for q in select * from public._quiz_sel(p_leccion) loop
    n := n + 1; begin r := (p_respuestas ->> q.id::text)::int; exception when others then r := null; end;
    if r = q.correcta then ok := ok + 1; end if;
    det := det || jsonb_build_object('id', q.id, 'bien', r = q.correcta, 'correcta', q.correcta);
  end loop;
  insert into public.aula_quiz_resultados (user_id, leccion_id, correctas, total, respuestas) values (auth.uid(), p_leccion, ok, n, coalesce(p_respuestas, '{}'::jsonb));
  return jsonb_build_object('correctas', ok, 'total', n, 'detalle', det);
end $$;

-- Entregas: cuestionario hecho antes de la práctica + alertas
create or replace function public._entrega_validar_quiz()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if public.es_admin() then return new; end if;
  if new.leccion_id is not null and exists (select 1 from public._quiz_sel(new.leccion_id))
     and not exists (select 1 from public.aula_quiz_resultados r where r.user_id = auth.uid() and r.leccion_id = new.leccion_id) then
    raise exception 'FALTA_CUESTIONARIO' using errcode = 'P0001'; end if;
  new.flags := public._aula_flags(auth.uid(), new.captura, 3); new.rubrica := null; new.portafolio := false;
  return new;
end $$;
drop trigger if exists entrega_validar_quiz on public.entregas;
create trigger entrega_validar_quiz before insert on public.entregas for each row execute function public._entrega_validar_quiz();
grant insert (leccion_id) on public.entregas to authenticated;

-- Corregir con rúbrica (nota final = promedio redondeado)
create or replace function public._rubrica_nota(p jsonb)
returns smallint language sql immutable as $$
  select case when p is null or jsonb_typeof(p) <> 'object' or (select count(*) from jsonb_each_text(p)) = 0 then null
              else round((select avg(v::numeric) from jsonb_each_text(p) t(k, v)))::smallint end;
$$;
create or replace function public.admin_calificar_rubrica(p_id uuid, p_estado text, p_rubrica jsonb, p_comentario text)
returns public.entregas language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare e public.entregas; v text;
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  if p_rubrica is not null then
    for v in select value from jsonb_each_text(p_rubrica) loop
      if v !~ '^[1-5]$' then raise exception 'RUBRICA_INVALIDA' using errcode = 'P0001'; end if; end loop;
  end if;
  e := public.admin_calificar(p_id, public._rubrica_nota(p_rubrica), p_comentario, p_estado);
  update public.entregas set rubrica = case when p_estado = 'anulada_ia' then null else p_rubrica end where id = p_id returning * into e;
  return e;
end $$;

-- Portafolio (privado: solo la alumna y Tania lo ven)
create or replace function public.aula_portafolio(p_entrega uuid, p_incluir boolean)
returns boolean language plpgsql volatile security definer set search_path = public, pg_temp
as $$
begin
  update public.entregas set portafolio = p_incluir where id = p_entrega and user_id = auth.uid() and estado = 'corregida';
  if not found then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  return p_incluir;
end $$;

-- 7. Exámenes por mérito
create table if not exists public.aula_examen_codigos (
  examen_id uuid primary key references public.aula_examenes (id) on delete cascade,
  codigo text not null check (codigo ~ '^[0-9]{4}$'),
  vence timestamptz not null,
  fallos int not null default 0,
  usado boolean not null default false,
  creado timestamptz not null default now()
);
alter table public.aula_examen_codigos enable row level security;
revoke all on public.aula_examen_codigos from anon, authenticated;   -- solo por funciones

create or replace function public.aula_pedir_examen(p_curso text, p_preferencia text default '')
returns public.aula_examenes language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare i public.inscripciones := public._aula_mi_insc(p_curso); r public.aula_examenes; n int; cfg public.aula_config_curso := public._aula_cfg(p_curso);
begin
  if i.id is null then raise exception 'SIN_ACCESO_AL_CURSO' using errcode = '42501'; end if;
  if not public._aula_mes_completo(i.id, i.meses_habilitados) then raise exception 'FALTAN_CLASES_APROBADAS' using errcode = 'P0001'; end if;
  if exists (select 1 from public.aula_examenes x where x.user_id = auth.uid() and x.servicio_id = p_curso and x.mes = i.meses_habilitados and x.estado = 'aprobado') then
    raise exception 'EXAMEN_YA_APROBADO' using errcode = 'P0001'; end if;
  if exists (select 1 from public.aula_examenes x where x.user_id = auth.uid() and x.servicio_id = p_curso and x.estado in ('solicitado', 'agendado', 'en_curso', 'entregado')) then
    raise exception 'EXAMEN_YA_PEDIDO' using errcode = 'P0001'; end if;
  select count(*) into n from public.aula_examenes x where x.user_id = auth.uid() and x.servicio_id = p_curso and x.mes = i.meses_habilitados and x.estado = 'desaprobado';
  if n >= cfg.max_intentos then raise exception 'SIN_INTENTOS' using errcode = 'P0001'; end if;
  insert into public.aula_examenes (user_id, servicio_id, mes, preferencia, intento)
  values (auth.uid(), p_curso, i.meses_habilitados, left(btrim(coalesce(p_preferencia, '')), 300), n + 1) returning * into r;
  return r;
end $$;

-- Tania inicia la videollamada: código de 4 dígitos, 15 minutos
create or replace function public.admin_examen_codigo(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare c text := lpad((floor(random() * 10000))::int::text, 4, '0'); v timestamptz := now() + interval '15 minutes'; x public.aula_examenes;
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  select * into x from public.aula_examenes where id = p_id;
  if x.id is null or x.estado not in ('solicitado', 'agendado', 'en_curso') then raise exception 'EXAMEN_NO_DISPONIBLE' using errcode = 'P0001'; end if;
  insert into public.aula_examen_codigos (examen_id, codigo, vence) values (p_id, c, v)
  on conflict (examen_id) do update set codigo = excluded.codigo, vence = excluded.vence, fallos = 0, usado = false, creado = now();
  update public.aula_examenes set estado = 'en_curso', actualizado = now() where id = p_id;
  return jsonb_build_object('codigo', c, 'vence', v);
end $$;

create or replace function public._aula_examen_ventana(p_examen uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.aula_examen_codigos c join public.aula_examenes x on x.id = c.examen_id
                  where c.examen_id = p_examen and x.user_id = auth.uid() and x.estado = 'en_curso'
                    and not c.usado and c.fallos < 5 and c.vence > now());
$$;
create or replace function public.aula_examen_validar(p_id uuid, p_codigo text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare c public.aula_examen_codigos; x public.aula_examenes;
begin
  select * into x from public.aula_examenes where id = p_id and user_id = auth.uid();
  if x.id is null then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  select * into c from public.aula_examen_codigos where examen_id = p_id;
  if c.examen_id is null or c.usado or c.vence <= now() or x.estado <> 'en_curso' then raise exception 'CODIGO_VENCIDO' using errcode = 'P0001'; end if;
  if c.fallos >= 5 then raise exception 'CODIGO_BLOQUEADO' using errcode = 'P0001'; end if;
  if c.codigo <> btrim(coalesce(p_codigo, '')) then
    update public.aula_examen_codigos set fallos = fallos + 1 where examen_id = p_id;
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'vence', c.vence, 'video_requerido', (public._aula_cfg(x.servicio_id)).video_requerido);
end $$;

-- Subir el examen: 3 fotos (sin maquillaje, mitad, final) + video corto, con código válido
create or replace function public.aula_examen_subir(p_id uuid, p_codigo text, p_fotos text[], p_video text, p_captura jsonb)
returns public.aula_examenes language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare x public.aula_examenes; v jsonb; f text; pre text := auth.uid()::text || '/' || p_id::text || '/';
begin
  v := public.aula_examen_validar(p_id, p_codigo);
  if not (v ->> 'ok')::boolean then raise exception 'CODIGO_INVALIDO' using errcode = 'P0001'; end if;
  select * into x from public.aula_examenes where id = p_id;
  if cardinality(p_fotos) is distinct from 3 then raise exception 'FALTAN_FOTOS' using errcode = 'P0001'; end if;
  foreach f in array p_fotos loop
    if f !~ ('^' || pre || '[0-9a-f-]{36}\.jpg$') or not exists (select 1 from storage.objects o where o.bucket_id = 'examenes' and o.name = f) then
      raise exception 'FOTO_INVALIDA' using errcode = 'P0001'; end if;
  end loop;
  if p_video is not null and (p_video !~ ('^' || pre || '[0-9a-f-]{36}\.(webm|mp4)$') or not exists (select 1 from storage.objects o where o.bucket_id = 'examenes' and o.name = p_video)) then
    raise exception 'VIDEO_INVALIDO' using errcode = 'P0001'; end if;
  if p_video is null and (v ->> 'video_requerido')::boolean then raise exception 'FALTA_VIDEO' using errcode = 'P0001'; end if;
  update public.aula_examen_codigos set usado = true where examen_id = p_id;
  update public.aula_examenes set fotos = p_fotos, video = p_video,
         captura = coalesce(p_captura, '{}'::jsonb) || jsonb_build_object('recibida', now()),
         flags = public._aula_flags(auth.uid(), p_captura, 2), estado = 'entregado', entregado_en = now(), actualizado = now()
   where id = p_id returning * into x;
  return x;
end $$;

-- Tania califica el examen (rúbrica + comentario). Si aprueba, intenta abrir el mes / emitir certificado.
create or replace function public.admin_examen_calificar(p_id uuid, p_aprobado boolean, p_rubrica jsonb, p_comentario text)
returns public.aula_examenes language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare x public.aula_examenes; ins uuid;
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  update public.aula_examenes set estado = case when p_aprobado then 'aprobado' else 'desaprobado' end, rubrica = p_rubrica,
         nota_profe = nullif(btrim(coalesce(p_comentario, '')), ''), calificado_en = now(), actualizado = now()
   where id = p_id and estado in ('entregado', 'en_curso', 'aprobado', 'desaprobado') returning * into x;
  if x.id is null then raise exception 'EXAMEN_NO_DISPONIBLE' using errcode = 'P0001'; end if;
  if p_aprobado then
    select i.id into ins from public.inscripciones i join public.alumnos a on a.email = i.cliente_email
     where a.user_id = x.user_id and i.servicio_id = x.servicio_id and i.acceso and i.estado <> 'cancelada' order by i.meses_habilitados desc limit 1;
    if ins is not null then perform public._aula_intentar_abrir(ins); end if;
  end if;
  return x;
end $$;

-- admin_examen (anterior) ya no puede aprobar sin fotos: solo agendar o cancelar
create or replace function public.admin_examen(p_id uuid, p_estado text, p_fecha timestamptz default null, p_nota text default null)
returns public.aula_examenes language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare r public.aula_examenes;
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  if p_estado not in ('agendado', 'cancelado') then raise exception 'USAR_CALIFICAR_EXAMEN' using errcode = 'P0001'; end if;
  update public.aula_examenes set estado = p_estado, fecha = coalesce(p_fecha, fecha), nota_profe = coalesce(nullif(btrim(coalesce(p_nota, '')), ''), nota_profe), actualizado = now()
   where id = p_id and estado in ('solicitado', 'agendado', 'en_curso') returning * into r;
  if r.id is null then raise exception 'EXAMEN_NO_EXISTE' using errcode = 'P0001'; end if;
  return r;
end $$;

-- Bucket privado "examenes": fotos JPG y video corto; subir SOLO con la ventana del código abierta
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('examenes', 'examenes', false, 15728640, array['image/jpeg', 'video/webm', 'video/mp4'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists examenes_subir on storage.objects;
create policy examenes_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'examenes' and split_part(name, '/', 1) = auth.uid()::text
              and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|webm|mp4)$'
              and public._aula_examen_ventana(split_part(name, '/', 2)::uuid));
drop policy if exists examenes_leer on storage.objects;
create policy examenes_leer on storage.objects for select to authenticated
  using (bucket_id = 'examenes' and (split_part(name, '/', 1) = auth.uid()::text or public.es_admin()));
drop policy if exists examenes_borrar on storage.objects;
create policy examenes_borrar on storage.objects for delete to authenticated using (bucket_id = 'examenes' and public.es_admin());

-- 8. Progreso por mes (barra) para la alumna
create or replace function public.aula_progreso(p_curso text)
returns table (mes int, clases int, aprobadas int, enviadas int, quiz_hechos int, abierto boolean, completo boolean,
               examen_estado text, examen_id uuid, intentos int, max_intentos int, pago_estado text, plazo date, puede_pedir_examen boolean, certificado text)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare i public.inscripciones := public._aula_mi_insc(p_curso); tot int; m int; c record; cfg public.aula_config_curso := public._aula_cfg(p_curso); x public.aula_examenes;
begin
  if i.id is null then return; end if;
  tot := greatest(public._aula_meses_total(i.id), i.meses_habilitados);
  for m in 1..tot loop
    select * into c from public._aula_clases_mes(i.id, m);
    select * into x from public.aula_examenes e where e.user_id = auth.uid() and e.servicio_id = p_curso and e.mes = m and e.estado <> 'cancelado' order by e.creado desc limit 1;
    mes := m; clases := c.total; aprobadas := c.aprobadas; enviadas := c.enviadas; abierto := m <= i.meses_habilitados; completo := c.aprobadas >= c.total;
    quiz_hechos := (select count(distinct r.leccion_id)::int from public.aula_quiz_resultados r join public.lecciones l on l.id = r.leccion_id
                     where r.user_id = auth.uid() and l.servicio_id = p_curso and l.mes = m);
    examen_estado := x.estado; examen_id := x.id;
    intentos := (select count(*)::int from public.aula_examenes e where e.user_id = auth.uid() and e.servicio_id = p_curso and e.mes = m and e.estado in ('aprobado', 'desaprobado'));
    max_intentos := cfg.max_intentos;
    pago_estado := (select p.estado from public.aula_pagos p where p.inscripcion_id = i.id and p.mes = m order by p.creado desc limit 1);
    plazo := (select pl.vence from public.aula_plazos pl where pl.servicio_id = p_curso and pl.mes = m);
    puede_pedir_examen := m = i.meses_habilitados and completo and coalesce(x.estado, 'desaprobado') in ('desaprobado', 'cancelado')
                          and (select count(*) from public.aula_examenes e where e.user_id = auth.uid() and e.servicio_id = p_curso and e.mes = m and e.estado = 'desaprobado') < cfg.max_intentos;
    certificado := (select ce.codigo from public.aula_certificados ce where ce.inscripcion_id = i.id);
    return next;
  end loop;
end $$;

-- 9. Para Tania: exámenes con fotos/video/alertas y seguimiento (atrasadas)
create or replace function public.admin_examenes_aula2()
returns table (id uuid, servicio_id text, curso text, mes int, intento int, preferencia text, estado text, fecha timestamptz, nota_profe text,
               fotos text[], video text, flags jsonb, rubrica jsonb, captura jsonb, creado timestamptz, entregado_en timestamptz,
               nombre text, telefono text, email text, codigo_vence timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  return query select x.id, x.servicio_id, s.nombre, x.mes, x.intento, x.preferencia, x.estado, x.fecha, x.nota_profe, x.fotos, x.video, x.flags, x.rubrica, x.captura,
         x.creado, x.entregado_en, coalesce(pf.nombre, ''), coalesce(pf.telefono, ''), coalesce(pf.email, ''),
         (select c.vence from public.aula_examen_codigos c where c.examen_id = x.id and not c.usado)
    from public.aula_examenes x left join public.servicios s on s.id = x.servicio_id left join public.perfiles pf on pf.user_id = x.user_id
   where x.estado <> 'cancelado'
   order by (x.estado = 'entregado') desc, (x.estado in ('en_curso', 'solicitado', 'agendado')) desc, x.creado desc limit 300;
end $$;

create or replace function public.admin_aula_seguimiento()
returns table (inscripcion_id uuid, nombre text, telefono text, curso text, servicio_id text, mes int, clases int, aprobadas int, enviadas int,
               ultima_entrega timestamptz, plazo date, atrasada boolean, examen_estado text, certificado text)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare hoy date := (now() at time zone 'America/Asuncion')::date;
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  return query
  with b as (select i.*, public._aula_uid_de(i.id) uid from public.inscripciones i where i.acceso and i.estado <> 'cancelada')
  select b.id, coalesce(pf.nombre, b.cliente_nombre), coalesce(nullif(pf.telefono, ''), b.cliente_telefono), b.curso_nombre, b.servicio_id, b.meses_habilitados,
         c.total, c.aprobadas, c.enviadas,
         (select max(e.creado) from public.entregas e where e.user_id = b.uid and e.servicio_id = b.servicio_id),
         pl.vence,
         pl.vence is not null and pl.vence < hoy and not coalesce((select true from public.aula_examenes x where x.user_id = b.uid and x.servicio_id = b.servicio_id and x.mes = b.meses_habilitados and x.estado = 'aprobado' limit 1), false),
         (select x.estado from public.aula_examenes x where x.user_id = b.uid and x.servicio_id = b.servicio_id and x.mes = b.meses_habilitados and x.estado <> 'cancelado' order by x.creado desc limit 1),
         (select ce.codigo from public.aula_certificados ce where ce.inscripcion_id = b.id)
    from b left join public.perfiles pf on pf.user_id = b.uid
    left join public.aula_plazos pl on pl.servicio_id = b.servicio_id and pl.mes = b.meses_habilitados
    cross join lateral public._aula_clases_mes(b.id, b.meses_habilitados) c
   order by 12 desc, 2;
end $$;

create or replace function public.admin_emitir_certificado(p_insc uuid)
returns text language plpgsql volatile security definer set search_path = public, pg_temp
as $$ begin if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if; return public._aula_emitir_cert(p_insc); end $$;

-- 10. Preguntas iniciales (generales: higiene, tipos de piel, colorimetría, técnica). Solo si el banco está vacío.
do $$ begin
  if not exists (select 1 from public.aula_preguntas) then
    insert into public.aula_preguntas (tema, pregunta, opciones, correcta) values
    ('Higiene', '¿Qué se debe hacer con las brochas después de usarlas en cada clienta?', array['Guardarlas así para la próxima', 'Limpiarlas y desinfectarlas', 'Soplarlas para sacar el polvo', 'Pasarlas por un pañuelo'], 1),
    ('Higiene', '¿Cómo se toma el producto cremoso (base, corrector) de un envase?', array['Directo con la brocha', 'Con los dedos', 'Con una espátula, sobre una paleta', 'Con la esponja húmeda'], 2),
    ('Higiene', '¿Cuál es el primer paso antes de empezar a maquillar?', array['Aplicar la base', 'Lavarse las manos y limpiar el rostro de la clienta', 'Marcar las cejas', 'Poner rubor'], 1),
    ('Higiene', 'Si la clienta tiene una infección en el ojo (conjuntivitis), lo correcto es:', array['Maquillar con cuidado', 'No maquillar la zona de los ojos y recomendar consultar a un médico', 'Usar solo sombras claras', 'Usar el mismo aplicador para los dos ojos'], 1),
    ('Higiene', '¿Cada cuánto conviene renovar la máscara de pestañas?', array['Cada 3 meses aproximadamente', 'Cada 2 años', 'Nunca, si no se seca', 'Cuando cambia de color'], 0),
    ('Tipos de piel', 'Una piel con brillo en la zona T (frente, nariz y mentón) y mejillas normales es:', array['Seca', 'Grasa', 'Mixta', 'Sensible'], 2),
    ('Tipos de piel', 'Para una piel seca conviene usar:', array['Base matificante en polvo', 'Hidratante y base de textura cremosa o luminosa', 'Solo polvo traslúcido', 'Primer secante'], 1),
    ('Tipos de piel', 'Para una piel grasa, ¿qué producto ayuda a controlar el brillo?', array['Primer matificante y polvo traslúcido', 'Aceite facial', 'Iluminador en toda la cara', 'Bálsamo humectante'], 0),
    ('Tipos de piel', '¿Qué conviene hacer antes de usar un producto nuevo en una piel sensible?', array['Nada', 'Una prueba en una zona pequeña', 'Aplicar el doble de producto', 'Mezclarlo con agua'], 1),
    ('Colorimetría', '¿Qué color neutraliza las ojeras azuladas o violáceas?', array['Verde', 'Durazno / salmón', 'Lila', 'Blanco'], 1),
    ('Colorimetría', '¿Qué color de corrector neutraliza el enrojecimiento (granitos, rojeces)?', array['Verde', 'Amarillo', 'Rosa', 'Azul'], 0),
    ('Colorimetría', 'Los colores complementarios en el círculo cromático son los que están:', array['Uno al lado del otro', 'Opuestos', 'En la misma gama', 'Siempre fríos'], 1),
    ('Colorimetría', 'Para elegir el tono de base correcto, se prueba en:', array['La muñeca', 'La línea de la mandíbula', 'La frente', 'La mano'], 1),
    ('Colorimetría', 'Una piel con subtono cálido suele verse mejor con tonos:', array['Dorados y durazno', 'Plateados y rosados fríos', 'Grises', 'Azulados'], 0),
    ('Técnica', '¿Para qué sirve el primer o prebase?', array['Para quitar el maquillaje', 'Para preparar la piel y que el maquillaje dure más', 'Para dar color', 'Para reemplazar la base'], 1),
    ('Técnica', 'El difuminado correcto de una sombra se logra con:', array['Movimientos suaves y circulares o de vaivén', 'Presionando fuerte', 'Mucho producto de una vez', 'Brocha mojada'], 0),
    ('Técnica', '¿Dónde se aplica el contorno para afinar los pómulos?', array['Sobre el pómulo', 'Debajo del pómulo, hacia la oreja', 'En la punta de la nariz', 'En el párpado'], 1),
    ('Técnica', '¿Para qué se usa el polvo traslúcido?', array['Para sellar y fijar el maquillaje', 'Para dar color a las mejillas', 'Para iluminar', 'Para corregir ojeras'], 0);
  end if;
end $$;

-- Permisos
revoke all on function public._aula_mi_insc(text), public._aula_uid_de(uuid), public._aula_cfg(text), public._aula_meses_total(uuid),
  public._aula_clases_mes(uuid, int), public._aula_mes_completo(uuid, int), public._aula_emitir_cert(uuid), public._aula_intentar_abrir(uuid),
  public._aula_flags(uuid, jsonb, numeric), public._quiz_sel(uuid), public._entrega_validar_quiz(), public._aula_examen_ventana(uuid)
  from public, anon, authenticated;
grant execute on function public._aula_examen_ventana(uuid) to authenticated;   -- usada por la política del bucket
revoke all on function public.verificar_certificado(text), public.aula_quiz(uuid), public.aula_responder_quiz(uuid, jsonb),
  public.admin_calificar_rubrica(uuid, text, jsonb, text), public.aula_portafolio(uuid, boolean), public.admin_examen_codigo(uuid),
  public.aula_examen_validar(uuid, text), public.aula_examen_subir(uuid, text, text[], text, jsonb), public.admin_examen_calificar(uuid, boolean, jsonb, text),
  public.aula_progreso(text), public.admin_examenes_aula2(), public.admin_aula_seguimiento(), public.admin_emitir_certificado(uuid) from public, anon;
grant execute on function public.verificar_certificado(text) to anon, authenticated;
grant execute on function public.aula_quiz(uuid), public.aula_responder_quiz(uuid, jsonb), public.admin_calificar_rubrica(uuid, text, jsonb, text),
  public.aula_portafolio(uuid, boolean), public.admin_examen_codigo(uuid), public.aula_examen_validar(uuid, text),
  public.aula_examen_subir(uuid, text, text[], text, jsonb), public.admin_examen_calificar(uuid, boolean, jsonb, text),
  public.aula_progreso(text), public.admin_examenes_aula2(), public.admin_aula_seguimiento(), public.admin_emitir_certificado(uuid) to authenticated;


-- Lista para corregir con rúbrica, alertas y clase (devuelve jsonb por fila para no depender de columnas)
create or replace function public.admin_entregas3(p_curso text default null, p_estado text default null)
returns setof jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then raise exception 'NO_AUTORIZADO' using errcode = '42501'; end if;
  return query select to_jsonb(e) || jsonb_build_object('nombre', coalesce(p.nombre, e.email), 'telefono', coalesce(p.telefono, ''), 'curso', s.nombre, 'leccion', l.titulo)
    from public.entregas e left join public.perfiles p on p.user_id = e.user_id left join public.servicios s on s.id = e.servicio_id
    left join public.lecciones l on l.id = e.leccion_id
   where (p_curso is null or e.servicio_id = p_curso) and (p_estado is null or e.estado = p_estado)
   order by (e.estado = 'enviada') desc, e.creado desc limit 500;
end $$;
revoke all on function public.admin_entregas3(text, text) from public, anon;
grant execute on function public.admin_entregas3(text, text) to authenticated;

do $$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['aula_certificados', 'aula_quiz_resultados'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

select 'migracion-aula-merito OK' as resultado;
