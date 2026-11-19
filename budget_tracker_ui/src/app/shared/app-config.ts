// FILE: src/app/shared/api-config.ts  (NEW file)
/**
 * The one place that says where the Flask API lives.
 *
 * It uses the same host the page was opened from, so:
 *  - on your computer (http://localhost:4200)      -> http://localhost:5000/
 *  - on your phone   (http://192.168.1.20:4200)    -> http://192.168.1.20:5000/
 * Nothing to change between the two. To point at a different API, edit API_PORT here.
 */
const API_PORT = 5001;

export const API_BASE_URL = `${window.location.protocol}//${window.location.hostname}:${API_PORT}/`;
