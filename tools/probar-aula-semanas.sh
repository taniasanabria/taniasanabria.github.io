#!/bin/bash
# Pruebas de la LIBERACIÓN SEMANAL de clases (base LOCAL /workspace/supa-local) + guía oral solo para admin.
export PATH=/usr/lib/postgresql/17/bin:$PATH
S=/workspace/taniasanabria/site/supabase
cd /workspace/supa-local && ./reiniciar.sh >/dev/null 2>&1
P="psql -h /tmp -p 54322 -U postgres -d tania -q -v ON_ERROR_STOP=1"
for f in comprobantes cursos-matricula aula migracion-2026-11-02 migracion-aula-2026-11-02 migracion-aula-merito-2026-11-02 seed-preguntas-banco-2026-11-02 migracion-aula-semanas-2026-11-02; do $P -f $S/$f.sql >/dev/null 2>&1 || { echo "FAIL SQL $f"; exit 1; }; done
$P -f $S/migracion-aula-semanas-2026-11-02.sql >/dev/null 2>&1 && echo "PASS migración semanal idempotente (2da vez)" || echo "FAIL 2da vez"
U1=11111111-1111-1111-1111-111111111111; U2=22222222-2222-2222-2222-222222222222; ADM=33333333-3333-3333-3333-333333333333; C=curso-maquillador-inicial
$P >/dev/null <<SQL
insert into auth.users (id, email) values ('$U1','ana@example.com'), ('$U2','bea@example.com'), ('$ADM','tanialomaqui18@gmail.com');
insert into alumnos (email, codigo, user_id) values ('ana@example.com','ABCD-EFGH','$U1'), ('bea@example.com','ABCD-EFGJ','$U2');
insert into inscripciones (servicio_id, curso_nombre, precio_ref, cliente_nombre, cliente_telefono, cliente_email, acceso, estado, acceso_desde) values
 ('$C','Inicial','-','Ana','0981111111','ana@example.com',true,'pagada', now() - interval '8 days'),
 ('$C','Inicial','-','Bea','0981222222','bea@example.com',true,'pagada', now());
insert into storage.objects (bucket_id, name) values ('cursos','$C/00000000-0000-0000-0000-000000000001.pdf'),('cursos','$C/00000000-0000-0000-0000-000000000002.pdf'),('cursos','$C/00000000-0000-0000-0000-000000000003.pdf');
insert into lecciones (servicio_id, titulo, tipo, archivo, archivo_nombre, url, mes, semana, orden) values
 ('$C','Clase 1 · Higiene','archivo','$C/00000000-0000-0000-0000-000000000001.pdf','INI-M1-C1-x.pdf',null,1,1,110),
 ('$C','Clase 2 · Herramientas','archivo','$C/00000000-0000-0000-0000-000000000002.pdf','INI-M1-C2-x.pdf',null,1,2,120),
 ('$C','Clase 3 · La piel','archivo','$C/00000000-0000-0000-0000-000000000003.pdf','INI-M1-C3-x.pdf',null,1,3,130),
 ('$C','Clase extra sin semana','enlace',null,null,'https://e.com/x',1,null,140);
update lecciones set url='https://e.com/x' where tipo='enlace';
SQL
q() { local u=$1 e=$2; shift 2; $P -tA -c "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$u\",\"email\":\"$e\",\"role\":\"authenticated\"}', true); $*; rollback;" 2>&1 | sed -n '2,$p' | grep -v '^ROLLBACK' | head -3 | tr '\n' ' ' | sed 's/ $//'; }
A() { q $U1 ana@example.com "$@"; }; B() { q $U2 bea@example.com "$@"; }; T() { q $ADM tanialomaqui18@gmail.com "$@"; }
chk() { if [[ "$2" == *"$3"* ]]; then echo "PASS $1"; else echo "FAIL $1 (esperado '$3', obtuvo '$2')"; FALLO=1; fi; }
chk "Bea (aprobada hoy) ve solo la semana 1 (+ la clase sin semana)" "$(B "select string_agg(titulo, ',' order by orden) from lecciones")" "Clase 1 · Higiene,Clase extra sin semana"
chk "Ana (aprobada hace 8 días) ve semanas 1 y 2, no la 3" "$(A "select string_agg(coalesce(semana::text,'-'), ',' order by orden) from lecciones")" "1,2,-"
chk "Bea no puede abrir el PDF de la semana 2 (Storage)" "$(B "select count(*) from storage.objects where bucket_id='cursos'")" "1"
chk "Ana: PDF de la semana 3 bloqueado" "$(A "select public.puede_ver_archivo('$C/00000000-0000-0000-0000-000000000003.pdf')")" "f"
chk "Calendario: Ana ve la semana 3 bloqueada con su fecha (aprobación + 14 días)" "$(A "select abierta||'|'||(abre = ((now() - interval '8 days') at time zone 'America/Asuncion')::date + 14) from aula_semanas('$C') where semana=3")" "false|true"
chk "Calendario de Bea: semana 2 abre en 7 días" "$(B "select abre - (now() at time zone 'America/Asuncion')::date from aula_semanas('$C') where semana=2")" "7"
L3=$($P -tAc "select id from lecciones where semana=3")
chk "No se puede entregar práctica de una semana cerrada" "$(A "insert into entregas (servicio_id, leccion_id, titulo, fotos) values ('$C','$L3','x',array['$U1/12345678-1234-1234-1234-123456789012.jpg'])")" "SEMANA_BLOQUEADA"
chk "No se puede hacer el cuestionario de una semana cerrada" "$(A "select aula_responder_quiz('$L3', '{}'::jsonb)")" "BLOQUEAD"
chk "Tania (admin) ve todas las clases" "$(T "select count(*) from lecciones")" "4"
chk "Guía oral: la alumna no la puede leer" "$(A "select count(*) from aula_examen_guia")" "0"
chk "Guía oral: Tania ve las 67 preguntas" "$(T "select count(*) from aula_examen_guia")" "67"
[ -z "$FALLO" ] && echo "TODO OK" || exit 1
