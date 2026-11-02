#!/bin/bash
# Pruebas de la progresión por MÉRITO y del CÓDIGO de examen (base LOCAL /workspace/supa-local).
export PATH=/usr/lib/postgresql/17/bin:$PATH
S=/workspace/taniasanabria/site/supabase
cd /workspace/supa-local && ./reiniciar.sh >/dev/null 2>&1
P="psql -h /tmp -p 54322 -U postgres -d tania -q -v ON_ERROR_STOP=1"
for f in comprobantes cursos-matricula aula migracion-2026-11-02 migracion-aula-2026-11-02 migracion-aula-merito-2026-11-02; do $P -f $S/$f.sql >/dev/null 2>&1 || { echo "FAIL SQL $f"; exit 1; }; done
$P -f $S/migracion-aula-merito-2026-11-02.sql >/dev/null 2>&1 && echo "PASS migración de mérito idempotente (2da vez)" || echo "FAIL 2da vez"
U1=11111111-1111-1111-1111-111111111111; U2=22222222-2222-2222-2222-222222222222; ADM=33333333-3333-3333-3333-333333333333
I1=aaaaaaaa-0000-0000-0000-000000000001; C=curso-maquillaje-artistico
L1=00000000-0000-0000-0000-0000000000a1; L2=00000000-0000-0000-0000-0000000000a2; L3=00000000-0000-0000-0000-0000000000a3
$P >/dev/null <<SQL
insert into auth.users (id, email) values ('$U1','ana@example.com'), ('$U2','bea@example.com'), ('$ADM','tanialomaqui18@gmail.com');
insert into alumnos (email, codigo, user_id) values ('ana@example.com','ABCD-EFGH','$U1'), ('bea@example.com','ABCD-EFGJ','$U2');
insert into perfiles (user_id, email, nombre, telefono) values ('$U1','ana@example.com','Ana Pérez','0981111111');
insert into inscripciones (id, servicio_id, variante_id, curso_nombre, precio_ref, cliente_nombre, cliente_telefono, cliente_email, acceso, estado) values
 ('$I1','$C','curso-artistico-regular','Artístico regular','Gs. 500.000 / mes','Ana Pérez','0981111111','ana@example.com',true,'pagada'),
 ('aaaaaaaa-0000-0000-0000-000000000002','$C','curso-artistico-regular','Artístico regular','Gs. 500.000 / mes','Bea','0981222222','bea@example.com',true,'pagada');
