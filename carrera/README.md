# Gran Premio Hoonicorn

Carrera 3D de 5 autos (Hoonicorn + 4 BMW) simulada con física propia y renderizada con Three.js.

- `js/sim.js` – simulación determinista (potencia, masa, agarre, frenado, adelantamientos, errores de piloto, choques con colisión OBB).
- `js/track.js` – circuito de ~2 km (spline cerrada) compartido por la simulación y la escena.
- `js/cars.js` – carga de modelos (GLB/FBX), separa las ruedas por lado y las arma como "huesos" para girar/dirigir; genera LODs.
- `js/race.js` – escena, director de cámaras (incluye repeticiones), humo/chispas, marcador y pantalla final.
- `index.html` – abrir desde un servidor local con los modelos en `models/<auto>/` (no incluidos). `?render=1` para renderizar cuadro a cuadro.

## Créditos
- «Hoonicorn – A tribute to Ken Block (Updated)» por **Chaserfan**, CC BY 4.0 – https://sketchfab.com/3d-models/hoonicorn-a-tribute-to-ken-block-updated-e645466636304e5c86e91103608aed38
- Modelos BMW (M5 E34, Z8, 850 CSi, M3 E36): archivos de la carpeta *MODELOS 3D* de David (sin información de licencia en los zips; verificar antes de publicar).
