# lunes

Webapp de seguimiento de tareas con puntajes, sin backend. Parodia amistosa de monday.com.

## Qué hace

- Registro de tareas con responsable, complejidad, fechas de compromiso y cierre.
- Puntaje automático: `(puntos del estado × factor de complejidad) − (aplazamientos × penalidad) + puntos extra`.
- Aplazamientos automáticos con historial y motivo al postergar fechas.
- Dashboard con rango de fechas: podios de puntajes y entregas anticipadas, cumplimiento, tareas que demandan atención.
- Reporte imprimible (PDF) con secciones seleccionables.
- Importar/exportar Excel, CSV y JSON. Respaldo automático a un archivo local (Chrome/Edge).

## Privacidad

100% local: los datos viven en el `localStorage` de tu navegador. Sin servidor, sin cookies, sin analytics. Ver la política de privacidad dentro de la app.

## Uso

No requiere instalación ni build. Abre `index.html` en Chrome/Edge, o sirve la carpeta:

```bash
python3 -m http.server 8000
```

y entra a `http://localhost:8000`.

## Stack

HTML + CSS + JavaScript vanilla. [SheetJS](https://sheetjs.com) (incluido en `vendor/`) solo para importar Excel.

---

Desarrollado por [Carlos Ganoza](https://carlosganoza.com)
