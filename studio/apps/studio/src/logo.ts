import { svg } from "./dom";

/** Marca original del estudio: sello rojo con líneas de velocidad y una «G» de trazo grueso. */
export const logoMark = () =>
  svg(`<svg class="logo-mark" viewBox="0 0 64 64" role="img" aria-label="Logotipo">
    <rect width="64" height="64" rx="9" fill="#e8323c"/>
    <path d="M-2 40 L70 6 M-2 50 L70 16 M-2 60 L70 26" stroke="#08080c" stroke-width="2.4" opacity=".35"/>
    <path d="M45 21H31a12 12 0 0 0 0 24h14V33H33" fill="none" stroke="#08080c" stroke-width="7" stroke-linejoin="miter"/>
    <path d="M45 21H31a12 12 0 0 0 0 24h14V33H33" fill="none" stroke="#f7f3ea" stroke-width="4.2" stroke-linejoin="miter"/>
  </svg>`);
