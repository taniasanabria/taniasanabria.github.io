-- Fix 31/10/2026: el código de acceso de Tania SIEMPRE funciona como contraseña.
-- Causa: con el registro abierto del Aula, una alumna puede crear su cuenta con otra contraseña ANTES
-- de que Tania le dé acceso; después el código que recibe por WhatsApp no coincide con su cuenta.
-- Solución: cuando una ficha de alumna (alumnos) queda vinculada a una cuenta, la contraseña de esa
-- cuenta pasa a ser su código (el mensaje de Tania dice "con ese código entrás siempre"). Idempotente.
create or replace function public._alumno_clave_es_codigo()
returns trigger language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
begin
  if new.user_id is not null then
    update auth.users u set encrypted_password = extensions.crypt(new.codigo, extensions.gen_salt('bf')), updated_at = now()
     where u.id = new.user_id
       and (u.encrypted_password is null or u.encrypted_password = '' or u.encrypted_password <> extensions.crypt(new.codigo, u.encrypted_password));
  end if;
  return new;
end $$;
revoke all on function public._alumno_clave_es_codigo() from public, anon, authenticated;
drop trigger if exists alumno_clave_es_codigo on public.alumnos;
create trigger alumno_clave_es_codigo after insert or update of user_id, codigo on public.alumnos
  for each row execute function public._alumno_clave_es_codigo();
-- Corregir las cuentas ya existentes (no cambia ningún código)
update public.alumnos set codigo = codigo where user_id is not null;
select a.email, (u.encrypted_password = extensions.crypt(a.codigo, u.encrypted_password)) codigo_ok
  from public.alumnos a join auth.users u on u.id = a.user_id;
