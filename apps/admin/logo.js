/* =====================================================================
   ACTOM Apprenticeship Portal — logo

   The corporate mark is baked in as base64 rather than fetched, so it
   renders instantly, survives an offline cache, and needs no extra
   request on a metered connection. That is the ACTOM internal-tool
   convention.

   ---------------------------------------------------------------------
   TO INSTALL THE REAL LOGO

   From the repo root in PowerShell, with the official file to hand
   (PNG on transparent background, or SVG):

     $b = [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\actom-logo.png"))
     "data:image/png;base64,$b" | Set-Clipboard

   For an SVG use: "data:image/svg+xml;base64,$b"

   Paste the result between the quotes of LOGO_LIGHT below, then run
   .\shared\sync.sh and commit.

   Two variants, because the mark sits on both dark navy and white:
     LOGO_LIGHT — for dark backgrounds (masthead, sign-in panel)
     LOGO_DARK  — for light backgrounds (cards, print)
   If you only have one file, set both to it.

   Until they are filled in, the text wordmark below is used. It is a
   reasonable stand-in, but it is NOT the corporate mark and should be
   replaced before this faces the public.
   --------------------------------------------------------------------- */
(function () {
  'use strict';

  /* The ACTOM mark: white lettering on a corporate-blue tile with the
     "SINCE 1903" lockup. Because the tile carries its own background, one
     asset serves both light and dark surfaces — hence the two constants
     pointing at the same image. Resized to 199x104 (2x the largest use)
     so it stays crisp on retina without carrying the full 600px original
     into every page load. */
  var LOGO_LIGHT = 'data:image/png;base64,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';
  var LOGO_DARK  = LOGO_LIGHT;

  function textMark(size) {
    return '<span class="wordmark" style="font-size:' + size + '">' +
           'ACT<span>O</span>M</span>';
  }

  /* Render the logo into every element carrying data-actom-logo.
     Attributes:
       data-actom-logo="light|dark"   which variant (default light)
       data-logo-height="34"          rendered height in px (default 30)  */
  function render(root) {
    (root || document).querySelectorAll('[data-actom-logo]').forEach(function (el) {
      var variant = el.dataset.actomLogo === 'dark' ? 'dark' : 'light';
      var src = variant === 'dark' ? LOGO_DARK : LOGO_LIGHT;
      var h = el.dataset.logoHeight || '30';

      if (src) {
        el.innerHTML = '<img src="' + src + '" alt="ACTOM" class="actom-logo" ' +
                       'style="height:' + h + 'px">';
      } else {
        // Fallback: the text wordmark, sized to roughly match.
        el.innerHTML = textMark(Math.round(h * 0.85) + 'px');
        el.classList.add('logo-fallback');
      }
    });
  }

  window.ACTOM_LOGO = {
    installed: !!(LOGO_LIGHT || LOGO_DARK),
    render: render
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { render(); });
  } else {
    render();
  }
})();
