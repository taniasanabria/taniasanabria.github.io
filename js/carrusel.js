/*
 * carrusel.js: carrusel 3D tipo "coverflow" con luz LED detrás de cada foto.
 * - Deslizar con el dedo o el mouse, flechas, teclado (← →) y puntos.
 * - Reproducción automática suave (solo si está a la vista, se pausa al tocar y
 *   se desactiva con "reducir movimiento").
 * - Tocar la foto del centro abre el visor (lo maneja app.js con data-lightbox);
 *   tocar una foto lateral la trae al centro.
 * Sin dependencias. Las fotos son <img loading="lazy">.
 */
const reducir = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const instancias = new Set();

function circular(d, n) {
  if (n < 3) return d;
  d = ((d % n) + n) % n;
  return d > n / 2 ? d - n : d;
}

class Carrusel {
  constructor(raiz) {
    this.raiz = raiz;
    this.pista = raiz.querySelector('.carrusel-pista');
    this.items = Array.from(this.pista.children);
    this.n = this.items.length;
    this.pos = 0;
    this.animacion = null;
    this.ultimoToque = 0;
    this.visible = false;
    raiz.classList.add('carrusel-activo');
    this.prev = raiz.querySelector('.carrusel-flecha.prev');
    this.sig = raiz.querySelector('.carrusel-flecha.sig');
    this.puntos = raiz.querySelector('.carrusel-puntos');
    if (this.prev) { this.prev.hidden = false; this.prev.addEventListener('click', () => this.mover(-1, true)); }
    if (this.sig) { this.sig.hidden = false; this.sig.addEventListener('click', () => this.mover(1, true)); }
    if (this.puntos) {
      this.puntos.innerHTML = this.items.map((_, i) => `<span data-punto="${i}"></span>`).join('');
      this.puntos.addEventListener('click', (e) => { const p = e.target.closest('[data-punto]'); if (p) this.ir(Number(p.dataset.punto), true); });
    }
    this.prepararArrastre();
    raiz.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.mover(-1, true); }
      if (e.key === 'ArrowRight') { e.preventDefault(); this.mover(1, true); }
    });
    raiz.addEventListener('focusin', (e) => {
      if (!e.target.matches(':focus-visible')) return;
      const i = this.items.indexOf(e.target.closest('.carrusel-item'));
      if (i >= 0 && i !== this.indice()) this.ir(i, true);
    });
    raiz.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this.encima = true; });
    raiz.addEventListener('pointerleave', () => { this.encima = false; });
    this.observador = new IntersectionObserver(([en]) => { this.visible = en.isIntersecting; if (this.visible) this.pintar(); }, { threshold: 0.35 });
    this.observador.observe(raiz);
    this.pintar();
  }

  indice() { return ((Math.round(this.pos) % this.n) + this.n) % this.n; }

  pintar() {
    const ancho = this.items[0].offsetWidth || 260;
    const angosto = window.innerWidth < 600;
    const paso = ancho * (angosto ? 0.56 : 0.62);
    const actual = this.indice();
    this.items.forEach((el, i) => {
      const d = circular(i - this.pos, this.n);
      const a = Math.abs(d);
      const lim = Math.max(-1.6, Math.min(1.6, d));
      const x = lim * paso + (d - lim) * paso * 0.35;
      const rot = Math.max(-1, Math.min(1, d)) * -42;
      const z = -Math.min(a, 3) * 150;
      const escala = 1 - Math.min(a, 3) * 0.06;
      el.style.transform = `translate(-50%, -50%) translate3d(${x.toFixed(1)}px, 0, ${z.toFixed(0)}px) rotateY(${rot.toFixed(1)}deg) scale(${escala.toFixed(3)})`;
      el.style.zIndex = String(100 - Math.round(a * 10));
      el.style.opacity = a > 2.6 ? '0' : String(1 - Math.max(0, a - 1.6) * 0.9);
      el.style.visibility = a > 3 ? 'hidden' : 'visible';
      el.style.setProperty('--foco', Math.max(0, 1 - a).toFixed(3));
      el.classList.toggle('centro', i === actual);
      el.tabIndex = i === actual ? 0 : -1;
      el.setAttribute('aria-hidden', a > 2.6 ? 'true' : 'false');
    });
    if (this.puntos) Array.from(this.puntos.children).forEach((p, i) => p.classList.toggle('activo', i === actual));
  }

  animarA(destino) {
    cancelAnimationFrame(this.animacion);
    if (reducir()) { this.pos = destino; this.normalizar(); this.pintar(); return; }
    const desde = this.pos; const t0 = performance.now(); const dur = 520;
    const paso = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      this.pos = desde + (destino - desde) * e;
      this.pintar();
      if (k < 1) this.animacion = requestAnimationFrame(paso); else this.normalizar();
    };
    this.animacion = requestAnimationFrame(paso);
  }

  normalizar() { if (this.n >= 3) this.pos = ((Math.round(this.pos) % this.n) + this.n) % this.n; else this.pos = Math.max(0, Math.min(this.n - 1, Math.round(this.pos))); }

  mover(paso, usuario) {
    if (usuario) this.ultimoToque = Date.now();
    let destino = Math.round(this.pos) + paso;
    if (this.n < 3) destino = Math.max(0, Math.min(this.n - 1, destino));
    this.animarA(destino);
  }

  ir(i, usuario) {
    if (usuario) this.ultimoToque = Date.now();
    this.animarA(Math.round(this.pos) + circular(i - this.pos, this.n));
  }

  prepararArrastre() {
    let ini = null; let movio = false; let muestras = [];
    const ancho = () => (this.items[0].offsetWidth || 260) * (window.innerWidth < 600 ? 0.56 : 0.62);
    this.raiz.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.carrusel-flecha, .carrusel-puntos')) return;
      cancelAnimationFrame(this.animacion);
      ini = { x: e.clientX, y: e.clientY, pos: this.pos, eje: null };
      movio = false; muestras = [{ x: e.clientX, t: performance.now() }];
      this.ultimoToque = Date.now();
    });
    const mover = (e) => {
      if (!ini) return;
      const dx = e.clientX - ini.x; const dy = e.clientY - ini.y;
      if (!ini.eje && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) ini.eje = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (ini.eje !== 'x') return;
      movio = true;
      this.raiz.classList.add('arrastrando');
      this.pos = ini.pos - dx / ancho();
      if (this.n < 3) this.pos = Math.max(-0.3, Math.min(this.n - 0.7, this.pos));
      muestras.push({ x: e.clientX, t: performance.now() }); if (muestras.length > 5) muestras.shift();
      this.pintar();
    };
    const soltar = () => {
      if (!ini) return;
      this.raiz.classList.remove('arrastrando');
      if (ini.eje === 'x') {
        const a = muestras[0]; const b = muestras[muestras.length - 1];
        const v = b && a && b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0; // px/ms
        let destino = Math.round(this.pos - v * 180 / ancho());
        if (Math.abs(destino - ini.pos) > 3) destino = Math.round(ini.pos) + Math.sign(destino - ini.pos) * 3;
        if (this.n < 3) destino = Math.max(0, Math.min(this.n - 1, destino));
        this.animarA(destino);
      } else if (!ini.eje) {
        this.normalizar();
      }
      ini = null;
    };
    window.addEventListener('pointermove', mover, { passive: true });
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
    // Clic: si hubo arrastre o la foto no está al centro, no se abre el visor (se centra).
    this.raiz.addEventListener('click', (e) => {
      const item = e.target.closest('.carrusel-item');
      if (!item) return;
      if (movio) { e.preventDefault(); e.stopPropagation(); movio = false; return; }
      const i = this.items.indexOf(item);
      if (i !== this.indice()) { e.preventDefault(); e.stopPropagation(); this.ir(i, true); }
    }, true);
  }

  tick() {
    if (!this.visible || this.encima || document.hidden || reducir() || this.n < 2) return;
    if (Date.now() - this.ultimoToque < 7000) return;
    if (this.raiz.closest('[hidden]') || document.querySelector('dialog.visor[open]')) return;
    this.mover(1, false);
  }
}

let reloj = null;
let medida = null;
export function iniciarCarruseles(raiz = document) {
  raiz.querySelectorAll('.carrusel:not(.carrusel-activo)').forEach((el) => {
    if (el.querySelector('.carrusel-item')) instancias.add(Object.assign(el, { _carrusel: new Carrusel(el) })._carrusel);
  });
  for (const c of instancias) if (!document.contains(c.raiz)) { c.observador.disconnect(); instancias.delete(c); }
  if (!reloj) reloj = setInterval(() => instancias.forEach((c) => c.tick()), 4200);
  if (!medida) {
    medida = () => instancias.forEach((c) => c.pintar());
    window.addEventListener('resize', medida, { passive: true });
  }
}

/** Volver a medir (p. ej. al mostrar un álbum o una vista que estaba oculta). */
export function refrescarCarruseles(raiz = document) {
  raiz.querySelectorAll('.carrusel.carrusel-activo').forEach((el) => el._carrusel && el._carrusel.pintar());
}
