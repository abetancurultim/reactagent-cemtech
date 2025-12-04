/**
 * Espera un número específico de milisegundos.
 * @param ms - Milisegundos a esperar.
 */
export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Genera un número aleatorio dentro de un rango.
 * @param min - El valor mínimo del rango (en milisegundos).
 * @param max - El valor máximo del rango (en milisegundos).
 * @returns Un número aleatorio de milisegundos.
 */
export function getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}
