// CSS modules. This file used to also redeclare "next", "next/link" and "next/navigation", shadowing their real
// types (audit N3, FX-38).
declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
