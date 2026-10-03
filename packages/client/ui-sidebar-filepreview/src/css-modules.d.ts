/** Ambient typing for CSS Modules imported from client sources. */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
