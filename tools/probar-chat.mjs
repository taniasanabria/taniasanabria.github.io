// Prueba del asistente: node tools/probar-chat.mjs  (usa data/catalogo.json). Falla si alguna respuesta no cumple.
import { readFileSync } from 'node:fs';
import { responder } from '../js/chat-motor.js';
const catalogo = JSON.parse(readFileSync(new URL('../data/catalogo.json', import.meta.url)));
const casos = [
  // [pregunta, debe contener (regex), chips que deben existir (regex sobre "tipo:valor"), contexto previo]
  ['precio maquillaje social', /Maquillaje Social\*\*[\s\S]*Gs\. 250\.000[\s\S]*Gs\. 100\.000/, /reservar:maquillaje-social/],
  ['cuanto sale el maquillaje de novia?', /Novias[\s\S]*Gs\. 1\.200\.000[\s\S]*Gs\. 200\.000/, /reservar:maquillaje-novias/],
  ['¿atienden domingos?', /[Dd]omingos[\s\S]*turno previo[\s\S]*costo adicional/, /whatsapp/],
  ['¿dónde quedan?', /Las Residentas 460 esq\. 8 de Diciembre[\s\S]*Fernando de la Mora/, /enlace:https:\/\/maps/],
  ['quiero reservar', /qué servicio/, /preguntar:#cat:maquillaje:reservar/],
  ['quiero reservar cejas', /Diseño y Perfilado de Cejas/, /reservar:cejas/],
  ['cursos', /Automaquillaje[\s\S]*Fotografía Beauty/, /preguntar:#srv:curso-fotografia-beauty:info/],
  ['la matricula de fotografia beauty', /Fotografía Beauty[\s\S]*Matrícula Gs\. 100\.000 \(total Gs\. 450\.000\)/, /reservar:curso-fotografia-beauty/],
  ['cuanto es la seña?', /total[\s\S]*seña[\s\S]*transferencia o QR/, /preguntar/],
  ['¿aceptan tarjeta?', /transferencia o QR[\s\S]*tarjeta, efectivo u otros/, /whatsapp/],
  ['horarios', /Lun a Vie: 09:00 a 20:00[\s\S]*Sáb: 09:00 a 16:00/, /preguntar/],
  ['cual es la capital de francia', /no tengo información/, /whatsapp/],
  ['hacen uñas?', /no tengo información|no lo sé/, /whatsapp/],
  ['hola', /ayudar/, /preguntar:precios/],
  ['quiero hablar con tania', /0976|976 122 979/, /whatsapp/],
  ['maquillaje con aerografo', /Aerógrafo[\s\S]*Gs\. 500\.000/, /reservar:maquillaje-aerografo/],
  ['quinceañera', /Quinceañeras[\s\S]*Gs\. 600\.000/, /reservar:maquillaje-quinceaneras/],
  ['precio 15 años', /Quinceañeras[\s\S]*Gs\. 600\.000/, /reservar/],
  ['glitter bar para cumple', /Glitter Bar[\s\S]*Gs\. 800\.000/, /reservar:glitter-bar/],
  ['curso de maquillaje artistico', /Regular \(3 Meses\)[\s\S]*Masterclass VIP/, /reservar:curso-artistico-regular[\s\S]*reservar:curso-artistico-masterclass/],
  ['maqullaje socail', /Maquillaje Social\*\*/, /reservar:maquillaje-social/],  // errores de tipeo
  ['precios', /categoría/, /preguntar:#cat:maquillaje:info/],
  ['#cat:maquillaje:info', /Maquillaje Social: Gs\. 250\.000/, /preguntar:#srv:maquillaje-social:info/],
  ['trenzas', /Kanekalon[\s\S]*A partir de Gs\. 200\.000/, /reservar:trenzas/],
  ['tocados', /Tocados[\s\S]*Gs\. 300\.000[\s\S]*seña de este servicio te la confirma Tania/, /reservar:tocados/],
  ['cuanto dura?', /Maquillaje Social: 1 hora/, /reservar:maquillaje-social/, 'maquillaje-social'],
  ['y la seña?', /Gs\. 100\.000/, /reservar:maquillaje-social/, 'maquillaje-social'],
  ['¿hacen a domicilio?', /domicilio/i, /whatsapp/],
  ['si llego tarde al maquillaje social?', /10 minutos de tolerancia/, /reservar/],
  ['quiero cancelar mi turno', /WhatsApp[\s\S]*no reembolsable/, /whatsapp/],
  ['instagram', /WhatsApp/, /enlace:https:\/\/www\.instagram/],
  ['caritas pintadas para niños', /Caritas[\s\S]*Gs\. 250\.000 \/ hora/, /reservar:caritas-pintadas/],
  ['gracias!', /De nada/, /preguntar/],
  ['quiero inscribirme al curso inicial', /Maquillador Inicial/, /reservar:curso-maquillador-inicial/],
  ['maquillaje', /Maquillaje Social: Gs\. 250\.000/, /preguntar:#srv:/],
  ['precio de peinado', /No encontré «peinado»/, /whatsapp/],
  ['tienen estacionamiento?', /no tengo información/, /whatsapp/],
  ['tienen certificado los cursos?', /no tengo el dato/, /whatsapp/],
  ['cuánto cuesta el curso de automaquillaje y cuanto dura', /Gs\. 600\.000[\s\S]*1 jornada de 5 horas/, /reservar:curso-automaquillaje/],
  ['la matricula', /Sin matrícula[\s\S]*Fotografía Beauty: Gs\. 350\.000 \+ Matrícula Gs\. 100\.000/, /preguntar/],
  ['están abiertos ahora?', /Lun a Vie[\s\S]*Ahora mismo/, /preguntar/],
  ['quiero maquillarme para una boda el domingo', /turno previo[\s\S]*costo adicional/, /reservar:maquillaje-novias[\s\S]*whatsapp/],
  ['#srv:curso-fotografia-beauty:reservar', /Fotografía Beauty/, /reservar:curso-fotografia-beauty/],
];
let malos = 0;
const filas = [];
for (const [p, re, reChips, previo] of casos) {
  const estado = previo ? { ultimoServicio: previo } : {};
  const r = responder(p, catalogo, estado);
  const chips = r.chips.map((c) => `${c.tipo}:${c.valor}`).join(' | ');
  const ok = re.test(r.texto) && reChips.test(chips);
  // Ningún precio en la respuesta puede faltar en el catálogo
  const precios = r.texto.match(/Gs\. ?[\d.]+/g) || [];
  const fuente = JSON.stringify(catalogo);
  const inventados = precios.filter((x) => !fuente.includes(x.replace('Gs.', '').trim()));
  if (!ok || inventados.length) malos++;
  filas.push(`${ok && !inventados.length ? '✓' : '✗'} ${p}\n   → ${r.texto.replace(/\n/g, '\n     ')}\n   chips: ${chips}${inventados.length ? '\n   PRECIOS NO ENCONTRADOS: ' + inventados : ''}`);
}
console.log(filas.join('\n'));
console.log(`\n${casos.length - malos}/${casos.length} correctas`);
process.exit(malos ? 1 : 0);