insert into lecciones (id, servicio_id, titulo, tipo, url, mes) values ('$L1','$C','Clase 1','enlace','https://e.com/1',1), ('$L2','$C','Clase 2','enlace','https://e.com/2',1), ('$L3','$C','Clase 3','enlace','https://e.com/3',2);
insert into lecciones (servicio_id, titulo, tipo, url, mes, requiere_entrega) values ('$C','Teoría PDF','enlace','https://e.com/t',1,false);
insert into storage.objects (bucket_id, name) values ('pagos-aula','$U1/99999999-9999-9999-9999-999999999999.jpg');
SQL
q() { local u=$1 e=$2 fin=$3; shift 3; $P -tA -c "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$u\",\"email\":\"$e\",\"role\":\"authenticated\"}', true); $*; $fin;" 2>&1 | sed -n '2,$p' | grep -v '^COMMIT\|^ROLLBACK' | head -3 | tr '\n' ' ' | sed 's/ $//'; }
A() { q $U1 ana@example.com rollback "$@"; }; Ac() { q $U1 ana@example.com commit "$@"; }
B() { q $U2 bea@example.com rollback "$@"; }; Tc() { q $ADM tanialomaqui18@gmail.com commit "$@"; }
chk() { if [[ "$2" == *"$3"* ]]; then echo "PASS $1"; else echo "FAIL $1 (esperado '$3', obtuvo '$2')"; FALLO=1; fi; }
F=$U1/12345678-1234-1234-1234-12345678901
ent() { echo "insert into entregas (servicio_id, leccion_id, titulo, fotos, captura) values ('$C','$1','Práctica',array['${F}$2.jpg'],'$3'::jsonb) returning id"; }
CAP='{"origen":"camara-en-vivo","dispositivo":"d1","fotos":[{"tomada":"2026-11-02T15:00:00-03:00","dispositivo":"d1"}]}'
chk "No puede pedir examen sin clases aprobadas" "$(A "select aula_pedir_examen('$C')")" "FALTAN_CLASES_APROBADAS"
chk "Entregar una práctica exige el cuestionario antes" "$(A "$(ent $L1 1 "$CAP")")" "FALTA_CUESTIONARIO"
chk "El cuestionario no muestra la respuesta correcta" "$(A "select count(*) from aula_quiz('$L1')")|$(A "select string_agg(column_name, ',') from information_schema.columns where table_name = 'aula_quiz'")" "4|"
chk "La alumna no puede leer el banco de preguntas" "$(A "select count(*) from aula_preguntas")" "0"
chk "Cuestionario se corrige solo" "$(Ac "select (aula_responder_quiz('$L1', '{}'::jsonb))->>'total'")" "4"
Ac "select aula_responder_quiz('$L2', '{}'::jsonb)" >/dev/null
E1=$(Ac "$(ent $L1 1 "$CAP")"); E2=$(Ac "$(ent $L2 2 '{"origen":"camara-en-vivo","dispositivo":"d2","fotos":[{"tomada":"2026-11-02T08:00:00-03:00"},{"tomada":"2026-11-02T15:00:00-03:00"}]}')")
chk "Entrega con cuestionario hecho: aceptada" "$E1" "-"
chk "Alerta: fotos tomadas con horas de diferencia" "$($P -tAc "select flags ? 'fotos_separadas' from entregas where id='$E2'")" "t"
chk "Alerta: otro dispositivo" "$($P -tAc "select flags ? 'otro_dispositivo' from entregas where id='$E2'")" "t"
chk "Entregadas pero sin aprobar: todavía no hay examen" "$(A "select aula_pedir_examen('$C')")" "FALTAN_CLASES_APROBADAS"
chk "Rúbrica: nota = promedio" "$(Tc "select calificacion from admin_calificar_rubrica('$E1','corregida','{\"Prolijidad\":5,\"Difuminado\":4,\"Piel\":4,\"Cejas\":5,\"Ojos\":4}','Muy bien')")" "4"
chk "Rúbrica inválida rechazada" "$(Tc "select admin_calificar_rubrica('$E2','corregida','{\"Piel\":9}','x')")" "RUBRICA_INVALIDA"
Tc "select admin_calificar_rubrica('$E2','corregida','{\"Piel\":3}','ok')" >/dev/null
PG=$(Ac "select id from aula_enviar_pago('$I1', '$U1/99999999-9999-9999-9999-999999999999.jpg')"); Tc "select admin_revisar_pago_aula('$PG', true)" >/dev/null
chk "Pagar solo ya NO abre el mes" "$($P -tAc "select meses_habilitados from inscripciones where id='$I1'")" "1"
chk "Progreso: 2 de 2 clases aprobadas, puede pedir examen" "$(A "select clases||'/'||aprobadas||'/'||puede_pedir_examen from aula_progreso('$C') where mes=1")" "2/2/t"
X1=$(Ac "select id from aula_pedir_examen('$C','tarde')")
chk "Pide examen (todas aprobadas)" "$X1" "-"
chk "No puede pedir otro mientras hay uno abierto" "$(A "select aula_pedir_examen('$C')")" "EXAMEN_YA_PEDIDO"
EXP=$U1/$X1/aaaaaaaa-1111-2222-3333-44444444444
chk "Sin código: validar → vencido" "$(A "select aula_examen_validar('$X1','0000')")" "CODIGO_VENCIDO"
chk "Sin código: Storage no deja subir fotos del examen" "$(A "insert into storage.objects (bucket_id, name) values ('examenes','${EXP}1.jpg')")" "row-level security"
chk "Una alumna no puede generar el código" "$(A "select admin_examen_codigo('$X1')")" "NO_AUTORIZADO"
COD=$(Tc "select admin_examen_codigo('$X1')->>'codigo'")
chk "Tania genera código de 4 dígitos (15 min)" "$($P -tAc "select codigo ~ '^[0-9]{4}\$' and vence between now() + interval '14 minutes' and now() + interval '16 minutes' from aula_examen_codigos")" "t"
chk "Ana no puede leer el código de la tabla" "$(A "select count(*) from aula_examen_codigos")" "permission denied"
MAL=$( [ "$COD" = 1234 ] && echo 4321 || echo 1234 )
chk "Código incorrecto: no válido" "$(Ac "select aula_examen_validar('$X1','$MAL')->>'ok'")" "false"
chk "Bea no puede subir al examen de Ana" "$(B "insert into storage.objects (bucket_id, name) values ('examenes','${EXP}1.jpg')")" "row-level security"
Ac "insert into storage.objects (bucket_id, name) values ('examenes','${EXP}1.jpg'),('examenes','${EXP}2.jpg'),('examenes','${EXP}3.jpg'),('examenes','${EXP}4.webm')" >/dev/null
chk "Con ventana abierta Storage acepta las fotos" "$($P -tAc "select count(*) from storage.objects where bucket_id='examenes'")" "4"
FOT="array['${EXP}1.jpg','${EXP}2.jpg','${EXP}3.jpg']"
chk "Subir con código incorrecto: rechazado" "$(A "select aula_examen_subir('$X1','$MAL',$FOT,'${EXP}4.webm','{}')")" "CODIGO_INVALIDO"
chk "Faltan fotos (se exigen 3)" "$(A "select aula_examen_subir('$X1','$COD',array['${EXP}1.jpg'],'${EXP}4.webm','{}')")" "FALTAN_FOTOS"
chk "Video obligatorio" "$(A "select aula_examen_subir('$X1','$COD',$FOT,null,'{}')")" "FALTA_VIDEO"
chk "Examen subido con código válido" "$(Ac "select estado from aula_examen_subir('$X1','$COD',$FOT,'${EXP}4.webm','{\"dispositivo\":\"d1\",\"fotos\":[{\"tomada\":\"2026-11-02T15:00:00-03:00\"},{\"tomada\":\"2026-11-02T15:20:00-03:00\"}]}')")" "entregado"
chk "El código es de un solo uso" "$(A "insert into storage.objects (bucket_id, name) values ('examenes','${EXP}5.jpg')")" "row-level security"
chk "Ya no se puede aprobar sin fotos por la vía vieja" "$(Tc "select admin_examen('$X1','aprobado')")" "USAR_CALIFICAR_EXAMEN"
Tc "select admin_examen_calificar('$X1', false, '{\"Piel\":2}', 'Repasá el difuminado')" >/dev/null
chk "Desaprobado: el mes sigue cerrado" "$($P -tAc "select meses_habilitados from inscripciones where id='$I1'")" "1"
Tc "insert into aula_config_curso (servicio_id, max_intentos) values ('$C', 1)" >/dev/null
chk "Máximo de intentos configurable por curso" "$(A "select aula_pedir_examen('$C')")" "SIN_INTENTOS"
Tc "update aula_config_curso set max_intentos = 3, meses_total = 2 where servicio_id = '$C'" >/dev/null
X2=$(Ac "select id from aula_pedir_examen('$C')")
chk "Puede volver a rendir (intento 2)" "$($P -tAc "select intento from aula_examenes where id='$X2'")" "2"
COD2=$(Tc "select admin_examen_codigo('$X2')->>'codigo'")
for i in 1 2 3 4 5; do Ac "select aula_examen_validar('$X2','$( [ "$COD2" = 0000 ] && echo 1111 || echo 0000 )')" >/dev/null; done
chk "5 códigos errados: bloqueado" "$(A "select aula_examen_validar('$X2','$COD2')")" "CODIGO_BLOQUEADO"
COD2=$(Tc "select admin_examen_codigo('$X2')->>'codigo'")
$P -qc "update aula_examen_codigos set vence = now() - interval '1 minute' where examen_id='$X2'"
chk "Código vencido (más de 15 min)" "$(A "select aula_examen_validar('$X2','$COD2')")" "CODIGO_VENCIDO"
COD2=$(Tc "select admin_examen_codigo('$X2')->>'codigo'"); EXP2=$U1/$X2/bbbbbbbb-1111-2222-3333-44444444444
Ac "insert into storage.objects (bucket_id, name) values ('examenes','${EXP2}1.jpg'),('examenes','${EXP2}2.jpg'),('examenes','${EXP2}3.jpg'),('examenes','${EXP2}4.webm')" >/dev/null
Ac "select aula_examen_subir('$X2','$COD2',array['${EXP2}1.jpg','${EXP2}2.jpg','${EXP2}3.jpg'],'${EXP2}4.webm','{}')" >/dev/null
Tc "select admin_examen_calificar('$X2', true, '{\"Piel\":4}', 'Aprobado')" >/dev/null
chk "Examen aprobado + pago confirmado: mes 2 abierto" "$($P -tAc "select meses_habilitados from inscripciones where id='$I1'")" "2"
chk "Bea (sin mérito) sigue en mes 1" "$($P -tAc "select meses_habilitados from inscripciones where cliente_email='bea@example.com'")" "1"
# mes 2 (último): clase 3 + examen → certificado
Ac "select aula_responder_quiz('$L3', '{}'::jsonb)" >/dev/null; E3=$(Ac "$(ent $L3 3 "$CAP")"); Tc "select admin_calificar_rubrica('$E3','corregida','{\"Piel\":5}','')" >/dev/null
X3=$(Ac "select id from aula_pedir_examen('$C')"); COD3=$(Tc "select admin_examen_codigo('$X3')->>'codigo'"); EXP3=$U1/$X3/cccccccc-1111-2222-3333-44444444444
Ac "insert into storage.objects (bucket_id, name) values ('examenes','${EXP3}1.jpg'),('examenes','${EXP3}2.jpg'),('examenes','${EXP3}3.jpg'),('examenes','${EXP3}4.webm')" >/dev/null
Ac "select aula_examen_subir('$X3','$COD3',array['${EXP3}1.jpg','${EXP3}2.jpg','${EXP3}3.jpg'],'${EXP3}4.webm','{}')" >/dev/null
Tc "select admin_examen_calificar('$X3', true, '{\"Piel\":5}', 'Excelente')" >/dev/null
CERT=$($P -tAc "select codigo from aula_certificados")
chk "Último examen aprobado: certificado emitido" "$CERT" "TS-"
chk "Verificación pública muestra solo nombre, curso y fecha" "$($P -tA -c "begin; set local role anon; select (select string_agg(k, ',' order by k) from jsonb_object_keys(verificar_certificado('$CERT')) k) || '|' || (verificar_certificado('$CERT')->>'nombre'); rollback;" | sed -n 1p)" "codigo,curso,fecha,nombre,ok|Ana Pérez"
chk "Código de certificado falso: no válido" "$($P -tA -c "begin; set local role anon; select verificar_certificado('TS-AAAA-BBBB')->>'ok'; rollback;" | sed -n 1p)" "false"
chk "Portafolio: elige un trabajo aprobado" "$(Ac "select aula_portafolio('$E1', true)")" "t"
chk "Portafolio: Bea no puede tocar trabajos de Ana" "$(B "select aula_portafolio('$E1', false)")" "NO_AUTORIZADO"
Tc "insert into aula_plazos values ('$C', 1, current_date - 1)" >/dev/null
chk "Seguimiento: Bea atrasada (plazo vencido, mes sin aprobar)" "$(Tc "select atrasada from admin_aula_seguimiento() where nombre='Bea'")" "t"
chk "Seguimiento: solo Tania" "$(A "select count(*) from admin_aula_seguimiento()")" "NO_AUTORIZADO"
exit ${FALLO:-0}
