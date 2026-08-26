/* =====================================================================
   ACTOM wordmark, drawn as SVG so there is no image file to load and
   nothing to go missing on a slow shop-floor connection.

   NOTE: this is an approximation — the letterforms are set in a system
   sans with the circuit trace drawn as paths. Before go-live, replace
   the paths here with the official ACTOM vector (the same source the
   brand blue #0063AF was taken from) and re-run ./shared/sync.sh.
   Edit HERE and nowhere else.
   ===================================================================== */
window.ACTOM_LOGO = {
  /* Small mark for the blue tile in the sidebar and sign-in card. */
  tile: function (w) {
    w = w || 30;
    return '<svg width="' + w + '" height="' + Math.round(w * 0.567) + '" viewBox="0 0 300 96" ' +
      'fill="none" role="img" aria-label="ACTOM">' +
      '<text x="4" y="54" font-family="\'Segoe UI\',Arial,sans-serif" font-size="54" ' +
      'letter-spacing="1" fill="#fff">ACTOM</text>' +
      '<path d="M4 70 H140 L160 50 H182 L198 70 H288" stroke="#fff" stroke-width="5" ' +
      'fill="none" stroke-linejoin="round"/></svg>';
  },
  /* Full lockup with the tagline, for the loading screen. */
  full: function () {
    return '<svg width="290" height="88" viewBox="0 0 320 96" fill="none" role="img" aria-label="ACTOM">' +
      '<text x="14" y="56" font-family="\'Segoe UI\',\'Helvetica Neue\',Arial,sans-serif" ' +
      'font-size="58" font-weight="300" letter-spacing="3" fill="#fff">ACTOM</text>' +
      '<path class="spark" d="M14 72 H150 L172 50 H196 L214 72 H306" stroke="#fff" ' +
      'stroke-width="2.4" fill="none" stroke-linejoin="round"/>' +
      '<path class="spark" d="M14 79 H146 L168 57" stroke="#fff" stroke-width="2.4" ' +
      'fill="none" stroke-linejoin="round" opacity=".85"/>' +
      '<text x="306" y="92" text-anchor="end" font-family="\'Segoe UI\',Arial,sans-serif" ' +
      'font-size="12" letter-spacing="3" fill="#9db9d6">SINCE 1903</text></svg>';
  }
};
