#!/bin/bash
# Pruebas del bloqueo por mes / nivel del Aula (contra la base LOCAL de /workspace/supa-local).
# Uso: tools/probar-aula-meses.sh   → imprime PASS/FAIL y sale con 1 si algo falla.
export PATH=/usr/lib/postgresql/17/bin:$PATH
S=/workspace/taniasanabria/site/supabase
cd /workspace/supa-local && ./reiniciar.sh >/dev/null 2>&1
P="psql -h /tmp -p 54322 -U postgres -d tania -q -v ON_ERROR_STOP=1"
for f in comprobantes cursos-matricula aula migracion-2026-11-02 migracion-aula-2026-11-02; do $P -f $S/$f.sql >/dev/null 2>&1 || { echo "FAIL SQL $f"; exit 1; }; done
$P -f $S/migracion-aula-2026-11-02.sql >/dev/null 2>&1 && echo "PASS migración idempotente (2da vez)" || echo "FAIL migración 2da vez"
U1=11111111-1111-1111-1111-111111111111; U2=22222222-2222-2222-2222-222222222222; ADM=33333333-3333-3333-3333-333333333333
$P >/dev/null <<SQL
insert into auth.users (id, email) values ('$U1','ana@example.com'), ('$U2','bea@example.com'), ('$ADM','tanialomaqui18@gmail.com');
insert into alumnos (email, codigo, user_id) values ('ana@example.com','ABCD-EFGH','$U1'), ('bea@example.com','ABCD-EFGJ','$U2');
insert into inscripciones (id, servicio_id, variante_id, curso_nombre, precio_ref, cliente_nombre, cliente_telefono, cliente_email, acceso, estado)
 values ('aaaaaaaa-0000-0000-0000-000000000001','curso-maquillaje-artistico','curso-artistico-regular','Artístico regular','Gs. 500.000 / mes','Ana','0981111111','ana@example.com',true,'pagada'),
        ('aaaaaaaa-0000-0000-0000-000000000002','curso-maquillaje-artistico','curso-artistico-masterclass','Artístico master','Gs. 500.000 / mes','Bea','0981222222','bea@example.com',true,'pagada');
insert into lecciones (servicio_id, modulo, titulo, tipo, archivo, mes, variante_id) values
 ('curso-maquillaje-artistico','Módulo 1','M1 todos','archivo','curso-maquillaje-artistico/00000000-0000-0000-0000-000000000001.pdf',1,null),
 ('curso-maquillaje-artistico','Módulo 2','M2 todos','archivo','curso-maquillaje-artistico/00000000-0000-0000-0000-000000000002.pdf',2,null),
 ('curso-maquillaje-artistico','Módulo 1','M1 regular','archivo','curso-maquillaje-artistico/00000000-0000-0000-0000-000000000003.pdf',1,'curso-artistico-regular'),
 ('curso-maquillaje-artistico','Módulo 1','M1 master','archivo','curso-maquillaje-artistico/00000000-0000-0000-0000-000000000004.pdf',1,'curso-artistico-masterclass');
insert into storage.objects (bucket_id, name) values ('pagos-aula','$U1/99999999-9999-9999-9999-999999999999.jpg'),
 ('cursos','curso-maquillaje-artistico/00000000-0000-0000-0000-000000000002.pdf');
