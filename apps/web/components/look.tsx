const KEY = "look";

// Set on the root before the first paint, so nobody sees the other look
// flash past. Its own script, not React, which runs too late for this.
export const beforePaint = `try{var k=localStorage.getItem("${KEY}");var d=k==="dark"||(k!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}`;
