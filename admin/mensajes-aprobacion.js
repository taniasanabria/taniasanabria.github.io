/* Mensaje de WhatsApp al aprobar una reserva ('r') o inscripción ('i'), según el estado del pago.
   Compartido por el panel (/admin/) y la app tania-agenda (copia idéntica en src/assets/).
   o: {tipo, nombre, servicio|curso, fecha, hora, monto, pago ('la seña'|'el total'|'la matrícula'),
       comprobante_estado ('enviado'|'verificado'|null), comprobante_ruta, plantilla, datos_pago}
   (a) comprobante recibido sin verificar → se agradece, SIN datos bancarios
   (b) pago verificado → se confirma el pago, SIN datos bancarios
   (c) sin comprobante → datos de transferencia (plantilla de Ajustes para turnos). */
(function (g) {
  function estadoPago(o) {
    if (o.comprobante_estado === 'verificado') return 'verificado';
    if (o.comprobante_ruta || o.comprobante_estado === 'enviado') return 'recibido';
    return 'sin';
  }
  function mensajeAprobacion(o) {
    const n = String(o.nombre || '').trim().split(/\s+/)[0] || '';
    const monto = o.monto || 'a coordinar';
    const pago = o.pago || (o.tipo === 'i' ? 'la matrícula' : 'la seña');
    const ep = estadoPago(o);
    const cab = o.tipo === 'i'
      ? `¡Hola ${n}! ✨ Soy Tania Sanabria, de la Academia. Tu inscripción al curso *${o.curso || ''}*${o.horario ? ` (${o.horario})` : ''} está aprobada ✅.`
      : `¡Hola ${n}! 💄 Soy Tania Sanabria. Tu turno de *${o.servicio || ''}* para el *${o.fecha || 'a coordinar'}* a las *${o.hora || 'a coordinar'}* está aprobado ✅.`;
    if (ep === 'recibido') return `${cab}\n\nYa recibimos tu comprobante de ${pago} de *${monto}*, ¡gracias! 🧾`;
    if (ep === 'verificado') return `${cab}\n\nTu pago de ${pago} de *${monto}* ya está confirmado ✅. ¡Gracias!`;
    const datos = o.datos_pago || '(te paso los datos de pago por aquí)';
    if (o.tipo !== 'i' && o.plantilla) {
      const v = { nombre: n, servicio: o.servicio || '', fecha: o.fecha || 'a coordinar', hora: o.hora || 'a coordinar', monto, pago, datos_pago: datos, sena: o.sena || monto, precio: o.precio || monto };
      return String(o.plantilla).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
    }
    return `${cab}\n\nPara confirmar${o.tipo === 'i' ? ' tu lugar' : 'lo'}, aboná ${pago} de *${monto}* a:\n${datos}\n\nEnviame el comprobante por aquí. ¡Gracias!`;
  }
  mensajeAprobacion.estadoPago = estadoPago;
  if (typeof module !== 'undefined' && module.exports) module.exports = mensajeAprobacion; else g.mensajeAprobacion = mensajeAprobacion;
})(typeof window !== 'undefined' ? window : this);
