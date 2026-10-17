#!/usr/bin/env bash
# Instala los avisos push en Supabase (una sola vez; se puede repetir sin problema).
#
#   SUPABASE_ACCESS_TOKEN=sbp_xxx  bash tools/desplegar-avisos.sh
#
# El token personal se crea en https://supabase.com/dashboard/account/tokens (cuenta de Tania).
# Hace tres cosas:
#   1) ejecuta supabase/avisos.sql en la base (tablas + trigger con pg_net),
#   2) crea las claves VAPID y las guarda SOLO como secretos de la función (si todavía no existen),
#   3) despliega la Edge Function supabase/functions/avisar-reserva (sin Docker).
# Nada secreto se escribe en disco ni en el repositorio.
set -euo pipefail
REF="${SUPABASE_REF:-wfngdgqihtiqkokhxjqv}"
API="https://api.supabase.com/v1/projects/$REF"
: "${SUPABASE_ACCESS_TOKEN:?Falta SUPABASE_ACCESS_TOKEN (token personal de supabase.com/dashboard/account/tokens)}"
cd "$(dirname "$0")/.."
AUTH=(-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json")

echo "1/3 Ejecutando supabase/avisos.sql…"
node -e 'process.stdout.write(JSON.stringify({ query: require("fs").readFileSync("supabase/avisos.sql", "utf8") }))' \
  | curl -fsS "${AUTH[@]}" -X POST "$API/database/query" --data-binary @- ; echo

echo "2/3 Claves VAPID…"
if curl -fsS "${AUTH[@]}" "$API/secrets" | grep -q '"VAPID_PUBLIC_KEY"'; then
  echo "   Ya existen; se mantienen (cambiarlas obligaría a reactivar los avisos en cada celular)."
else
  node --input-type=module -e '
    import { generarClavesVapid } from "./supabase/functions/avisar-reserva/webpush.js";
    const v = await generarClavesVapid();
    process.stdout.write(JSON.stringify([
      { name: "VAPID_PUBLIC_KEY", value: v.publicKey },
      { name: "VAPID_PRIVATE_KEY", value: v.privateKey },
      { name: "VAPID_SUBJECT", value: "mailto:tanialomaqui18@gmail.com" },
    ]));' | curl -fsS "${AUTH[@]}" -X POST "$API/secrets" --data-binary @- >/dev/null
  echo "   Creadas y guardadas como secretos de Supabase."
fi

echo "3/3 Desplegando la Edge Function avisar-reserva…"
npx -y supabase@latest functions deploy avisar-reserva --project-ref "$REF" --no-verify-jwt --use-api

echo "Comprobación:"
curl -fsS "https://$REF.supabase.co/functions/v1/avisar-reserva"; echo
echo "Listo. Tania tiene que abrir el panel y tocar «Activar avisos» (una vez por celular)."
