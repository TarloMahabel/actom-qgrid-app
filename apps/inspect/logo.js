/* =====================================================================
   ACTOM logo — the official badge mark, embedded.

   Two variants, both base64 so there is no image file to fetch and
   nothing to 404 on a slow shop-floor connection:

     blue   the supplied artwork, brand blue on white — for light surfaces
     white  the same mark recoloured white on transparent — for the navy
            tile and the loading screen

   The white version is generated from the blue one by taking alpha from
   how dark each pixel is, so the antialiasing on the lettering survives
   rather than becoming a hard jagged edge. If the artwork is ever
   replaced, regenerate both from the same source; do not hand-edit the
   strings below.

   Source: ACTOM_1903_BADGE_LOGO_WHITE_NO_SLOGAN_300_PPI.png, resampled
   to 560 px wide — enough for the 200 px loading mark at 2x — and the
   blue variant quantised, because a two-colour line drawing does not
   need a full-colour PNG and this file loads on every page view.

   Edit HERE, then run ./shared/sync.sh.
   ===================================================================== */
(function () {
  var BLUE  = 'data:image/png;base64,' +
    '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';

  var WHITE = 'data:image/png;base64,' +
    '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';

  window.ACTOM_LOGO = {
    src: { blue: BLUE, white: WHITE },

    /* The mark for a dark tile, sized by height. */
    tile: function (h) {
      h = h || 26;
      return '<img src="' + WHITE + '" alt="ACTOM" ' +
             'style="height:' + h + 'px;width:auto;display:block">';
    },

    /* The mark on a light surface. */
    onLight: function (h) {
      h = h || 30;
      return '<img src="' + BLUE + '" alt="ACTOM" ' +
             'style="height:' + h + 'px;width:auto;display:block">';
    },

    /* ------------------------------------------------------------------
       The loading screen: a line energising between two lattice pylons.

       It is not decoration for its own sake. Loading takes long enough on
       a shop-floor tablet that a blank navy screen reads as a hung app —
       which this project has already been caught by. Something visibly
       moving says "working", and a transmission line energising is the
       one image every person in this business reads instantly.

       Drawn as SVG rather than a GIF: it scales, it is a few hundred
       bytes, and it inherits the palette. prefers-reduced-motion stops
       the animation and leaves the scene lit, so it still looks
       deliberate rather than broken.
       ------------------------------------------------------------------ */
    pylons: function () {
      /* One lattice tower. Legs splay to a base, the body tapers, three
         cross-arms carry the conductors, insulators hang from the tips. */
      function pylon(cx) {
        var g = [];
        var baseY = 214, hipY = 128, waistY = 96, topY = 54;
        var legOut = 27, hipIn = 11, waistIn = 8, topIn = 5;

        // legs and body
        g.push('M' + (cx - legOut) + ' ' + baseY + ' L' + (cx - hipIn) + ' ' + hipY +
               ' L' + (cx - waistIn) + ' ' + waistY + ' L' + (cx - topIn) + ' ' + topY);
        g.push('M' + (cx + legOut) + ' ' + baseY + ' L' + (cx + hipIn) + ' ' + hipY +
               ' L' + (cx + waistIn) + ' ' + waistY + ' L' + (cx + topIn) + ' ' + topY);
        g.push('M' + (cx - topIn) + ' ' + topY + ' L' + (cx + topIn) + ' ' + topY);

        // lattice bracing: alternating diagonals down the tower
        var steps = 7, y0 = topY, y1 = baseY;
        for (var i = 0; i < steps; i++) {
          var ya = y0 + (y1 - y0) * i / steps, yb = y0 + (y1 - y0) * (i + 1) / steps;
          var wa = topIn + (legOut - topIn) * Math.pow(i / steps, 1.4);
          var wb = topIn + (legOut - topIn) * Math.pow((i + 1) / steps, 1.4);
          g.push(i % 2
            ? 'M' + (cx - wa) + ' ' + ya + ' L' + (cx + wb) + ' ' + yb
            : 'M' + (cx + wa) + ' ' + ya + ' L' + (cx - wb) + ' ' + yb);
          g.push('M' + (cx - wb) + ' ' + yb + ' L' + (cx + wb) + ' ' + yb);
        }

        // cross-arms with insulator drops
        [[74, 104], [58, 80], [40, 60]].forEach(function (arm) {
          var w = arm[0], y = arm[1];
          g.push('M' + (cx - w) + ' ' + y + ' L' + (cx + w) + ' ' + y);
          g.push('M' + (cx - w) + ' ' + y + ' L' + (cx - w) + ' ' + (y + 9));
          g.push('M' + (cx + w) + ' ' + y + ' L' + (cx + w) + ' ' + (y + 9));
        });
        return g.join(' ');
      }

      var L = 120, R = 600;

      /* Each conductor runs the full width: down to the substation gantry
         on the left, across the span with the sag a real line has, and
         down to the gantry on the right. Stopping between the towers left
         the substation bays sitting unconnected and the line reading as a
         fragment rather than a circuit — and the current pulse needs
         somewhere to come FROM and somewhere to arrive.

         The gaps at each tower are subpath breaks, so the pulse appears to
         pass through the insulator string, which is what happens. */
      function conductor(armW, y, sag) {
        /* Runs off both edges of the frame rather than fanning down to the
           substation. The literal take-off gantry looked cluttered at 172 px
           tall — three lines converging on a point beside the tower leg. Off
           the edges the line reads as passing THROUGH, which is both truer
           of a transmission line and quieter.

           The gaps at each tower are subpath breaks, so the pulse appears to
           pass through the insulator string. */
        return 'M-6 ' + (y + 7) + ' L' + (L - armW) + ' ' + y +
               ' M' + (L + armW) + ' ' + y + ' Q360 ' + sag + ' ' + (R - armW) + ' ' + y +
               ' M' + (R + armW) + ' ' + y + ' L726 ' + (y + 7);
      }
      var wires = [
        conductor(74, 113, 152),
        conductor(58,  89, 126),
        conductor(40,  69, 104)
      ];

      return '' +
      '<svg class="pyl" viewBox="0 0 720 250" width="100%" height="100%" ' +
           'preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
        '<defs>' +
          /* Fade the ground out at both ends. A flat rectangle read as a
             hard-edged bar across the bottom of the panel, which looked
             like a rendering artefact rather than ground. */
          '<linearGradient id="pylGround" x1="0" y1="0" x2="1" y2="0">' +
            '<stop offset="0" stop-color="#7fb3dd" stop-opacity="0"/>' +
            '<stop offset=".22" stop-color="#7fb3dd" stop-opacity=".4"/>' +
            '<stop offset=".78" stop-color="#7fb3dd" stop-opacity=".4"/>' +
            '<stop offset="1" stop-color="#7fb3dd" stop-opacity="0"/>' +
          '</linearGradient>' +
          '<linearGradient id="pylHaze" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="#7fb3dd" stop-opacity=".16"/>' +
            '<stop offset="1" stop-color="#7fb3dd" stop-opacity="0"/>' +
          '</linearGradient>' +
          '<mask id="pylFade">' +
            '<rect x="0" y="0" width="720" height="250" fill="url(#pylGround)"/>' +
          '</mask>' +
        '</defs>' +

        // ground line and a suggestion of a yard
        '<g mask="url(#pylFade)">' +
          '<path d="M0 214 H720" stroke="#8ec2e8" stroke-width="1.1"/>' +
          '<rect x="0" y="214" width="720" height="30" fill="url(#pylHaze)"/>' +
        '</g>' +

        // substation bays at each end
        '<g stroke="#8ec2e8" stroke-opacity=".5" stroke-width="1.6" fill="none">' +
          '<path d="M24 214 v-24 h34 v24 M41 190 v-13 h40"/>' +
          '<path d="M696 214 v-24 h-34 v24 M679 190 v-13 h-40"/>' +
        '</g>' +
        '<circle class="pyl-node" cx="41" cy="177" r="4" fill="#7ee0ff"/>' +
        '<circle class="pyl-node n2" cx="679" cy="177" r="4" fill="#7ee0ff"/>' +

        // the towers
        '<g stroke="#cfe6f8" stroke-opacity=".85" stroke-width="1.7" fill="none" ' +
           'stroke-linecap="round">' +
          '<path d="' + pylon(L) + '"/><path d="' + pylon(R) + '"/>' +
        '</g>' +

        // conductors, then the same paths again as a travelling current pulse
        '<g fill="none" stroke="#9fd2f2" stroke-opacity=".55" stroke-width="1.5">' +
          wires.map(function (w) { return '<path d="' + w + '"/>'; }).join('') +
        '</g>' +
        '<g fill="none" stroke="#7ee0ff" stroke-width="2.6" stroke-linecap="round">' +
          wires.map(function (w, i) {
            return '<path class="pyl-pulse p' + i + '" d="' + w + '"/>';
          }).join('') +
        '</g>' +
      '</svg>';
    },

    /* The full loading mark: badge above, line energising below. */
    full: function () {
      return '<div class="ldr-badge">' +
               '<img src="' + WHITE + '" alt="ACTOM">' +
             '</div>' +
             '<div class="ldr-scene">' + window.ACTOM_LOGO.pylons() + '</div>';
    }
  };
})();
