# Frumos — Estudio musical

Aplicación web de estudio musical adaptable con repertorio, metrónomo y afinador cromático para guitarra. El afinador detecta la frecuencia real desde el micrófono y procesa el audio localmente en el navegador.

## Desarrollo

Requiere Node.js 22+:

```sh
npm install
npm run dev
```

## Comprobaciones

```sh
npm test
npm run build
```

Los proyectos se guardan en IndexedDB del dispositivo. Las afinaciones personalizadas y las preferencias del afinador se conservan en el almacenamiento local. El audio del micrófono no se graba ni se transmite.

## GitHub Pages

El flujo de GitHub Actions compila la app en cada cambio de `main` y publica `dist`. En **Settings → Pages**, selecciona **GitHub Actions** como fuente. Tras el despliegue, abre el sitio con HTTPS y permite el micrófono desde el botón **Activar micrófono**.
