// Wraps the browser Geolocation API in a promise with friendly,
// distinct messages per failure mode (permission denied / unavailable /
// timeout / unsupported) — used both by the admin's "use my current
// location as the office" button and the employee's check-in button.
export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation isn't supported by this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(new Error("Location permission was denied. Enable location access for this site in your browser settings and try again."));
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          reject(new Error("Your location couldn't be determined right now. Try again in a moment."));
        } else if (err.code === err.TIMEOUT) {
          reject(new Error("Getting your location timed out. Try again."));
        } else {
          reject(new Error("Couldn't get your location."));
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}
