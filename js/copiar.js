// Botones "Copiar" para los datos de transferencia (los valores salen de datos_pago, nunca fijos).
function campo(texto, re) {
  for (const l of String(texto || '').split(/\r?\n|·/)) {
    const m = l.match(re);
    if (m) return m[1].trim();
  }
  return '';
}
export function extraerDatosPago(texto) {
  let alias = campo(texto, /^\s*alias\s*[:\-]?\s*(.+)$/i);
  // "Cédula 5255884", "CI 5.255.884" o solo números: se copian únicamente los dígitos.
  if (/^[^\d@]*\d[\d.\s-]*$/.test(alias)) alias = alias.replace(/\D/g, '');
  const cuenta = campo(texto, /^\s*(?:n[º°ro.]*\s*(?:de\s*)?)?cuenta[^:]*[:\-]?\s*(.+)$/i).replace(/[^\d-]/g, '');
  return { alias, cuenta, todo: String(texto || '').trim() };
}
async function copiarTexto(t) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(t); return true; } } catch (e) { /* fallback */ }
  const ta = document.createElement('textarea');
  ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  (document.querySelector('dialog[open]') || document.body).appendChild(ta);
  ta.select(); ta.setSelectionRange(0, t.length);
  let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove(); return ok;
}
function toast(cont, texto) {
  const host = cont.closest('dialog') || document.body;
  let el = host.querySelector(':scope > .copiado-toast');
  if (!el) { el = document.createElement('div'); el.className = 'copiado-toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); host.appendChild(el); }
  el.textContent = texto; el.classList.add('visible');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('visible'), 2000);
}
const escH = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function botonesCopiar(texto) {
  const d = extraerDatosPago(texto);
  const b = (v, et) => v ? `<button type="button" class="btn-copiar" data-copiar="${escH(v)}">⧉ ${et}</button>` : '';
  return `<div class="copiar-fila">${b(d.alias, 'Copiar alias')}${b(d.cuenta, 'Copiar cuenta')}${b(d.todo, 'Copiar todo')}</div>`;
}
export function activarCopiar(raiz) {
  raiz.addEventListener('click', async (e) => {
    const bt = e.target.closest('[data-copiar]'); if (!bt) return;
    const ok = await copiarTexto(bt.dataset.copiar);
    toast(bt, ok ? '✓ Copiado' : 'No se pudo copiar. Mantené apretado el texto para copiarlo.');
    if (ok) { bt.classList.add('ok'); setTimeout(() => bt.classList.remove('ok'), 1500); }
  });
}
