# Frumos Space — Estudio musical

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

## Android

La plataforma Android se compila automáticamente con GitHub Actions en cada cambio de `main`. El flujo publica `FrumosSpace-Android.zip` en la sección **Releases**; contiene el APK de Android para instalarlo en el dispositivo. Los datos del repertorio y las preferencias se guardan localmente en el almacenamiento de la app.

## GitHub Pages

El flujo de GitHub Actions compila la app en cada cambio de `main` y publica `dist`. En **Settings → Pages**, selecciona **GitHub Actions** como fuente. Tras el despliegue, abre el sitio con HTTPS y permite el micrófono desde el botón **Activar micrófono**.
