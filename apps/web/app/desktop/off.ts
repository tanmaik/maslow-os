// Said to the desktop the moment the person asks for a restart, an update,
// a reset or a move, from whatever window they asked in: the computer is
// off on screen at once, before its door has gone quiet.
export const turnOff = () =>
  window.top?.postMessage({ maslow: "off" }, location.origin);
