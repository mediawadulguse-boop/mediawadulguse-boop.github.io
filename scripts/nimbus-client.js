'use strict';
// This transport is included only by build:nimbus. The existing GitHub Pages build is unchanged.
window.NimbusAPI = {
  async call(action, payload = {}, options = {}) {
    const started = performance.now(),
      controller = new AbortController();
    const timeout =
      Number(options.timeoutMs || options.fetchTimeoutMs) ||
      (action === 'runBackupNow'
        ? 120000
        : /^(ai|analyze|refreshHotIssueDaily|testGemini)/.test(action)
          ? 95000
          : 20000);
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      if (
        location.protocol !== 'https:' &&
        !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
      )
        throw new Error(
          'Akses aplikasi melalui HTTPS untuk login dan penyimpanan data.',
        );
      const headers = { 'Content-Type': 'application/json' };
      if (options.token) headers.Authorization = 'Bearer ' + options.token;
      const response = await fetch('./api', {
        method: 'POST',
        mode: 'same-origin',
        credentials: 'omit',
        cache: 'no-store',
        headers,
        body: JSON.stringify({ action, payload }),
        signal: controller.signal,
      });
      let out;
      try {
        out = await response.json();
      } catch {
        throw new Error(
          'Respons backend bukan JSON. Periksa konfigurasi aplikasi Node.js di hosting.',
        );
      }
      if (!response.ok || out.ok !== true) {
        const err = new Error(
          out.error || 'Backend gagal memproses permintaan.',
        );
        err.status = response.status;
        throw err;
      }
      options.onTransport?.(action, 'nimbus-post', started, true);
      return out.data;
    } catch (err) {
      options.onTransport?.(action, 'nimbus-post', started, false);
      if (err?.name === 'AbortError')
        throw new Error(
          'Koneksi backend timeout. Perubahan akan dicoba kembali dengan ID permintaan yang sama.',
        );
      throw err;
    } finally {
      clearTimeout(timer);
    }
  },
};
