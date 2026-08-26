// ==UserScript==
// @name         MWG → Wadul Gus'e AutoFill Helper
// @namespace    mediawadulguse
// @version      1.26.8
// @description  Mengisi form tambah aduan Wadul Gus'e dari handoff Media Wadul Gus'e. Tidak pernah menekan tombol submit otomatis.
// @match        https://wadulgus.jemberkab.go.id/report/queue_reports/add*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  const PREFIX = '#mwg_autofill=';
  if (!location.hash.startsWith(PREFIX)) return;

  function decodePayload() {
    try {
      let s = location.hash.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      const binary = atob(s);
      const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      console.warn('[MWG AutoFill] Payload tidak dapat dibaca', e);
      return null;
    }
  }

  const payload = decodePayload();
  if (!payload) return;

  function norm(v) {
    return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function fieldText(el) {
    const id = el.id || '';
    const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    const parentLabel = el.closest('label');
    return norm([
      id,
      el.name,
      el.placeholder,
      el.getAttribute('aria-label'),
      label && label.textContent,
      parentLabel && parentLabel.textContent,
      el.closest('.form-group,.mb-3,.row,.col,.field')?.textContent?.slice(0, 180)
    ].filter(Boolean).join(' '));
  }

  function visible(el) {
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && !el.disabled && el.type !== 'hidden';
  }

  function candidates() {
    return [...document.querySelectorAll('input:not([type=hidden]):not([type=file]), textarea, select, [contenteditable="true"]')].filter(visible);
  }

  function score(el, keys) {
    const text = fieldText(el);
    let n = 0;
    keys.forEach((k, i) => {
      const nk = norm(k);
      if (!nk) return;
      if (text === nk) n += 100 - i;
      else if (text.includes(nk)) n += 30 - Math.min(i, 20);
    });
    return n;
  }

  function setValue(el, value) {
    if (value == null || String(value).trim() === '') return false;
    const v = String(value);
    if (el.matches('select')) {
      const wanted = norm(v);
      const option = [...el.options].find(o => norm(o.value) === wanted || norm(o.textContent) === wanted || norm(o.textContent).includes(wanted));
      if (!option) return false;
      el.value = option.value;
    } else if (el.isContentEditable) {
      el.textContent = v;
    } else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, v); else el.value = v;
    }
    ['input', 'change', 'blur'].forEach(type => el.dispatchEvent(new Event(type, { bubbles: true })));
    return true;
  }

  const mapping = [
    { key: 'judul', value: payload.judul, words: ['judul aduan', 'judul laporan', 'judul', 'title', 'subject', 'perihal'] },
    { key: 'deskripsi', value: payload.deskripsi, words: ['deskripsi aduan', 'uraian aduan', 'uraian', 'kronologi', 'deskripsi', 'isi laporan', 'isi aduan', 'laporan', 'aduan', 'description', 'message'] },
    { key: 'sumber', value: payload.sumber, words: ['sumber informasi', 'sumber', 'source'] },
    { key: 'link', value: payload.link, words: ['link sumber', 'tautan sumber', 'url sumber', 'link', 'tautan', 'url'] },
    { key: 'lokasi', value: payload.lokasi, words: ['lokasi kejadian', 'lokasi', 'alamat kejadian', 'alamat', 'location', 'address'] },
    { key: 'opd', value: payload.opd, words: ['opd tujuan', 'opd terkait', 'opd', 'dinas', 'instansi', 'unit tujuan'] }
  ];

  let filled = 0;
  const used = new Set();
  function fillOnce() {
    const fields = candidates();
    mapping.forEach(m => {
      if (!m.value || used.has(m.key)) return;
      let best = null, bestScore = 0;
      fields.forEach(el => {
        const s = score(el, m.words);
        if (s > bestScore) { best = el; bestScore = s; }
      });
      if (best && bestScore >= 20 && setValue(best, m.value)) {
        used.add(m.key);
        filled++;
        best.dataset.mwgAutofilled = '1';
      }
    });
    return filled;
  }

  function toast(message) {
    const box = document.createElement('div');
    box.textContent = message;
    Object.assign(box.style, {
      position: 'fixed', right: '18px', bottom: '18px', zIndex: '2147483647',
      maxWidth: '360px', padding: '12px 14px', borderRadius: '12px',
      background: '#4a1028', color: '#fff', font: '600 13px/1.45 system-ui,sans-serif',
      boxShadow: '0 14px 40px rgba(0,0,0,.22)'
    });
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 5000);
  }

  const run = () => {
    const before = filled;
    fillOnce();
    if (filled > before || filled > 0) {
      history.replaceState(null, document.title, location.pathname + location.search);
      toast(`MWG AutoFill: ${filled} kolom terisi. Periksa kembali sebelum menyimpan aduan.`);
      return true;
    }
    return false;
  };

  if (!run()) {
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if (run() || tries >= 20) {
        clearInterval(timer);
        if (!filled) toast('MWG AutoFill: field form tidak dikenali. Data tetap tersedia dari tombol Salin Data di Media Wadul Gus\'e.');
      }
    }, 500);
  }
})();
