# Notas de estilo para la serie de stickmans

Este archivo es la memoria del proyecto. Léelo antes de animar cualquier escena nueva.

## Lo que le gusta al usuario (de sus videos de referencia)
Referencias: "Strength vs Speed" (StickNodes) y "Supreme Duelist Stickman: Dagger vs Cards".

- Movimiento con peso: anticipación, impacto y recuperación. Nada de poses que se teletransportan.
- Extremidades gruesas y de un solo color por personaje (azul oscuro contra rojo oscuro, verde contra azul marino).
- Cuerpos que no se atraviesan: los golpes reaccionan (el otro sale volando, rueda, cae al suelo).
- Combate rápido con cambios de ritmo: cámara lenta en el impacto, y luego velocidad otra vez.
- Efectos encima del movimiento: estelas, destellos, cortes de luz, fondo que se tiñe de rojo en el golpe especial.
- Fondos con degradados y capas (desierto, montañas), no un fondo vacío, salvo en el estilo minimalista de StickNodes.
- Rótulos grandes y claros: "FIGHT!", "CARDS WINS!", pantalla de versus al inicio.
- Poses de lucha reales: agachado, giro en el aire, patada con rotación, deslizamiento.

## Reglas técnicas del motor (`episodio1.html`)
- Esqueleto con cinemática inversa de 2 huesos. Brazos y piernas nunca se rompen.
- La fase del paso se calcula con la distancia recorrida, así el pie apoyado no patina.
- Todo es una función del tiempo `render(t)`. Se puede mover el control deslizante y se puede grabar.
- Poses clave con mezcla suave. Cada cambio de pose usa una curva (`ss`, `out`, `in`, `lin`).
- Cada escena lleva sacudida de cámara, polvo en los contactos y sonido sincronizado.

## Lo que falta para llegar al nivel de las referencias
- Peleas cuerpo a cuerpo con golpes que conectan y reacciones físicas.
- Estelas de movimiento (imagen fantasma) y cámara lenta en el impacto.
- Efectos de energía, cortes de luz y cambios de color del fondo.
- Cortes de cámara y zoom, no solo seguimiento lateral.
- Armas o accesorios (daga, cartas).