SQL
como() { local u=$1 e=$2; shift 2; $P -tA -c "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$u\",\"email\":\"$e\",\"role\":\"authenticated\"}', true); $*; rollback;" 2>&1 | tail -n +2 | grep -v '^ROLLBACK\|^BEGIN\|^SET' ; }
chk() { if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1 (esperado '$3', obtuvo '$2')"; FALLO=1; fi; }
A="$U1 ana@example.com"; B="$U2 bea@example.com"; T="$ADM tanialomaqui18@gmail.com"
chk "Ana (regular, mes 1) ve solo M1 todos + M1 regular" "$(como $A "select string_agg(titulo, ',' order by titulo) from lecciones")" "M1 regular,M1 todos"
chk "Bea (master) no ve el material de otro nivel" "$(como $B "select string_agg(titulo, ',' order by titulo) from lecciones")" "M1 master,M1 todos"
chk "PDF del mes 2 bloqueado en Storage" "$(como $A "select count(*) from storage.objects where bucket_id='cursos'")" "0"
chk "Programa muestra mes 2 cerrado" "$(como $A "select string_agg(mes||':'||abierto, ',') from aula_programa('curso-maquillaje-artistico')")" "1:true,2:false"
chk "Entrega en mes 2 rechazada" "$(como $A "insert into entregas (servicio_id, titulo, fotos, mes) values ('curso-maquillaje-artistico','xx',array['$U1/12345678-1234-1234-1234-123456789012.jpg'],2)" | grep -o MES_BLOQUEADO)" "MES_BLOQUEADO"
chk "Entrega en mes 1 aceptada (mes por defecto)" "$(como $A "insert into entregas (servicio_id, titulo, fotos, captura) values ('curso-maquillaje-artistico','xx',array['$U1/12345678-1234-1234-1234-123456789012.jpg'],'{\"origen\":\"camara-en-vivo\"}') returning mes || ':' || (captura ? 'recibida')")" "1:true"
chk "Alumna no puede abrirse el mes sola (update inscripciones)" "$(como $A "update inscripciones set meses_habilitados = 5 returning 1" | wc -l)" "0"
chk "Alumna no puede confirmar su pago" "$(como $A "select admin_revisar_pago_aula(gen_random_uuid(), true)" | grep -o NO_AUTORIZADO)" "NO_AUTORIZADO"
chk "Datos bancarios: Bea no puede ver los de la inscripción de Ana" "$(como $B "select aula_datos_pago('aaaaaaaa-0000-0000-0000-000000000001')" | grep -o NO_AUTORIZADO)" "NO_AUTORIZADO"
chk "Comprobante con ruta ajena rechazado" "$(como $B "select aula_enviar_pago('aaaaaaaa-0000-0000-0000-000000000002', '$U1/99999999-9999-9999-9999-999999999999.jpg')" | grep -o COMPROBANTE_INVALIDO)" "COMPROBANTE_INVALIDO"
# Flujo real (sin rollback): Ana envía comprobante del mes 2 → sigue bloqueado → Tania confirma → se abre
como2() { local u=$1 e=$2; shift 2; $P -tA -c "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$u\",\"email\":\"$e\",\"role\":\"authenticated\"}', true); $*; commit;" 2>&1 | sed -n 2p; }
chk "Ana envía comprobante: queda pendiente para el mes 2" "$(como2 $A "select mes||':'||estado from aula_enviar_pago('aaaaaaaa-0000-0000-0000-000000000001', '$U1/99999999-9999-9999-9999-999999999999.jpg')")" "2:pendiente"
chk "Segundo comprobante mientras hay uno pendiente: rechazado" "$(como $A "select aula_enviar_pago('aaaaaaaa-0000-0000-0000-000000000001', '$U1/99999999-9999-9999-9999-999999999999.jpg')" | grep -o PAGO_YA_ENVIADO)" "PAGO_YA_ENVIADO"
chk "Con pago pendiente el mes 2 sigue cerrado" "$(como $A "select count(*) from lecciones where mes = 2")" "0"
PID=$($P -tAc "select id from aula_pagos limit 1")
chk "Tania confirma el pago" "$(como2 $T "select estado from admin_revisar_pago_aula('$PID', true)")" "confirmado"
chk "Mes 2 abierto para Ana" "$(como $A "select string_agg(titulo, ',' order by titulo) from lecciones where mes = 2")" "M2 todos"
chk "PDF del mes 2 descargable" "$(como $A "select count(*) from storage.objects where bucket_id='cursos'")" "1"
chk "Bea sigue en mes 1" "$(como $B "select count(*) from lecciones where mes = 2")" "0"
EID=$(como2 $A "insert into entregas (servicio_id, titulo, fotos) values ('curso-maquillaje-artistico','foto IA',array['$U1/12345678-1234-1234-1234-123456789013.jpg']) returning id")
chk "Tania anula una entrega por IA" "$(como2 $T "select estado || ':' || coalesce(anulada_motivo,'') from admin_calificar('$EID', null, 'Foto generada con IA', 'anulada_ia')")" "anulada_ia:Foto generada con IA"
chk "Ana vuelve a presentar la clase anulada" "$(como $A "insert into entregas (servicio_id, titulo, fotos, reemplaza_id) values ('curso-maquillaje-artistico','reentrega',array['$U1/12345678-1234-1234-1234-123456789014.jpg'],'$EID') returning estado")" "enviada"
chk "Bea no puede reentregar algo ajeno" "$(como $B "insert into entregas (servicio_id, titulo, fotos, reemplaza_id) values ('curso-maquillaje-artistico','rr',array['$U2/12345678-1234-1234-1234-123456789014.jpg'],'$EID')" | grep -o REENTREGA_INVALIDA)" "REENTREGA_INVALIDA"
chk "Ana pide examen por videollamada" "$(como2 $A "select estado from aula_pedir_examen('curso-maquillaje-artistico', 'Tardes')")" "solicitado"
chk "No puede pedir dos exámenes a la vez" "$(como $A "select aula_pedir_examen('curso-maquillaje-artistico')" | grep -o EXAMEN_YA_PEDIDO)" "EXAMEN_YA_PEDIDO"
chk "Anónimo no lee pagos" "$($P -tA -c "begin; set local role anon; select count(*) from aula_pagos; rollback;" 2>&1 | grep -c 'permission denied')" "1"
exit ${FALLO:-0}
