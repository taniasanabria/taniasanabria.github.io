-- =====================================================================
-- Cursos: al inscribirse se paga SOLO la matrícula (decisión del 17/10/2026).
-- El curso se abona aparte, durante el curso, directamente a Tania (transferencia o QR).
-- Si el curso/opción no tiene matrícula: la inscripción se guarda sin pago y Tania la confirma.
--
-- Para la base que YA tiene cursos.sql instalado. IDEMPOTENTE: se puede correr varias veces.
-- Solo reemplaza funciones (no toca tablas ni datos). cursos.sql ya trae lo mismo para instalaciones nuevas.
-- =====================================================================

-- Matrícula de un curso o de una de sus opciones (Gs.; null = sin matrícula).
-- Curso: servicios.sena_gs (en el panel se llama "Matrícula"). Opción: variantes[].matricula (número)
-- o, en datos viejos, el número de variantes[].sena ("Gs. 100.000"). Misma regla que js/render.js → matriculaDe().
create or replace function public._matricula_de(s public.servicios, v jsonb)
returns bigint language plpgsql immutable set search_path = public, pg_temp
as $$
begin
  if v is not null then
    if jsonb_typeof(v -> 'matricula') = 'number' then return nullif(greatest((v ->> 'matricula')::numeric, 0)::bigint, 0); end if;
    return nullif(replace((regexp_match(coalesce(v ->> 'sena', ''), '(\d{1,3}(?:\.\d{3})+|\d+)'))[1], '.', '')::bigint, 0);
  end if;
  return nullif(s.sena_gs, 0);
end $$;

-- Inscripción: al inscribirse se paga SOLO la matrícula (transferencia o QR). El curso se abona aparte,
-- durante el curso, directamente a Tania. Sin matrícula: se inscribe sin pagar y Tania confirma el lugar.
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
  v_curso text; v_precio text; v_mat bigint; v_curso_gs bigint; v_id uuid; v_ref text; v_ref_precio text;
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
  v_precio := nullif(btrim(coalesce(case when v_var is not null then v_var ->> 'precio' else s.precio_texto end, '')), '');
  v_curso_gs := replace((regexp_match(coalesce(v_precio, ''), '(\d{1,3}(?:\.\d{3})+|\d+)'))[1], '.', '')::bigint;
  v_mat := public._matricula_de(s, v_var);
  v_ref_precio := left(concat_ws(' · ', 'Curso: ' || v_precio, coalesce('Matrícula: ' || public._gs(v_mat), 'Sin matrícula')), 300);

  insert into public.inscripciones (servicio_id, variante_id, curso_nombre, precio_ref, monto_gs,
                                    cliente_nombre, cliente_telefono, cliente_email, notas, origen)
  values (s.id, case when v_var is not null then p_curso end, v_curso, v_ref_precio, coalesce(v_mat, 0),
          v_nombre, v_tel, v_email, v_notas, 'web')
  returning id, referencia into v_id, v_ref;

  -- Reserva espejo: dispara el aviso push ya instalado (trigger avisar_reserva → Edge Function).
  insert into public.reservas (servicio_id, variante_id, servicio_nombre, precio_ref, bloquea, cliente_nombre,
                               cliente_telefono, cliente_email, notas, pago, estado, origen, inscripcion_id)
  values (s.id, case when v_var is not null then p_curso end, 'Inscripción: ' || v_curso, v_ref_precio, false, v_nombre,
          v_tel, v_email, 'Ref. ' || v_ref || coalesce(' · matrícula ' || public._gs(v_mat), ' · sin matrícula (confirmar)')
                          || coalesce(' · ' || v_notas, ''), 'total', 'pendiente', 'web', v_id);

  select * into p from public.ajustes_privados where id = 1;
  return jsonb_build_object(
    'ok', true, 'id', v_id, 'referencia', v_ref, 'curso', v_curso, 'precio', v_precio,
    'monto_gs', coalesce(v_mat, 0), 'matricula_gs', v_mat, 'curso_gs', v_curso_gs,
    'mensual', coalesce(v_precio, '') ~* '(mensual|/\s*mes|por mes)', 'sin_matricula', v_mat is null,
    -- Los datos de pago se entregan recién después de inscribirse, y solo si hay matrícula que pagar.
    'datos_pago', case when v_mat is not null then coalesce(p.datos_pago, '') end,
    'qr_pago', case when v_mat is not null then p.qr_pago end);
end $$;

revoke all on function public._matricula_de(public.servicios, jsonb) from public, anon, authenticated;

select 'Matrícula lista' as resultado,
       public._matricula_de(null::public.servicios, '{"sena": "Gs. 100.000"}'::jsonb) = 100000
         and public._matricula_de(null::public.servicios, '{"matricula": 0, "sena": "Gs. 100.000"}'::jsonb) is null
         and public._matricula_de(null::public.servicios, '{"sena": ""}'::jsonb) is null as matricula_ok,
       has_function_privilege('anon', 'public.crear_inscripcion(text, text, text, text, text)', 'execute') as anon_puede_inscribirse,
       not has_function_privilege('anon', 'public._crear_inscripcion(text, text, text, text, text)', 'execute') as interna_protegida;
