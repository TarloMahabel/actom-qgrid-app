# Fonts

Sora (headings and key figures) and Manrope (interface and body text), as
the ACTOM dashboard design brief specifies. Variable fonts, so one file per
family covers every weight.

Served from this site rather than from Google Fonts. The Content-Security-
Policy in scripts/gen-config.mjs is `font-src 'self'`, which refuses a
webfont from any other origin; self-hosting needs no change to it. It is
also the better arrangement for a shop-floor tablet on a weak signal, which
would otherwise wait on Google before it could draw any text.

Taken from the @fontsource-variable/sora and @fontsource-variable/manrope
packages (5.3.0). `-latin` covers English; `-latin-ext` covers accented
names and is only downloaded when a page actually contains such a
character, via unicode-range in tokens.css.

Both are licensed under the SIL Open Font License 1.1, which permits
bundling them with this application. The licence texts are alongside.

Edit nothing under apps/inspect/fonts -- shared/sync.sh copies these there.
