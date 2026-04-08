# Multi-checkpoint progress bar (Dawn) – Enfoque y supuestos

## Qué se implementó

- Un progress bar con 3 checkpoints dentro del cart drawer (slide-out) de Dawn.
- El fill progresa proporcionalmente desde $0 hasta $200 (umbral máximo).
- Checkpoints visuales (33.33%, 66.66%, 100%) y labels: “Free shipping”, “20% off”, “Free gift”.
- Mensaje dinámico sobre la barra que indica el siguiente objetivo.
- Actualización en tiempo real sin recargar página, reaccionando a cambios de carrito dentro del drawer.
- Auto-add y auto-remove del regalo cuando el carrito cruza $200.

## Archivos tocados / añadidos

- Snippet UI:
  - `snippets/cart-progress-bar.liquid`
  - Inyección en el drawer: `snippets/cart-drawer.liquid`
- Estilos:
  - `assets/cart-progress.css` (scoped al drawer)
- Lógica:
  - `assets/cart-progress.js` (vanilla JS)

## Decisiones técnicas

### Actualización en tiempo real

- Se escucha el evento Pub/Sub nativo de Dawn `PUB_SUB_EVENTS.cartUpdate` (emitido por `cart.js`, `product-form.js`, etc.) para re-renderizar la barra después de cambios de cantidad o add/remove.
- Se añade un fallback con `MutationObserver` sobre el `cart-drawer` para cubrir casos donde el HTML del drawer se re-renderiza y el nodo del progress bar se reemplaza.
- Se escucha también `cart:updated` por compatibilidad con implementaciones externas.

### Lectura del total del carrito

- La barra calcula el progreso leyendo el estado actual con `GET /cart.js`.
- El monto se trabaja en centavos para evitar errores de floating point.

### Auto-regalo (gift)

- Cuando el total (en centavos) alcanza el umbral $200:
  - Se agrega el gift con `POST /cart/add.js`.
- Si el total vuelve a bajar de $200:
  - Se elimina el gift con `POST /cart/change.js` (quantity 0).
- Para evitar “loops” se usa un flag interno mientras se ejecuta la operación.
- Para que el gift no “auto-cumpla” el umbral por su propio precio, el cálculo del umbral excluye el `final_line_price` del gift (si existe en carrito).

## Supuesto sobre el producto regalo (free gift)

Como el theme no puede “crear” productos, se asume que en el store existe un producto de regalo dedicado con estas características:

- Producto oculto del catálogo público (o no promocionado).
- Una sola variante (recomendado).
- Precio $0.00 (recomendado).
- Inventario disponible.

### Cómo se identifica el regalo

Primero, el theme permite seleccionar el producto regalo desde el Theme Editor (setting):

- `cart_progress_gift_product`

Si está configurado, el progress bar obtiene su `selected_or_first_available_variant.id` y lo usa para auto-add/remove.

Si no está configurado, el snippet intenta resolver automáticamente el `variant_id` del regalo desde un producto con handle:

- `free-gift`

Si ese producto existe y está disponible, el progress bar obtiene su `selected_or_first_available_variant.id` y lo usa para auto-add/remove.

Si no existe (o no está disponible), el `variant_id` queda en 0 y no se añadirá nada.

## Nota sobre el “20% off”

Este feature implementa el checkpoint y los mensajes/UI de “20% off”, pero **no aplica el descuento automáticamente** (limitación de Shopify desde front-end).

Opciones reales para automatizarlo:

- Usar un Automatic Discount (por ejemplo, 20% con mínimo $150). Esto se aplica automáticamente en el carrito/checkout sin JS.
- Usar un Discount Code (aplicación manual o por link directo).
- Shopify Functions (si el plan/stack lo permite).
- App / backend.

## Umbrales

- $100: Free shipping
- $150: Free shipping + 20% off
- $200: Free shipping + 20% off + free gift (auto-add/remove)
