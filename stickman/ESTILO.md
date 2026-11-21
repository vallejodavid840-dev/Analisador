# Notas de estilo para la serie de stickmans

Este archivo es la memoria del proyecto. Léelo antes de animar cualquier escena nueva.
El usuario quiere que yo analice las referencias y decida solo. No le pidas que explique cada detalle.

## Análisis de las referencias
Referencias: "Strength vs Speed" (StickNodes, fondo blanco) y "Supreme Duelist Stickman: Dagger vs Cards" (fondo de desierto).

### Cuerpo y diseño (pedido explícito del usuario: cuerpos gordos, no flacos)
- Extremidades gruesas: el grosor de línea es cerca de 7% de la altura del muñeco.
- Cabeza redonda y algo grande, cerca de 11% de la altura. Sin cara ni ojos (silueta plana).
- Un solo color oscuro y plano por personaje, sin contorno. Pares: azul marino contra verde, azul pizarra contra rojo oscuro.
- No deformes: proporciones humanas compactas. Las manos son puños redondos.

### Ritmo
- Patrón repetido: pose de espera, ráfaga de acción, derribo, pausa, y vuelve a empezar.
- Los ataques se alternan entre los dos peleadores. Nadie pega dos veces seguidas sin respuesta.
- Poses bajas y con peso: agachado, zancada larga, deslizamiento, gateo, rodar por el suelo.
- Hay agarres, lanzamientos, giros en el aire, patadas voladoras y volteretas hacia atrás.
- Después de un golpe fuerte el que cae se queda quieto un momento. Esa pausa vende el golpe.

### Efectos (lo que hace que se vea profesional)
- Imágenes fantasma translúcidas detrás del que se mueve rápido. En las embestidas es una silueta blanca sólida.
- Arcos de corte: media luna blanca o de color sobre la patada o el golpe.
- Golpe especial: el fondo se tiñe de rojo, aparece un círculo grande con partículas y la cámara tiembla.
- Aura de neón (magenta) en ambos peleadores en el momento de poder.
- Rayos y proyectiles de color (verde, magenta) con estela.
- Polvo en cada aterrizaje y deslizamiento.

### Cámara y puesta en escena
- Plano medio fijo la mayor parte del tiempo, con zoom y acercamientos en los golpes grandes.
- Fondo de desierto con capas: cielo degradado, sol con brillo, mesetas en 3 capas, y siluetas gigantes de muñecos grabadas en la roca.
- Estructura de episodio: pantalla de versus con corte diagonal, "FIGHT!", pelea, cartel de ganador, pantalla final.
- Rótulos grandes con borde grueso. Tipografía de cómic.

## Reglas técnicas del motor
- Todo es una función del tiempo. `render(t)` se puede mover con el control deslizante.
- Esqueleto con cinemática inversa de 2 huesos. Brazos y piernas nunca se rompen.
- Poses clave con mezcla suave y curvas de aceleración. Se escribe como una lista de claves por peleador.
- Detención de imagen en cada golpe (hit-stop) y cámara lenta con mapa de tiempo real a tiempo de escena.
- La sacudida, el destello y el zoom del golpe usan tiempo real, así vibran incluso durante la detención.

## Archivos
- `episodio1.html`: persecución (esqueleto delgado, versión inicial).
- `episodio2.html`: primera pelea con el estilo de las referencias (cuerpos gruesos).
- `episodio3.html`: duelo con daga, cartas de energía, agarre con lanzamiento, auras, choque de rayos y cortes de cámara.

## Regla de trato con el usuario
- Nunca listar lo que no puedo hacer ni disculparme por límites. Si hay una carencia, la resuelvo y entrego el resultado.
